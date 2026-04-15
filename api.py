import scraper
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analysis import analyze_reviews, enrich_reviews
from scraper import (
    extract_content,
    extract_product_header,
    fetch_product_data,
    is_blocked,
    parse_reviews,
)
from utils import get_product_id


app = FastAPI(title="Amazon Review Analyzer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    url: str


def _pick_helpful_review(reviews, sentiment):
    candidates = [r for r in reviews if r.get("sentiment") == sentiment]
    if not candidates:
        return None
    return sorted(candidates, key=lambda r: (int(r.get("helpful_votes") or 0), float(r.get("rating") or 0)), reverse=True)[0]


def _extract_key_phrases(summary):
    phrases = []
    for term, count in summary.get("top_positive_terms", [])[:4]:
        phrases.append({"phrase": term, "count": count, "sentiment": "positive"})
    for term, count in summary.get("top_negative_terms", [])[:4]:
        phrases.append({"phrase": term, "count": count, "sentiment": "negative"})
    return phrases


def _build_key_insights(summary, reviews):
    positives = [a for a, counts in summary.get("aspect_sentiment", {}).items() if counts.get("positive", 0) > counts.get("negative", 0)]
    negatives = [a for a, counts in summary.get("aspect_sentiment", {}).items() if counts.get("negative", 0) >= counts.get("positive", 0) and counts.get("negative", 0) > 0]

    helpful_positive = _pick_helpful_review(reviews, "positive")
    helpful_negative = _pick_helpful_review(reviews, "negative")

    return {
        "summary_text": (
            f"Customers mostly highlighted {', '.join(positives[:3]) or 'general experience'}, "
            f"while concerns were around {', '.join(negatives[:3]) or 'a few isolated issues'}."
        ),
        "pros": positives[:5],
        "cons": negatives[:5],
        "key_phrases": _extract_key_phrases(summary),
        "most_helpful_positive": helpful_positive,
        "most_helpful_negative": helpful_negative,
    }


def _advanced_analytics(reviews):
    verified = [r for r in reviews if r.get("verified_purchase")]
    non_verified = [r for r in reviews if not r.get("verified_purchase")]

    def avg_sentiment_score(rows):
        if not rows:
            return 0
        return round(sum(float(r.get("sentiment_score") or 0) for r in rows) / len(rows), 3)

    short = [r for r in reviews if len(str(r.get("review") or "")) < 120]
    long = [r for r in reviews if len(str(r.get("review") or "")) >= 120]

    return {
        "verified_vs_nonverified": {
            "verified_count": len(verified),
            "non_verified_count": len(non_verified),
            "verified_avg_sentiment_score": avg_sentiment_score(verified),
            "non_verified_avg_sentiment_score": avg_sentiment_score(non_verified),
        },
        "sentiment_by_review_length": {
            "short_reviews_avg_sentiment_score": avg_sentiment_score(short),
            "long_reviews_avg_sentiment_score": avg_sentiment_score(long),
        },
        "review_velocity_per_month_estimate": round(len(reviews) / 3.0, 2),
        "seller_response_rate": None,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    product_id = get_product_id(request.url)
    if not product_id:
        raise HTTPException(status_code=400, detail="Invalid Amazon URL or ASIN.")

    api_response = fetch_product_data(product_id, domain="in")
    if api_response is None:
        detail = scraper.LAST_FETCH_ERROR or "Failed to fetch product data from Oxylabs."
        raise HTTPException(status_code=502, detail=detail)

    content = extract_content(api_response)
    if content is None:
        raise HTTPException(status_code=502, detail="Failed to extract parsed content.")

    if is_blocked(content):
        raise HTTPException(status_code=429, detail="Blocked by Amazon. Please try again later.")

    reviews = parse_reviews(content)
    if not reviews:
        raise HTTPException(status_code=404, detail="No reviews found for this product.")

    summary = analyze_reviews(reviews)
    summary.pop("dataframe", None)

    enriched = enrich_reviews(reviews)
    product = extract_product_header(content, product_id)
    key_insights = _build_key_insights(summary, enriched)
    advanced = _advanced_analytics(enriched)

    return {
        "product_id": product_id,
        "product": product,
        "summary": summary,
        "reviews": enriched,
        "key_insights": key_insights,
        "advanced_analytics": advanced,
    }
