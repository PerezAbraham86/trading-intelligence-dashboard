"""Phase 2 BTCUSD safety regression tests (no network or trading orders)."""
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from api import main


class Phase2BTCUSDGuards(unittest.TestCase):
    def test_rejects_non_btc_symbols(self):
        self.assertIsNone(main.ai_trader_btcusd_guard({"symbol": "BTC/USD"}))
        self.assertIsNone(main.ai_trader_btcusd_guard({"symbol": "BTCUSD"}))
        self.assertEqual(main.ai_trader_btcusd_guard({"symbol": "MES1!"})["errorCode"], "BTCUSD_ONLY")
        self.assertEqual(main.ai_trader_btcusd_guard({"symbol": "ETHUSD"})["errorCode"], "BTCUSD_ONLY")

    def test_missing_stream_blocks_new_entries(self):
        with patch.object(main, "live_feed_status", return_value={"stream": {"status": "connecting"}}):
            self.assertEqual(main.ai_trader_live_feed_guard()["errorCode"], "LIVE_FEED_NOT_LIVE")

    def test_stale_stream_blocks_new_entries(self):
        stale = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
        with patch.object(main, "live_feed_status", return_value={"stream": {"status": "live", "lastTradeAt": stale}}):
            self.assertEqual(main.ai_trader_live_feed_guard()["errorCode"], "STALE_LIVE_TRADE")

    def test_fresh_stream_allows_paper_decision(self):
        fresh = datetime.now(timezone.utc).isoformat()
        with patch.object(main, "live_feed_status", return_value={"stream": {"status": "live", "lastTradeAt": fresh}}):
            self.assertIsNone(main.ai_trader_live_feed_guard())

    def test_disconnected_stream_blocks_even_with_recent_timestamp(self):
        fresh = datetime.now(timezone.utc).isoformat()
        with patch.object(main, "live_feed_status", return_value={"stream": {"status": "reconnecting", "lastTradeAt": fresh}}):
            self.assertEqual(main.ai_trader_live_feed_guard()["errorCode"], "LIVE_FEED_NOT_LIVE")


if __name__ == "__main__":
    unittest.main()
