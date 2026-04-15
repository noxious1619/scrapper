from analysis import analyze_reviews, save_insight_reports, save_reviews_csv
from scraper import extract_content, fetch_product_data, is_blocked, parse_reviews
from utils import get_product_id


def main():
    value = input("Enter Amazon product URL or ASIN: ").strip()

    product_id = get_product_id(value)

    if not product_id:
        print("Invalid Amazon URL or ASIN.")
        return

    print("Fetching reviews...")

    api_response = fetch_product_data(product_id, domain="in")

    if api_response is None:
        print("API request failed.")
        return

    content = extract_content(api_response)

    if content is None:
        print("Failed to extract parsed content.")
        return

    if is_blocked(content):
        print("Blocked by Amazon.")
        return

    reviews = parse_reviews(content)

    if not reviews:
        print("No reviews returned for this product right now.")
        print("Try again later or test another ASIN.")
        return

    summary = analyze_reviews(reviews)
    output_path = save_reviews_csv(reviews)
    txt_report_path, json_report_path = save_insight_reports(summary)

    print(f"\nFound {len(reviews)} reviews\n")
    print("Analysis summary")
    print(f"Total reviews: {summary['total_reviews']}")
    print(f"Average rating: {summary['average_rating']}")
    print(f"Sentiment counts: {summary['sentiment_counts']}")
    print(f"Aspect sentiment: {summary['aspect_sentiment']}")
    print(f"Top positive terms: {summary['top_positive_terms']}")
    print(f"Top negative terms: {summary['top_negative_terms']}")
    print(f"Negative themes: {summary['negative_themes']}")
    print(f"Saved CSV: {output_path}\n")
    print(f"Saved report: {txt_report_path}")
    print(f"Saved report JSON: {json_report_path}\n")

    for review in reviews[:5]:
        print(review)
        print("-" * 50)


if __name__ == "__main__":
    main()
