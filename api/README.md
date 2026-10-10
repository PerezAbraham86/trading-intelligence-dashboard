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
  "fredMacro": "Unavailable",
  "finraShortVolume": "Unavailable",
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
  "fredMacro": "Unavailable",
  "finraShortVolume": "Unavailable",
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

`CORS_ALLOWED_ORIGINS` contains exact, comma-separated frontend origins. Defaults:
`https://trading-intelligence-dashboard.onrender.com`,
`https://trading-intelligence-dashboard.vercel.app`, and `http://localhost:3000`.
Set the actual deployed frontend origin if different. Wildcards and credentialed
cross-origin cookies are not enabled. JSON GET/POST requests and preflights work.

## Deployment on the Existing Render Service

Keep the existing Python web service and plan. From the repository root, use
`pip install -r api/requirements.txt` as Build Command and
`uvicorn api.main:app --host 0.0.0.0 --port $PORT` as Start Command.
Deploy latest `main`; check `/health` and `/api/neural-brain/status`.

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
| fredMacro | string | Macro Data analysis |
| finraShortVolume | string | Short Volume analysis |
| cot | string | COT (Commitments of Traders) analysis |
| warnings | array | Any trading warnings |
| createdAt | string | UTC ISO 8601 timestamp (auto-generated) |

## Interactive Brokers market data

Futures history and live quotes use the read-only Client Portal Gateway adapter in
`api/ibkr_client.py`. The frontend calls the dashboard backend; gateway access and
sessions stay server-side. No broker order placement has been added.

1. Run Client Portal Gateway and sign in using IBKR's browser login/2FA. Keep its
   brokerage session active and check market-data permissions/subscriptions.
2. Set `IBKR_BASE_URL` to the authenticated gateway's HTTPS `/v1/api` URL reachable
   **from the backend**. A gateway on your PC's `localhost` is not reachable from
   Render. For hosted use, place the gateway and backend on the same private host
   or establish a private authenticated connection. Do not expose the gateway
   directly to the public internet.
3. Set `IBKR_CONID_MAP` to a JSON map such as `{"MES1!": <actual integer conid>}`.
   `IBKR_MES_CONID` is an optional shortcut. Futures IDs must identify the intended
   expiry; this adapter does not silently choose or roll a contract.
4. Trust the gateway certificate using `IBKR_CA_BUNDLE`. TLS verification is on by
   default. `IBKR_VERIFY_TLS=false` is accepted only for a loopback development
   gateway. Copy settings from `api/.env.example` into the backend environment.
5. Restart and check `/api/ibkr/status`, `/api/ibkr/history?symbol=MES1!&timeframe=1m`,
   `/api/live-feed/status`, and `/api/live-price?symbol=MES1!`.

`IBKR_HISTORY_PERIOD` defaults to a recent window (1 day for intraday bars);
`IBKR_HISTORY_CACHE_SECONDS` defaults to 60 seconds. IBKR's provider limits still
apply. This is contract-specific history, not back-adjusted continuous futures
history. Futures caches are isolated by IBKR contract ID so previous-provider
history and different expiries cannot be merged into the new feed.

Live quotes are shared/cached for five seconds and forwarded through the existing
SSE route. Historical OHLCV is cached. IBKR is the sole external market-data
provider for every symbol. No alternative quote, news, macro, options or crypto
feed is contacted. Data-dependent panels remain visible and report unavailable
until the matching IBKR input is configured. Brokerage orders are never submitted.

Startup is independent of gateway availability. Warmups skip unavailable symbols;
connection checks and failed requests use a retry cooldown. `/health` always reports
service health separately from IBKR connectivity. Cached history is labeled as
historical with its source, contract ID and last-candle age. It is never marked live.

Remove the previous market-data provider's keys and host settings from the hosting
dashboard separately, and cancel its subscription if no longer needed. Repository
changes cannot delete deployed secrets or cancel external billing.

Verification: `python -m unittest discover -s tests -v` and `npx tsc --noEmit`.
IBKR reference: https://www.interactivebrokers.com/docs/web-api/api-reference/trading/trading-market-data/get-md-history

## Neural Brain server ownership and memory

The existing `/api/neural-brain/predict`, `/status`, `/snapshots` and `/outcomes`
paths run on FastAPI. Prediction retains the weighted candle/SMC/AlphaX/Ghost
scorecard and the original five-task feature-based logistic learner, its L2
regularization, readiness threshold and 72/28 blend. This is observer/scorer
functionality only. Outcomes update weights and retain excursion/result labels.
Retrying an outcome does not train it twice. Snapshot filters support symbol and
timeframe. Existing SQLite rows and symbol/timeframe outcome statistics remain.

Snapshot/outcome memory and logistic weights share `NEURAL_BRAIN_DB_PATH`
(default `.data/neural_brain_memory.sqlite3`). The old scope-statistics model
location is unchanged. Free Render local storage is ephemeral: this change does
not provide cross-deployment durability or add a paid disk/storage service.
`GET /api/neural-brain/export` downloads snapshots, labels, exact logistic weights
and scope statistics. Keep that backup before any restart/redeploy that discards
local storage. Existing Next.js server files, when available, can be imported
without changing IDs, dropping labels, or retraining already learned weights:

```bash
python -m api.migrate_neural_brain --snapshots /path/neural_brain_snapshots.jsonl --model /path/neural_brain_online_model.json
# Restore a FastAPI export into an empty destination data directory:
python -m api.migrate_neural_brain --snapshots /path/neural_brain_backup.json
```

Run imports in the backend environment with its existing data directory. Sources
remain untouched; imports refuse to replace existing learned models. No automatic
reset or reduced prediction fallback is used. Migration does not automatically
retrieve files from an old hosting account. If durable automatic retention across
free Render deployments is required, an existing durable storage destination must
be supplied; none is provisioned by this change.
