# api/main.py — InsightSentry MES OHLCV Series Fix

Use this patch on your backend file:

api/main.py

Goal:
Make MES1! fetch candles like BTCUSD does: one clean backend candle route, exact selected timeframe, 500 candles, no fake relabeling.

Your RapidAPI test confirmed this working endpoint style:

/v3/symbols/{symbol}/series?bar_type=minute&bar_interval=1&extended=true&badj=true&dadj=false&dp=500&long_poll=false

So the backend must stop using:
interval=1min
limit=500

and must use:
bar_type=minute
bar_interval=1 / 5 / 10 / 15 / 30
dp=500

────────────────────────────────────────
1) Update InsightSentry environment names
────────────────────────────────────────

Find this block:

```py
INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY", "")
    or os.getenv("RAPIDAPI_KEY", "")
    or os.getenv("X_RAPIDAPI_KEY", "")
)
INSIGHTSENTRY_HOST = os.getenv("INSIGHTSENTRY_HOST", "insightsentry.p.rapidapi.com")
INSIGHTSENTRY_BASE_URL = f"https://{INSIGHTSENTRY_HOST}"
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
INSIGHTSENTRY_BASE_URL = f"https://{INSIGHTSENTRY_HOST}"
```

────────────────────────────────────────
2) Add 10m support to normalize_timeframe()
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

────────────────────────────────────────
6) Replace insightsentry_interval_candidates()
────────────────────────────────────────

Find the full function:

```py
def insightsentry_interval_candidates(timeframe: str) -> List[str]:
    tf = normalize_timeframe(timeframe)

    mapping = {
        "1m": ["1min", "1m", "1"],
        "3m": ["3min", "3m", "3"],
        "5m": ["5min", "5m", "5"],
        "15m": ["15min", "15m", "15"],
        "30m": ["30min", "30m", "30"],
        "1h": ["1h", "60min", "60m", "60"],
        "2h": ["2h", "120min", "120m", "120"],
        "4h": ["4h", "240min", "240m", "240"],
        "1d": ["1day", "1d", "day", "D"],
        "1w": ["1week", "1w", "week", "W"],
    }

    return mapping.get(tf, [tf])
```

Replace it with:

```py
def insightsentry_interval_candidates(timeframe: str) -> List[str]:
    """
    Dashboard-supported InsightSentry candle intervals.

    Important:
    InsightSentry Time Series OHLCV uses bar_type + bar_interval, not interval=5min.
    We keep this function simple so fetch_insightsentry_direct_candles only tries
    the exact requested dashboard timeframe.
    """
    tf = normalize_timeframe(timeframe)
    allowed = {"1m", "5m", "10m", "15m", "30m"}
    return [tf] if tf in allowed else ["1m"]
```

────────────────────────────────────────
7) Add these helpers BEFORE build_insightsentry_urls()
────────────────────────────────────────

Place this code right above:

```py
def build_insightsentry_urls(api_symbol: str, api_interval: str, limit: int) -> List[str]:
```

Add:

```py
def insightsentry_bar_type_interval(timeframe: str) -> Tuple[str, int]:
    """
    Convert dashboard timeframe to InsightSentry OHLCV query params.

    InsightSentry expects:
    bar_type=minute
    bar_interval=1, 5, 10, 15, 30
    """
    tf = normalize_timeframe(timeframe)
    mapping = {
        "1m": ("minute", 1),
        "5m": ("minute", 5),
        "10m": ("minute", 10),
        "15m": ("minute", 15),
        "30m": ("minute", 30),
    }
    return mapping.get(tf, ("minute", 1))


def candles_match_requested_timeframe(candles: List[Dict[str, Any]], timeframe: str) -> bool:
    """
    Guardrail:
    Never accept daily/session-spaced candles labeled as 1m, 5m, 10m, 15m, or 30m.

    The old MES route accepted daily-spaced bars and labeled them as the requested
    timeframe. This validator rejects that.
    """
    if len(candles) < 3:
        return True

    expected = timeframe_seconds(timeframe)
    if expected <= 0:
        return True

    epochs = sorted(
        int(to_epoch_seconds(c.get("epoch") or c.get("time") or c.get("timestamp")))
        for c in candles
        if to_epoch_seconds(c.get("epoch") or c.get("time") or c.get("timestamp")) > 0
    )

    if len(epochs) < 3:
        return True

    diffs = [epochs[i] - epochs[i - 1] for i in range(1, len(epochs)) if epochs[i] > epochs[i - 1]]
    if not diffs:
        return False

    # Ignore large overnight/weekend/session gaps. We only need enough normal
    # candle-to-candle gaps to prove the returned bars are intraday.
    max_normal_gap = max(expected * 6, 3600)
    normal_diffs = [d for d in diffs if 0 < d <= max_normal_gap]

    if not normal_diffs:
        return False

    normal_diffs = sorted(normal_diffs)
    median_gap = normal_diffs[len(normal_diffs) // 2]

    return expected * 0.5 <= median_gap <= expected * 2.5
```

