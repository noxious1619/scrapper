import re
from collections import Counter, defaultdict
import os
import json

import pandas as pd

ROBERTA_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
_SENTIMENT_PIPE = None
_KMEANS_CLASS = None
_TFIDF_CLASS = None

POSITIVE_WORDS = {
    "amazing", "awesome", "best", "excellent", "good", "great", "happy", "love",
    "nice", "perfect", "recommend", "satisfied", "superb", "value", "worth",
}
NEGATIVE_WORDS = {
    "awful", "bad", "broken", "cheap", "damage", "defect", "disappointed", "fake",
    "issue", "poor", "problem", "refund", "return", "terrible", "waste", "worst",
}
SARCASM_CUES = {
    "yeah right", "just great", "what a joke", "as if", "wow", "sure",
    "thanks a lot", "brilliant", "fantastic",
}
ASPECT_KEYWORDS = {
    "price": {"price", "cost", "value", "expensive", "cheap", "money", "budget"},
    "quality": {"quality", "build", "material", "durable", "sturdy", "fragile"},
    "delivery": {"delivery", "shipped", "shipping", "courier", "late", "packaging"},
    "performance": {"performance", "speed", "fast", "slow", "lag", "smooth"},
    "battery": {"battery", "charge", "charging", "backup", "drain"},
    "design": {"design", "look", "style", "finish", "color"},
    "size_fit": {"size", "fit", "small", "large", "tight", "loose"},
    "service": {"support", "service", "warranty", "replace", "replacement"},
}
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
    "i", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to",
    "was", "were", "will", "with", "you", "your",
}


def _get_sentiment_pipe():
    global _SENTIMENT_PIPE
    if _SENTIMENT_PIPE is not None:
        return _SENTIMENT_PIPE

    # Transformers is opt-in to avoid torch/numpy ABI issues on many local setups.
    if os.getenv("ENABLE_TRANSFORMERS", "").lower() not in {"1", "true", "yes"}:
        return None

    if os.getenv("DISABLE_TRANSFORMERS", "").lower() in {"1", "true", "yes"}:
        return None

    try:
        from transformers import pipeline
        _SENTIMENT_PIPE = pipeline("sentiment-analysis", model=ROBERTA_MODEL, truncation=True)
    except BaseException:
        _SENTIMENT_PIPE = None
    return _SENTIMENT_PIPE


def _get_sklearn_classes():
    global _KMEANS_CLASS, _TFIDF_CLASS
    if _KMEANS_CLASS is not None and _TFIDF_CLASS is not None:
        return _KMEANS_CLASS, _TFIDF_CLASS
    try:
        from sklearn.cluster import KMeans
        from sklearn.feature_extraction.text import TfidfVectorizer
        _KMEANS_CLASS = KMeans
        _TFIDF_CLASS = TfidfVectorizer
    except Exception:
        _KMEANS_CLASS = None
        _TFIDF_CLASS = None
    return _KMEANS_CLASS, _TFIDF_CLASS


def _normalize_roberta_label(label):
    value = (label or "").upper().strip()
    mapping = {
        "LABEL_0": "negative",
        "LABEL_1": "neutral",
        "LABEL_2": "positive",
        "NEGATIVE": "negative",
        "NEUTRAL": "neutral",
        "POSITIVE": "positive",
    }
    return mapping.get(value, "neutral")


def _fallback_sentiment(text, rating=None):
    lower = (text or "").lower()
    positive_count = sum(1 for word in POSITIVE_WORDS if word in lower)
    negative_count = sum(1 for word in NEGATIVE_WORDS if word in lower)

    if isinstance(rating, (int, float)):
        if rating >= 4 and (positive_count > 0 or negative_count == 0):
            return "positive", 0.70, "rating+lexicon"
        if rating <= 2 and (negative_count > 0 or positive_count == 0):
            return "negative", 0.70, "rating+lexicon"

    if positive_count > negative_count:
        return "positive", 0.60, "lexicon"
    if negative_count > positive_count:
        return "negative", 0.60, "lexicon"
    return "neutral", 0.50, "lexicon"


def _has_sarcasm_cue(text):
    lower = (text or "").lower()
    if "!" in lower and any(word in lower for word in NEGATIVE_WORDS):
        return True
    if re.search(r"\"(great|amazing|perfect|excellent)\"", lower):
        return True
    return any(cue in lower for cue in SARCASM_CUES)


