"""AI research is observational and must not change AI Trader decisions."""
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from api import main


class ResearchIntegrationTests(unittest.TestCase):
    def test_existing_decision_preserved_when_model_unavailable(self):
        original = {"decision": "HOLD", "allowedToTrade": False, "confidence": 42}
        fresh = datetime.now(timezone.utc).isoformat()
        with patch.dict(os.environ, {"BTCUSD_AI_RESEARCH_IN_DECISION": "true"}):
            with patch.object(main, "live_feed_status", return_value={"stream": {"status": "live", "lastTradeAt": fresh}}):
                with patch.object(main, "get_ai_trader_decision", return_value=original):
                    with patch.object(main, "ai_trader_cached_response", return_value=None):
                        with patch.object(main, "ai_trader_store_cached_response", side_effect=lambda key, result: result):
                            with patch("api.btcusd_ai_research.predict_btcusd", return_value={"status": "NotTrained", "researchOnly": True}):
                                result = main.ai_trader_decision_route(main.AiTraderDecisionPayload(symbol="BTCUSD"))
        self.assertEqual(result["decision"], "HOLD")
        self.assertFalse(result["allowedToTrade"])
        self.assertEqual(result["confidence"], 42)
        self.assertEqual(result["aiResearch"]["status"], "NotTrained")

    def test_research_can_be_disabled_without_changing_decision(self):
        original = {"decision": "BUY", "allowedToTrade": False}
        fresh = datetime.now(timezone.utc).isoformat()
        with patch.dict(os.environ, {"BTCUSD_AI_RESEARCH_IN_DECISION": "false"}):
            with patch.object(main, "live_feed_status", return_value={"stream": {"status": "live", "lastTradeAt": fresh}}):
                with patch.object(main, "get_ai_trader_decision", return_value=original):
                    with patch.object(main, "ai_trader_cached_response", return_value=None):
                        with patch.object(main, "ai_trader_store_cached_response", side_effect=lambda key, result: result):
                            result = main.ai_trader_decision_route(main.AiTraderDecisionPayload(symbol="BTCUSD"))
        self.assertNotIn("aiResearch", result)
        self.assertEqual(result["decision"], "BUY")


if __name__ == "__main__":
    unittest.main()
