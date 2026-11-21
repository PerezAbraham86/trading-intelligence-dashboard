# BTCUSD AI research (Phase 3)

This feature is **read-only** and disabled by default. It does not authorize orders or alter the AI Trader's BUY/SELL/HOLD decisions.

## Endpoints

- GET `/api/ai-research/status` — model and holdout metrics
- GET `/api/ai-research/predict?timeframe=5m` — research probability from the latest feature snapshot, if fresh
- GET `/api/ai-research/explain?timeframe=5m` — opt-in LLM commentary
- POST `/api/ai-research/train` — requires `X-AI-Research-Token` header

## Installation and configuration

Install `pip install -r api/requirements-ai.txt` in the backend environment. Optional packages are deliberately excluded from the default deploy to avoid a surprise increase in memory and build time.

Set `BTCUSD_XGB_TRAINING_ENABLED=true` and a strong `BTCUSD_AI_ADMIN_TOKEN` before using the training endpoint. Optionally set `BTCUSD_XGB_TIMEFRAME=5m`, `BTCUSD_XGB_MODEL_PATH`, and `BTCUSD_XGB_METADATA_PATH` to persistent paths. The default /tmp paths are ephemeral on Render.

For the Qwen-compatible LLM, set `BTCUSD_LLM_ENABLED=true`, `BTCUSD_LLM_BASE_URL` (HTTPS OpenAI-compatible endpoint), `BTCUSD_LLM_MODEL`, and `BTCUSD_LLM_API_KEY`. Never place API keys in browser code. No LLM provider is contacted unless enabled and configured.

## Evaluation and limits

Training uses only resolved BTCUSD feature-store records and excludes future outcome fields from features. The last 20% of chronological observations are held out, with an embargo between training and holdout. Metrics include accuracy, Brier score, log loss, and majority-class baseline. A single holdout is insufficient to establish profitability. Before promotion, add walk-forward tests, transaction costs, slippage, calibration, and paper-trading monitoring.

**Important:** The existing feature store defaults to local SQLite under /tmp. On ephemeral hosting, its history and trained model may disappear on restart. Move these to persistent storage or a database before relying on learning history. The AI model never submits trades.