def _hybrid_sentiment(text, rating=None):
    pipe = _get_sentiment_pipe()
    if pipe is not None:
        try:
            result = pipe((text or "")[:512])[0]
            label = _normalize_roberta_label(result.get("label"))
            score = float(result.get("score", 0.50))
            source = "roberta"
        except Exception:
            label, score, source = _fallback_sentiment(text, rating)
    else:
        label, score, source = _fallback_sentiment(text, rating)

    sarcasm = _has_sarcasm_cue(text)
    lower = (text or "").lower()
    has_negative_terms = any(word in lower for word in NEGATIVE_WORDS)

    # If model is strongly positive but sarcasm cues + negative terms appear, downgrade.
    if sarcasm and label == "positive" and has_negative_terms:
        label = "negative"
        score = max(0.55, min(score, 0.75))
        source = f"{source}+sarcasm"

    # Rating prior to soften obvious contradictions.
    if isinstance(rating, (int, float)):
        if rating <= 2 and label == "positive":
            label = "negative" if sarcasm or has_negative_terms else "neutral"
            source = f"{source}+rating"
        elif rating >= 4 and label == "negative" and not has_negative_terms:
            label = "neutral"
            source = f"{source}+rating"

    return label, round(score, 4), sarcasm, source


def _extract_aspects(text):
    lower = (text or "").lower()
    aspects = [name for name, words in ASPECT_KEYWORDS.items() if any(word in lower for word in words)]
    return aspects or ["general"]


def _clean_tokens(text):
    words = re.findall(r"[a-zA-Z]{3,}", (text or "").lower())
    return [word for word in words if word not in STOPWORDS]


def _top_terms(texts, limit=10):
    counts = Counter()
    for text in texts:
        counts.update(_clean_tokens(text))
    return counts.most_common(limit)


def _cluster_negative_themes(texts):
    KMeans, TfidfVectorizer = _get_sklearn_classes()
    if not texts or len(texts) < 4 or TfidfVectorizer is None or KMeans is None:
        return []

    max_clusters = min(4, len(texts))
    n_clusters = 2 if len(texts) < 8 else 3
    n_clusters = min(max_clusters, n_clusters)

    if n_clusters < 2:
        return []

    vectorizer = TfidfVectorizer(stop_words="english", max_features=1000, ngram_range=(1, 2))
    matrix = vectorizer.fit_transform(texts)
    if matrix.shape[0] < n_clusters:
        return []

    model = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = model.fit_predict(matrix)
    features = vectorizer.get_feature_names_out()

    themes = []
    for cluster_id in range(n_clusters):
        center = model.cluster_centers_[cluster_id]
        top_idx = sorted(range(len(center)), key=lambda i: center[i], reverse=True)[:5]
        keywords = [features[i] for i in top_idx]
        count = int(sum(1 for label in labels if label == cluster_id))
        themes.append({"cluster": cluster_id + 1, "count": count, "keywords": keywords})

    themes.sort(key=lambda item: item["count"], reverse=True)
    return themes


def _enrich_reviews(reviews):
    enriched = []

    for review in reviews:
        row = dict(review)
        title = row.get("title", "")
        body = row.get("review", "")
        rating = row.get("rating")
        text = f"{title}. {body}".strip()

        label, score, sarcasm_flag, source = _hybrid_sentiment(text, rating=rating)
        aspects = _extract_aspects(text)

        row["sentiment"] = label
        row["sentiment_score"] = score
        row["sarcasm_flag"] = sarcasm_flag
        row["sentiment_source"] = source
        row["aspects"] = ", ".join(aspects)
        enriched.append(row)

    return enriched


def enrich_reviews(reviews):
    return _enrich_reviews(reviews)


