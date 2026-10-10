import asyncio
import os
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from api import ibkr_client as ib
from api import main
from api import external_data_engine as external


class IBKRTests(unittest.TestCase):
    def setUp(self):
        ib._CACHE.clear()
        self.env = patch.dict(os.environ, {"IBKR_CONID_MAP": '{"MES1!": 123456}', "IBKR_VERIFY_TLS": "true"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def history(self):
        return {"barLength": 60, "data": [{"t": 1700000040000, "o": 5000, "h": 5002, "l": 4999, "c": 5001, "v": 17}]}

    def test_unconfigured_has_no_outbound_calls(self):
        with patch.object(ib, "IBKR_BASE_URL", ""), patch.object(ib._SESSION, "get") as get:
            self.assertEqual(ib.session_status()["status"], "not_configured")
            with self.assertRaises(HTTPException) as ctx:
                ib.request_json("/iserver/auth/status")
            self.assertEqual(ctx.exception.status_code, 503)
            get.assert_not_called()

    def test_exact_contract_required(self):
        with patch.dict(os.environ, {"IBKR_CONID_MAP": "{}", "IBKR_MES_CONID": ""}):
            with self.assertRaises(HTTPException):
                ib.contract_id("MES")
        self.assertEqual(ib.contract_id("CME_MINI:MES1!"), 123456)

    def test_normalized_cached_history_is_contract_specific(self):
        with patch.object(ib, "ensure_session"), patch.object(ib, "request_json", return_value=self.history()) as request:
            payload = ib.get_historical_ohlcv("MES", "1m")
            again = ib.get_historical_ohlcv("MES", "1m")
            self.assertEqual(payload["candles"][0]["epoch"], 1700000040)
            self.assertEqual(payload["candles"][0]["volume"], 17)
            self.assertEqual(payload["candles"][0]["conid"], 123456)
            self.assertFalse(again["continuousContract"])
            self.assertEqual(request.call_count, 1)
            with patch.dict(os.environ, {"IBKR_CONID_MAP": '{"MES1!": 987654}'}):
                ib.get_historical_ohlcv("MES", "1m")
                self.assertEqual(request.call_count, 2)

    def test_wrong_interval_is_rejected(self):
        with patch.object(ib, "ensure_session"), patch.object(ib, "request_json", return_value=self.history()):
            with self.assertRaises(HTTPException):
                ib.get_historical_ohlcv("MES", "5m")

    def test_delayed_quote_does_not_emit_a_live_candle(self):
        rows = [{"conid": 123456, "31": "5,001", "6509": "D", "_updated": time.time() * 1000}]
        with patch.object(ib, "ensure_session"), patch.object(ib, "request_json", return_value=rows), patch.object(ib, "get_historical_ohlcv") as history:
            payload = ib.get_latest_live_snapshot()
            self.assertEqual(payload["status"], "Delayed")
            self.assertIsNone(payload["candle"])
            history.assert_not_called()

    def test_preflight_and_stale_quote_are_not_realtime(self):
        for row in [{"conid": 123456}, {"conid": 123456, "31": "5001", "6509": "R", "_updated": (time.time() - 120) * 1000}]:
            ib._CACHE.clear()
            with patch.object(ib, "ensure_session"), patch.object(ib, "request_json", return_value=[row]):
                self.assertFalse(ib.get_quote()["isRealtime"])

    def test_live_quote_uses_correct_bid_ask_sizes(self):
        row = {"conid": 123456, "31": "5,001", "84": "5000", "86": "5002", "88": "10", "85": "20", "6509": "RpB", "_updated": time.time() * 1000}
        with patch.object(ib, "ensure_session"), patch.object(ib, "request_json", return_value=[row]):
            quote = ib.get_quote()
            self.assertTrue(quote["isRealtime"])
            self.assertEqual((quote["bidSize"], quote["askSize"]), (10, 20))
            self.assertIsNone(main.live_price_payload_to_candle(quote, "MES1!", "1m"))

    def test_tls_cannot_be_disabled_for_remote_gateway(self):
        with patch.object(ib, "IBKR_BASE_URL", "https://gateway.example/v1/api"), patch.dict(os.environ, {"IBKR_VERIFY_TLS": "false"}), patch.object(ib._SESSION, "get") as get:
            with self.assertRaises(HTTPException):
                ib.request_json("/iserver/auth/status")
            get.assert_not_called()

    def test_main_routes_and_cache_namespace(self):
        routes = {r.path for r in main.app.routes}
        self.assertIn("/api/ibkr/history", routes)
        self.assertNotIn("/api/live-feed/refresh-key", routes)
        key = main.candle_cache_key("candles", "MES1!", "1m", 0)
        self.assertTrue(key.startswith("ibkr::123456::"))
        with patch.dict(os.environ, {"IBKR_CONID_MAP": '{"MES1!": 987654}'}):
            self.assertNotEqual(key, main.candle_cache_key("candles", "MES1!", "1m", 0))

    def test_chart_router_and_options_unavailability(self):
        payload = {"provider": "ibkr", "source": "ibkr_historical_ohlcv", "candles": [{"time": "2026-10-10T12:00:00+00:00", "epoch": 1791633600, "open": 5000, "high": 5002, "low": 4999, "close": 5001, "volume": 17, "provider": "ibkr", "conid": 123456}]}
        with patch.object(main, "get_historical_ohlcv", return_value=payload):
            response = main.fetch_clean_provider_candles("MES1!", "1m")
            self.assertEqual(response["provider"], "ibkr")
            self.assertEqual(response["conid"], 123456)
            self.assertEqual(response["candles"][0]["conid"], 123456)
        self.assertEqual(external.build_ibkr_futures_options_context("MES1!")["status"], "unavailable")

    def test_chart_latest_close_and_cache_lookup(self):
        self.assertEqual(main.latest_candle_close([{"close": 5001}]), 5001)
        self.assertEqual(main.latest_candle_close(None), 0)
        old_key = "candles::MES1!::1m::0"
        current_key = main.candle_cache_key("candles", "MES1!", "1m", 0)
        with patch.object(main, "db_get_best_candle_payload", None), patch.object(main, "CANDLE_RESPONSE_CACHE", {old_key: {"candles": [{"close": 4000}]}}):
            self.assertIsNone(main.candle_cache_best("candles", "MES1!", "1m", 0))
            main.CANDLE_RESPONSE_CACHE[current_key] = {"candles": [{"close": 5001}], "provider": "ibkr"}
            self.assertEqual(main.candle_cache_best("candles", "MES1!", "1m", 0)["provider"], "ibkr")
            with patch.dict(os.environ, {"IBKR_CONID_MAP": '{"MES1!": 987654}'}):
                self.assertIsNone(main.candle_cache_best("candles", "MES1!", "1m", 0))

    def test_sse_reports_configuration_failure(self):
        async def run():
            with patch.object(ib, "get_latest_live_snapshot", side_effect=HTTPException(503, "Configure gateway")):
                stream = ib.live_feed_event_generator()
                event = await anext(stream)
                await stream.aclose()
                return event
        self.assertIn('"status": "unavailable"', asyncio.run(run()))


if __name__ == "__main__":
    unittest.main()
