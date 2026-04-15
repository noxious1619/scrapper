# Amazon Review Analysis

This project fetches Amazon India product data through Oxylabs (`amazon_product` with `domain: in` and `parse: true`), extracts review details, runs hybrid sentiment analysis, and saves the result to `amazon_reviews.csv`.

## Setup

Install dependencies:

```powershell
python -m pip install -r requirements.txt
```

Set Oxylabs credentials before running:

```powershell
$env:OXYLABS_USERNAME="your_username"
$env:OXYLABS_PASSWORD="your_password"
```

## Run

```powershell
python main.py
```

Paste an Amazon product URL or ASIN when asked. Supported inputs include:

- `https://www.amazon.in/.../dp/PRODUCTID`
- `https://www.amazon.in/gp/product/PRODUCTID`
- `https://www.amazon.in/product/PRODUCTID`
- `B07FZ8S74R`

## Output

The script prints:

- total reviews found
- average rating
- sentiment counts (positive, neutral, negative)
- aspect-wise sentiment distribution (price, quality, delivery, and more)
- top positive and negative terms
- negative complaint themes from clustering
- first five parsed reviews

It also writes all parsed reviews to `amazon_reviews.csv`.
It also writes analysis reports to `report.txt` and `report.json`.

## Analysis Engine

The analyzer uses:

- RoBERTa sentiment model (`cardiffnlp/twitter-roberta-base-sentiment-latest`) when explicitly enabled
- sarcasm-aware adjustment rules for obvious polarity flips
- rating-aware conflict adjustment
- aspect extraction by keyword mapping
- TF-IDF + KMeans clustering for negative-review themes

Default mode is safe fallback (no transformers import), so it works even on environments with torch/numpy conflicts.

To force fallback mode explicitly:

```powershell
$env:DISABLE_TRANSFORMERS="1"
python main.py
```

To enable RoBERTa mode:

```powershell
$env:ENABLE_TRANSFORMERS="1"
python main.py
```

## Web App Run

Start backend API first:

```powershell
uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```

Then in another terminal start frontend:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173` and analyze a product URL.

## Important

Do not commit real API usernames or passwords. Keep Oxylabs credentials in environment variables only.
