# Trading Intelligence API

FastAPI backend for receiving TradingView webhook alerts and serving live trading signals to the dashboard.

## Features

- Receives TradingView webhook alerts with trading signals
- Optional webhook secret validation for security
- In-memory storage of latest signal and recent signals (up to 50)
- CORS support for dashboard frontend
- RESTful API endpoints
- Ready to deploy on Render

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. (Optional) Set your `WEBHOOK_SECRET` in `.env` for webhook validation.

## Running Locally

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.

View interactive API docs at `http://localhost:8000/docs`.

## API Endpoints

### 1. Health Check
```
GET /
```
Returns: `{"status": "ok", "service": "Trading Intelligence API"}`

### 2. Receive TradingView Webhook
```
POST /webhook/tradingview
```

Request body:
```json
{
  "secret": "optional_webhook_secret",
  "symbol": "ES1!",
  "timeframe": "5m",
  "signal": "BUY",
  "confidence": 82,
  "bullScore": 78,
  "bearScore": 22,
  "netBias": 56,
  "price": 4575.25,
  "smc": "Bullish iBOS",
  "alphax": "Liquidity Bullish",
  "ghost": "Bullish Projection",
  "openInterest": "Bullish Buildup",
  "footprint": "Positive Delta",
  "session": "RTH Valid",
  "fredMacro": "Neutral",
  "finraShortVolume": "Medium Squeeze Risk",
  "cot": "Bullish Background",
  "warnings": []
}
```

Returns: `{"ok": true, "message": "signal received"}`

**Note:** The `createdAt` timestamp in UTC is automatically added by the API.

### 3. Get Latest Signal
```
GET /api/latest-signal
```

Returns the most recent signal received. If no signal has been received, returns a default waiting signal.

Example response:
```json
{
  "symbol": "ES1!",
  "timeframe": "5m",
  "signal": "BUY",
  "confidence": 82,
  "bullScore": 78,
  "bearScore": 22,
  "netBias": 56,
  "price": 4575.25,
  "smc": "Bullish iBOS",
  "alphax": "Liquidity Bullish",
  "ghost": "Bullish Projection",
  "openInterest": "Bullish Buildup",
  "footprint": "Positive Delta",
  "session": "RTH Valid",
  "fredMacro": "Neutral",
  "finraShortVolume": "Medium Squeeze Risk",
  "cot": "Bullish Background",
  "warnings": [],
  "createdAt": "2026-05-17T14:30:45.123456+00:00"
}
```

### 4. Get Recent Signals
```
GET /api/recent-signals
```

Returns an array of up to 50 most recent signals.

## CORS Configuration

The API supports CORS requests from:
- `https://trading-intelligence-dashboard.vercel.app`
- `http://localhost:3000`

## Deployment on Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set the **Start Command** to:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
4. Set the **Root Directory** to `api/`
5. Add environment variables as needed (e.g., `WEBHOOK_SECRET`)

## Environment Variables

- `WEBHOOK_SECRET`: (Optional) Secret key for validating incoming webhooks. If set, all webhook requests must include this secret or will be rejected with a 401 error.

## Signal Schema

All signals follow this schema:

| Field | Type | Description |
|-------|------|-------------|
| symbol | string | Trading symbol (e.g., "ES1!") |
| timeframe | string | Chart timeframe (e.g., "5m", "1h") |
| signal | string | Signal type: BUY or SELL |
| confidence | integer | Confidence level 0-100 |
| bullScore | integer | Bullish score 0-100 |
| bearScore | integer | Bearish score 0-100 |
| netBias | integer | Net bias -100 to 100 |
| price | float | Current price |
| smc | string | Smart Money Concepts analysis |
| alphax | string | AlphaX indicator analysis |
| ghost | string | Ghost Level analysis |
| openInterest | string | Open Interest analysis |
| footprint | string | Footprint analysis |
| session | string | Session validity |
| fredMacro | string | FRED Macro analysis |
| finraShortVolume | string | FINRA Short Volume analysis |
| cot | string | COT (Commitments of Traders) analysis |
| warnings | array | Any trading warnings |
| createdAt | string | UTC ISO 8601 timestamp (auto-generated) |