────────────────────────────────────────
8) Replace build_insightsentry_urls()
────────────────────────────────────────

Find the full function:

```py
def build_insightsentry_urls(api_symbol: str, api_interval: str, limit: int) -> List[str]:
    encoded_path_symbol = quote(api_symbol, safe="")
    common_params = {
        "symbol": api_symbol,
        "code": api_symbol,
        "interval": api_interval,
        "timeframe": api_interval,
        "limit": limit,
    }

    # Keep the working endpoint first. Additional endpoints are defensive fallbacks
    # for RapidAPI/InsightSentry naming differences.
    return [
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/series?{urlencode({'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/time-series?{urlencode({'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/time-series?{urlencode({'symbol': api_symbol, 'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/ohlcv?{urlencode({'symbol': api_symbol, 'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/historical?{urlencode({'symbol': api_symbol, 'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/historical?{urlencode({'interval': api_interval, 'limit': limit})}",
    ]
```

Replace with:

```py
def build_insightsentry_urls(api_symbol: str, api_interval: str, limit: int) -> List[str]:
    encoded_path_symbol = quote(api_symbol, safe="")
    bar_type, bar_interval = insightsentry_bar_type_interval(api_interval)
    safe_limit = max(1, min(int(limit or 500), 5000))

    series_params = {
        "bar_type": bar_type,
        "bar_interval": bar_interval,
        "extended": "true",
        "badj": "true",
        "dadj": "false",
        "dp": safe_limit,
        "long_poll": "false",
    }

    # This is the RapidAPI-tested Time Series (OHLCV) endpoint.
    # It returns true intraday MES bars when using bar_type + bar_interval.
    return [
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/series?{urlencode(series_params)}",
    ]
```

────────────────────────────────────────
9) Patch fetch_insightsentry_direct_candles()
────────────────────────────────────────

Inside `fetch_insightsentry_direct_candles`, find this block:

```py
            candles = filter_valid_candles_for_symbol(merge_candles_by_time(candles), normalized_symbol)

            if candles:
                print(
                    f"[InsightSentry] frontend_symbol={symbol} normalized={normalized_symbol} "
                    f"api_symbol={api_symbol} timeframe={normalized_timeframe} api_interval={api_interval} "
                    f"count={len(candles)}"
                )
                return candles[-safe_limit:]

            last_error = f"No bars parsed from {url}"
```

Replace with:

```py
            candles = filter_valid_candles_for_symbol(merge_candles_by_time(candles), normalized_symbol)

            if candles:
                if not candles_match_requested_timeframe(candles, normalized_timeframe):
                    last_error = (
                        f"Rejected wrong spacing from {url}; "
                        f"requested={normalized_timeframe}; count={len(candles)}"
                    )
                    print(f"[InsightSentry] {last_error}")
                    continue

                print(
                    f"[InsightSentry] frontend_symbol={symbol} normalized={normalized_symbol} "
                    f"api_symbol={api_symbol} timeframe={normalized_timeframe} api_interval={api_interval} "
                    f"count={len(candles)}"
                )
                return candles[-safe_limit:]

            last_error = f"No bars parsed from {url}"
```

────────────────────────────────────────
10) Optional but recommended root label
────────────────────────────────────────

Find:

```py
"engine": "main_v5_insightsentry_futures_all_timeframes",
```

Replace with:

```py
"engine": "main_v7_insightsentry_ohlcv_series_btc_mes",
```

────────────────────────────────────────
11) Deploy + test
────────────────────────────────────────

Commit and deploy Render.

Then test:

```txt
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=1m&limit=20
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=5m&limit=20
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=10m&limit=20
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=15m&limit=20
https://trading-intelligence-dashboard.onrender.com/api/historical-candles?symbol=MES1!&timeframe=30m&limit=20
```

Expected spacing:

```txt
1m  = timestamps every 1 minute
5m  = timestamps every 5 minutes
10m = timestamps every 10 minutes
15m = timestamps every 15 minutes
30m = timestamps every 30 minutes
```

If these pass, MES will finally behave like BTCUSD on the frontend.
