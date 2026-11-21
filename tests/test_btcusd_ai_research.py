"""Offline research layer safety checks; no external LLM requests."""
import os
import unittest
from unittest.mock import patch

from api import btcusd_ai_research as research


class ResearchSafetyTests(unittest.TestCase):
    def test_training_disabled_by_default(self):
        with patch.dict(os.environ, {"BTCUSD_XGB_TRAINING_ENABLED": "false"}):
            result = research.train_btcusd_model()
            self.assertEqual(result["status"], "Disabled")

    def test_non_btc_explanation_is_rejected(self):
        with patch.dict(os.environ, {"BTCUSD_LLM_ENABLED": "true",
                                     "BTCUSD_LLM_BASE_URL": "https://example.com",
                                     "BTCUSD_LLM_MODEL": "qwen",
                                     "BTCUSD_LLM_API_KEY": "test"}):
            result = research.explain_btcusd({"symbol": "ETHUSD"})
            self.assertEqual(result["status"], "Rejected")

    def test_llm_disabled_without_network(self):
        with patch.dict(os.environ, {"BTCUSD_LLM_ENABLED": "false"}):
            result = research.explain_btcusd({"symbol": "BTCUSD"})
            self.assertEqual(result["status"], "Disabled")

    def test_untrained_model_cannot_predict(self):
        with patch.object(research, "model_status", return_value={"status": "NotTrained"}):
            self.assertEqual(research.predict_btcusd()["status"], "Unavailable")


if __name__ == "__main__":
    unittest.main()
