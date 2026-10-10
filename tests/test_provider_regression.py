"""Guard the IBKR-only boundary and disconnected application behavior."""
import ast
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import requests
from fastapi import HTTPException
from fastapi.testclient import TestClient
from api import ibkr_client as ib, main, site_cache_store

ROOT = Path(__file__).resolve().parents[1]


class ProviderBoundaryTests(unittest.TestCase):
    def test_legacy_integrations_cannot_return(self):
        forbidden = ("databento", "insightsentry", "rapidapi", "yfinance", "alpaca",
                     "yahoo", "stooq", "alphavantage", "api.polygon", "api.massive",
                     "api.binance", "okx.com", "api.stlouisfed", "api.finra")
        for folder in ("api", "app", "components", "hooks", "lib"):
            for path in (ROOT / folder).rglob("*"):
                if path.suffix not in {".py", ".ts", ".tsx", ".txt", ".md"}:
                    continue
                source = path.read_text().lower()
                for marker in forbidden:
                    self.assertNotIn(marker, source, f"Legacy provider in {path}")
        for name in ("requirements.txt", "package.json", "render.yaml", "README.md"):
            for marker in forbidden:
                self.assertNotIn(marker, (ROOT / name).read_text().lower(), name)

    def test_network_boundary_is_read_only(self):
        for filename in ("main.py", "external_data_engine.py"):
            tree = ast.parse((ROOT / "api" / filename).read_text())
            imports = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
            for node in imports:
                names = [node.module or ""] if isinstance(node, ast.ImportFrom) else [x.name for x in node.names]
                self.assertFalse(any(name.startswith(("requests", "urllib.request", "httpx")) for name in names))
        with patch.object(ib._SESSION, "get") as get:
            for path in ("/iserver/account/123/orders", "/iserver/account/123/order/456"):
                with self.assertRaises(HTTPException):
                    ib.request_json(path)
            get.assert_not_called()


class DisconnectedTests(unittest.TestCase):
    def setUp(self):
        ib._CACHE.clear()
        ib._RETRY_AT = 0
        self.env = patch.dict(os.environ, {"IBKR_CONID_MAP": "{}", "IBKR_MES_CONID": ""})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_missing_contract_never_contacts_gateway(self):
        with patch.object(ib, "IBKR_BASE_URL", "https://gateway.example/v1/api"), patch.object(ib._SESSION, "get") as get:
            self.assertFalse(ib.connection_status("MES")["ready"])
            self.assertEqual(ib.get_quote()["status"], "IBKR Not Connected")
            self.assertEqual(ib.get_historical_ohlcv()["candles"], [])
            get.assert_not_called()

    def test_network_failure_is_backed_off(self):
        with patch.dict(os.environ, {"IBKR_CONID_MAP": '{"MES1!":123456}'}), patch.object(ib, "IBKR_BASE_URL", "https://gateway.example/v1/api"), patch.object(ib._SESSION, "get", side_effect=requests.ConnectionError("offline")) as get:
            for _ in range(5):
                self.assertFalse(ib.get_quote()["isRealtime"])
                self.assertEqual(ib.get_historical_ohlcv()["candles"], [])
            self.assertEqual(get.call_count, 1)
            self.assertGreater(ib._RETRY_AT, 0)

    def test_startup_and_existing_routes_without_gateway(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(site_cache_store, "DB_PATH", Path(directory) / "cache.sqlite3"), patch.object(ib, "IBKR_BASE_URL", ""), patch.object(ib._SESSION, "get") as get:
            with TestClient(main.app) as client:
                self.assertEqual(client.get("/health").status_code, 200)
                self.assertEqual(client.get("/health").json()["ibkr"]["status"], "IBKR Not Connected")
                for path in ("/api/candles", "/api/historical-candles", "/api/ibkr/history", "/api/live-price", "/api/live-candle", "/api/latest-sentiment", "/api/live-feed/latest", "/api/ibkr/status", "/api/preload-candles", "/api/candle-warehouse/update-now", "/api/engine-state", "/api/dashboard/snapshot", "/api/sp500-heatmap", "/api/ticker-news", "/api/macro"):
                    response = client.get(path, params={"symbol": "MES1!", "timeframe": "1m"})
                    self.assertEqual(response.status_code, 200, (path, response.text[:300]))
                self.assertEqual(client.get("/api/candles").json()["candles"], [])
                self.assertEqual(client.get("/api/dashboard/snapshot").json()["status"], "IBKR Not Connected")
                self.assertIsNone(client.get("/api/live-candle").json()["candle"])
                for name in ("status", "cost", "candles"):
                    self.assertEqual(client.get("/api/databento/" + name).status_code, 404)
            get.assert_not_called()

    def test_saved_history_remains_historical_when_disconnected(self):
        saved = {"provider": "ibkr", "source": "ibkr_historical_ohlcv", "candles": [{"epoch": 1700000040, "close": 5001}], "isLive": True}
        with patch.object(main, "candle_cache_best", return_value=saved), patch.object(ib, "IBKR_BASE_URL", ""):
            result = main.disconnected_candle_payload("MES1!", "1m")
        self.assertEqual(result["source"], saved["source"])
        self.assertEqual(result["candles"], saved["candles"])
        self.assertFalse(result["isLive"])
        self.assertEqual(result["freshness"], "stale")
        self.assertGreater(result["lastCandleAgeSeconds"], 0)
        self.assertTrue(saved["isLive"])