def analyze_reviews(reviews):
    if not reviews:
        return {
            "total_reviews": 0,
            "average_rating": None,
            "sentiment_counts": {},
            "aspect_sentiment": {},
            "top_positive_terms": [],
            "top_negative_terms": [],
            "negative_themes": [],
            "dataframe": pd.DataFrame(),
        }

    enriched = _enrich_reviews(reviews)
    df = pd.DataFrame(enriched)

    ratings = pd.to_numeric(df.get("rating"), errors="coerce").dropna()
    average_rating = round(float(ratings.mean()), 2) if not ratings.empty else None
    sentiment_counts = dict(Counter(df["sentiment"]))

    aspect_sentiment = defaultdict(lambda: Counter({"positive": 0, "neutral": 0, "negative": 0}))
    for _, row in df.iterrows():
        aspects = [item.strip() for item in str(row.get("aspects", "general")).split(",") if item.strip()]
        for aspect in aspects:
            aspect_sentiment[aspect][row["sentiment"]] += 1

    positive_texts = [str(row.get("review", "")) for _, row in df[df["sentiment"] == "positive"].iterrows()]
    negative_texts = [str(row.get("review", "")) for _, row in df[df["sentiment"] == "negative"].iterrows()]

    return {
        "total_reviews": len(df),
        "average_rating": average_rating,
        "sentiment_counts": sentiment_counts,
        "aspect_sentiment": {k: dict(v) for k, v in aspect_sentiment.items()},
        "top_positive_terms": _top_terms(positive_texts, limit=8),
        "top_negative_terms": _top_terms(negative_texts, limit=8),
        "negative_themes": _cluster_negative_themes(negative_texts),
        "dataframe": df,
    }


def save_reviews_csv(reviews, output_path="amazon_reviews.csv"):
    if not reviews:
        pd.DataFrame().to_csv(output_path, index=False, encoding="utf-8")
        return output_path

    enriched = _enrich_reviews(reviews)
    df = pd.DataFrame(enriched)
    df.to_csv(output_path, index=False, encoding="utf-8")
    return output_path


def _top_aspects(summary, sentiment_key, top_n=3):
    aspect_sentiment = summary.get("aspect_sentiment", {})
    scores = []

    for aspect, counts in aspect_sentiment.items():
        score = int(counts.get(sentiment_key, 0))
        if score > 0:
            scores.append((aspect, score))

    scores.sort(key=lambda item: item[1], reverse=True)
    return scores[:top_n]


def save_insight_reports(summary, txt_path="report.txt", json_path="report.json"):
    sentiment_counts = summary.get("sentiment_counts", {})
    strengths = _top_aspects(summary, "positive", top_n=3)
    complaints = _top_aspects(summary, "negative", top_n=3)
    positive_terms = summary.get("top_positive_terms", [])
    negative_terms = summary.get("top_negative_terms", [])
    negative_themes = summary.get("negative_themes", [])

    report_data = {
        "total_reviews": summary.get("total_reviews", 0),
        "average_rating": summary.get("average_rating"),
        "sentiment_counts": sentiment_counts,
        "top_strengths": [{"aspect": name, "mentions": count} for name, count in strengths],
        "top_complaints": [{"aspect": name, "mentions": count} for name, count in complaints],
        "top_positive_terms": positive_terms,
        "top_negative_terms": negative_terms,
        "negative_themes": negative_themes,
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=True)

    lines = [
        "Amazon Review Insight Report",
        "=" * 28,
        f"Total reviews: {report_data['total_reviews']}",
        f"Average rating: {report_data['average_rating']}",
        f"Sentiment counts: {report_data['sentiment_counts']}",
        "",
        "Top Strengths:",
    ]

    if strengths:
        lines.extend([f"- {name}: {count} positive mentions" for name, count in strengths])
    else:
        lines.append("- No strong strengths identified.")

    lines.append("")
    lines.append("Top Complaints:")
    if complaints:
        lines.extend([f"- {name}: {count} negative mentions" for name, count in complaints])
    else:
        lines.append("- No major complaints identified.")

    lines.append("")
    lines.append("Top Positive Terms:")
    if positive_terms:
        lines.extend([f"- {term}: {count}" for term, count in positive_terms[:8]])
    else:
        lines.append("- No positive terms available.")

    lines.append("")
    lines.append("Top Negative Terms:")
    if negative_terms:
        lines.extend([f"- {term}: {count}" for term, count in negative_terms[:8]])
    else:
        lines.append("- No negative terms available.")

    lines.append("")
    lines.append("Negative Themes:")
    if negative_themes:
        for theme in negative_themes:
            lines.append(
                f"- Cluster {theme.get('cluster')}: {theme.get('count')} reviews, keywords={theme.get('keywords')}"
            )
    else:
        lines.append("- No clustered negative themes found.")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return txt_path, json_path
