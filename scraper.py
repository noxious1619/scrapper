import os
import re

import requests

LAST_FETCH_ERROR = ""


def fetch_product_data(product_id, domain="in", geo_location=None):
    global LAST_FETCH_ERROR
    LAST_FETCH_ERROR = ""

    username = os.getenv("OXYLABS_USERNAME")
    password = os.getenv("OXYLABS_PASSWORD")

    if not username or not password:
        LAST_FETCH_ERROR = "Missing Oxylabs credentials. Set OXYLABS_USERNAME and OXYLABS_PASSWORD."
        print(LAST_FETCH_ERROR)
        return None

    payload = {
        "source": "amazon_product",
        "query": product_id,
        "domain": domain,
        "parse": True,
    }
    if geo_location:
        payload["geo_location"] = geo_location

    try:
        response = requests.post(
            "https://realtime.oxylabs.io/v1/queries",
            auth=(username, password),
            json=payload,
            timeout=60,
        )
    except requests.RequestException as exc:
        LAST_FETCH_ERROR = f"Request error: {exc}"
        print(LAST_FETCH_ERROR)
        return None

    if response.status_code != 200:
        LAST_FETCH_ERROR = f"Oxylabs error {response.status_code}: {response.text}"
        print("Error:", response.status_code)
        print("Response:", response.text)
        return None

    return response.json()


def extract_content(api_response):
    try:
        return api_response["results"][0]["content"]
    except (KeyError, IndexError, TypeError):
        return None


def parse_rating(rating_value):
    if isinstance(rating_value, (int, float)):
        return float(rating_value)

    match = re.search(r"(\d+(?:\.\d+)?)", str(rating_value or ""))
    return float(match.group(1)) if match else None


def _get_value(data, keys):
    for key in keys:
        value = data.get(key)
        if value:
            return value
    return ""


def parse_reviews(content):
    if not isinstance(content, dict):
        return []

    reviews = []
    raw_reviews = content.get("reviews", [])

    if not isinstance(raw_reviews, list):
        return []

    for item in raw_reviews:
        if not isinstance(item, dict):
            continue

        title = _get_value(item, ["title", "review_title"])
        review = _get_value(item, ["content", "review", "review_text", "text"])
        rating_value = _get_value(item, ["rating", "score", "stars"])
        rating = parse_rating(rating_value)
        rating_text = str(rating_value) if rating_value != "" else ""
        author = _get_value(item, ["author", "user_name", "reviewer"])
        date = _get_value(item, ["date", "review_date"])
        verified = bool(_get_value(item, ["verified_purchase", "is_verified"]))
        helpful = _get_value(item, ["helpful_votes", "helpful_count", "helpful"])
        review_id = _get_value(item, ["id", "review_id"])
        images = item.get("images", [])

        if not review:
            continue

        helpful_count = 0
        try:
            helpful_count = int(re.search(r"\d+", str(helpful)).group(0)) if helpful else 0
        except Exception:
            helpful_count = 0

        if not isinstance(images, list):
            images = []

        reviews.append({
            "id": str(review_id).strip() if review_id else "",
            "author": str(author).strip(),
            "title": title,
            "rating": rating,
            "rating_text": rating_text,
            "date": str(date).strip(),
            "review": str(review).strip(),
            "verified_purchase": verified,
            "helpful_votes": helpful_count,
            "images": images[:4],
        })

    return reviews


def extract_product_header(content, fallback_product_id):
    if not isinstance(content, dict):
        return {
            "product_id": fallback_product_id,
            "title": "",
            "brand": "",
            "price": "",
            "image": "",
            "rating": None,
            "reviews_count": 0,
            "rating_distribution": {},
        }

    images = content.get("images") or []
    first_image = ""
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, str):
            first_image = first
        elif isinstance(first, dict):
            first_image = (
                first.get("high_res")
                or first.get("large")
                or first.get("url")
                or first.get("src")
                or ""
            )

    rating_distribution = content.get("rating_stars_distribution") or {}
    normalized_distribution = {}
    if isinstance(rating_distribution, dict):
        for key, value in rating_distribution.items():
            star = re.search(r"(\d)", str(key))
            if star:
                try:
                    normalized_distribution[star.group(1)] = float(value)
                except Exception:
                    normalized_distribution[star.group(1)] = 0.0

    return {
        "product_id": fallback_product_id,
        "title": str(content.get("title") or content.get("product_name") or ""),
        "brand": str(content.get("brand") or ""),
        "price": str(content.get("price") or content.get("price_buybox") or ""),
        "image": first_image,
        "rating": parse_rating(content.get("rating")),
        "reviews_count": int(content.get("reviews_count") or 0),
        "rating_distribution": normalized_distribution,
    }


def is_blocked(content):
    if content is None:
        return True

    text = str(content).lower()
    keywords = ["sign-in", "captcha", "robot check", "enter the characters you see below"]

    for word in keywords:
        if word in text:
            return True

    return False
