import re

def get_product_id(url):
    match = re.search(r'/dp/([A-Z0-9]{10})', url)
    
    if not match:
        match = re.search(r'/product/([A-Z0-9]{10})', url)
    
    return match.group(1) if match else None