import re

import requests


def _expand_amzn_short_url(value):
    if not re.search(r"^https?://(?:www\.)?amzn\.in/", value, re.IGNORECASE):
        return value

    try:
        response = requests.get(value, allow_redirects=True, timeout=20)
        return response.url or value
    except requests.RequestException:
        return value


def get_product_id(url):
    value = (url or "").strip()

    if re.fullmatch(r"[A-Za-z0-9]{10}", value):
        return value.upper()

    value = _expand_amzn_short_url(value)

    patterns = [
        r"/dp/([A-Za-z0-9]{10})",
        r"/gp/product/([A-Za-z0-9]{10})",
        r"/product/([A-Za-z0-9]{10})",
    ]

    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            return match.group(1).upper()

    return None
