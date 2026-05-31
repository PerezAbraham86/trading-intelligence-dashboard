# api/main.py patch — make MES cleaner and add 10m support

Apply these replacements in `api/main.py`.

This keeps BTCUSD and MES1! using the same frontend route:

`/api/historical-candles?symbol=<symbol>&timeframe=<tf>&limit=500`

The provider difference stays backend-side:
- BTCUSD -> Alpaca crypto first, then Yahoo fallback.
- MES1! -> InsightSentry futures first, then 1m resample fallback.

Do not edit the dashboard page for this patch.

────────────────────────────────────────
1) Replace the InsightSentry env block
────────────────────────────────────────

Find:

```py
INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY", "")
    or os.getenv("RAPIDAPI_KEY", "")
    or os.getenv("X_RAPIDAPI_KEY", "")
)
INSIGHTSENTRY_HOST = os.getenv("INSIGHTSENTRY_HOST", "insightsentry.p.rapidapi.com")
```

Replace with:

```py
INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY", "")
    or os.getenv("INSIGHTSENTRY_RAPIDAPI_KEY", "")
    or os.getenv("RAPIDAPI_KEY", "")
    or os.getenv("X_RAPIDAPI_KEY", "")
)
INSIGHTSENTRY_HOST = (
    os.getenv("INSIGHTSENTRY_HOST", "")
    or os.getenv("INSIGHTSENTRY_RAPIDAPI_HOST", "")
    or "insightsentry.p.rapidapi.com"
)
```

────────────────────────────────────────
2) Add 10m to normalize_timeframe()
────────────────────────────────────────

Find this section inside `normalize_timeframe`:

```py
"5": "5m", "5m": "5m", "5min": "5m",
"15": "15m", "15m": "15m", "15min": "15m",
```

Replace with:

```py
"5": "5m", "5m": "5m", "5min": "5m", "5minute": "5m",
"10": "10m", "10m": "10m", "10min": "10m", "10minute": "10m",
"15": "15m", "15m": "15m", "15min": "15m", "15minute": "15m",
```

────────────────────────────────────────
3) Add 10m to timeframe_seconds()
────────────────────────────────────────

Find:

```py
"5m": 300,
"15m": 900,
```

Replace with:

```py
"5m": 300,
"10m": 600,
"15m": 900,
```

────────────────────────────────────────
4) Add 10m to alpaca_timeframe()
────────────────────────────────────────

Find:

```py
"5m": "5Min",
"15m": "15Min",
```

Replace with:

```py
"5m": "5Min",
"10m": "10Min",
"15m": "15Min",
```

────────────────────────────────────────
5) Add 10m to yfinance helpers
────────────────────────────────────────

Inside `yfinance_interval`, find:

```py
"5m": "5m",
"15m": "15m",
```

Replace with:

```py
"5m": "5m",
"10m": "5m",
"15m": "15m",
```

Inside `yfinance_period`, find:

```py
if tf in {"1m", "3m", "5m", "15m", "30m"}:
```

Replace with:

```py
if tf in {"1m", "3m", "5m", "10m", "15m", "30m"}:
```

Note:
Yahoo does not reliably support native 10m. The dashboard should use Alpaca for BTCUSD first and InsightSentry/resample for MES1!. Yahoo is only a fallback.

────────────────────────────────────────
6) Add 10m to insightsentry_interval_candidates()
────────────────────────────────────────

Find:

```py
"5m": ["5min", "5m", "5"],
"15m": ["15min", "15m", "15"],
```

Replace with:

```py
"5m": ["5min", "5m", "5"],
"10m": ["10min", "10m", "10"],
"15m": ["15min", "15m", "15"],
```

────────────────────────────────────────
7) Optional but recommended: update the root engine label
────────────────────────────────────────

Find:

```py
"engine": "main_v5_insightsentry_futures_all_timeframes",
```

Replace with:

```py
"engine": "main_v6_clean_candle_route_btc_mes_10m",
```

────────────────────────────────────────
8) Test these URLs after Render redeploy
────────────────────────────────────────

```txt
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=BTCUSD&timeframe=1m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=BTCUSD&timeframe=5m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=BTCUSD&timeframe=10m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=BTCUSD&timeframe=15m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=BTCUSD&timeframe=30m&limit=500

https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=1m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=5m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=10m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=15m&limit=500
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=30m&limit=500
```

Expected:
Each response should return real candles with count > 0.
