from utils import get_product_id
from scraper import fetch_html, extract_html, parse_reviews, is_blocked


def main():
    url = input("Enter Amazon product URL: ")

    product_id = get_product_id(url)

    if not product_id:
        print("Invalid Amazon URL ❌")
        return

    review_url = f"https://www.amazon.in/product-reviews/{product_id}"

    print("Fetching reviews...")

    # 🔹 Step 1: API call
    api_response = fetch_html(review_url)

    if api_response is None:
        print("API request failed ❌")
        return

    # 🔹 Step 2: Extract HTML
    html = extract_html(api_response)

    if html is None:
        print("Failed to extract HTML ❌")
        return

    # 🔹 Step 3: Check blocking
    if is_blocked(html):
        print("Blocked by Amazon ❌")
        return

    # 🔹 Step 4: Parse reviews
    reviews = parse_reviews(html)

    print(f"\nFound {len(reviews)} reviews\n")

    for r in reviews[:5]:
        print(r)
        print("-" * 50)


if __name__ == "__main__":
    main()