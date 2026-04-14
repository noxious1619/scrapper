import requests
from bs4 import BeautifulSoup


# 🔹 Fetch HTML using Oxylabs
def fetch_html(review_url):
    payload = {
        "source": "amazon",
        "url": review_url,
        "geo_location": "110001",
        "render": "html"   # 🔥 IMPORTANT
    }

    response = requests.post(
        "https://realtime.oxylabs.io/v1/queries",
        auth=("thenoxious_1_rx8pC", "Instagram_1619"),
        json=payload
    )

    if response.status_code != 200:
        print("Error:", response.status_code)
        print("Response:", response.text)
        return None

    return response.json()


# 🔹 Extract HTML safely
def extract_html(api_response):
    try:
        return api_response['results'][0]['content']
    except (KeyError, IndexError, TypeError):
        return None


# 🔹 Parse reviews
def parse_reviews(html):
    soup = BeautifulSoup(html, "html.parser")
    
    reviews = []

    blocks = soup.find_all("div", {"data-hook": "review"})

    for block in blocks:
        title_tag = block.find("a", {"data-hook": "review-title"})
        rating_tag = block.find("i", {"data-hook": "review-star-rating"})
        body_tag = block.find("span", {"data-hook": "review-body"})

        reviews.append({
            "title": title_tag.text.strip() if title_tag else "",
            "rating": rating_tag.text.strip() if rating_tag else "",
            "review": body_tag.text.strip() if body_tag else ""
        })

    return reviews


# 🔹 Detect blocking
def is_blocked(html):
    if not html:
        return True

    keywords = ["Sign-In", "captcha", "robot check"]

    for word in keywords:
        if word.lower() in html.lower():
            return True

    return False