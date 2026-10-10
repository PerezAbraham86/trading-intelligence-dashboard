import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from api import main, neural_brain_fastapi as brain, neural_brain_online as online
from api.neural_brain import build_neural_brain_scorecard
from api.migrate_neural_brain import import_memory

ROOT = Path(__file__).resolve().parents[1]


class NeuralBrainTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        directory = Path(self.directory.name)
        for name, value in (("DB_PATH", directory / "memory.sqlite3"), ("ONLINE_MODEL_PATH", directory / "scopes.json")):
            mock = patch.object(brain, name, value)
            mock.start()
            self.addCleanup(mock.stop)

    def test_prediction_outcome_learning_and_reload(self):
        with TestClient(main.app, raise_server_exceptions=True) as client:
            for index in range(9):
                result = client.post('/api/neural-brain/predict', json={"symbol": "MES1!", "scorecards": {"bullScore": 85, "bearScore": 15, "smcDirection": "bullish", "ghostDirection": "bullish", "alphaxDirection": "bullish"}})
                self.assertEqual(result.status_code, 200)
                predicted = result.json()
                snapshot_id = predicted['memory']['id']
                outcome = {"id": snapshot_id, "targetHit": True, "reversalHappened": False, "chopHappened": False, "result": "target_hit", "maxFavorableExcursion": 12}
                self.assertTrue(client.post('/api/neural-brain/outcomes', json=outcome).json()['updated'])
                self.assertFalse(client.post('/api/neural-brain/outcomes', json=outcome).json()['updated'])
            status = client.get('/api/neural-brain/status').json()
            self.assertTrue(status['online']['onlineReady'])
            self.assertEqual(status['online']['trainedExamples'], 36)
            self.assertEqual(status['memory']['labeledSnapshots'], 9)
            self.assertTrue(predicted['trainedModelReady'])
            filtered = client.get('/api/neural-brain/snapshots?symbol=MES1!&timeframe=1m').json()
            self.assertEqual(filtered['total'], 9)
            self.assertEqual(filtered['snapshots'][0]['outcome']['maxFavorableExcursion'], 12)
            self.assertEqual(client.get('/api/neural-brain/snapshots?symbol=SPY').json()['total'], 0)
            self.assertEqual(client.post('/api/neural-brain/outcomes', json={}).status_code, 400)
            self.assertFalse(client.post('/api/neural-brain/outcomes', json={"id": "missing"}).json()['updated'])
            backup = client.get('/api/neural-brain/export').json()
        # Fresh calls reload SQLite state, rather than relying on process globals.
        self.assertEqual(brain.neural_brain_status()['online']['trainedExamples'], 36)
        self.assertEqual(len(backup['snapshots']), 9)
        self.assertEqual(backup['onlineModel'], brain.load_logistic_state())

    def test_import_preserves_ids_outcomes_and_exact_weights(self):
        directory = Path(self.directory.name)
        row = {"id": "previous-next-id", "symbol": "SPY", "timeframe": "5m", "buyConfidence": 80,
               "scorecardInputs": {"inputs": {"netBias": 65}}, "outcome": {"targetHit": True, "labeledAt": "2026-10-10T00:00:00Z"}}
        model = online.learn(online.initial_state(), {**row, "bestDirection": "bullish"})
        snapshots_path, model_path = directory / 'snapshots.jsonl', directory / 'model.json'
        snapshots_path.write_text(json.dumps(row) + '\n')
        model_path.write_text(json.dumps(model))
        import_memory(snapshots_path, model_path)
        self.assertEqual(brain.load_logistic_state(), model)
        saved = brain.list_neural_brain_snapshots()['snapshots'][0]
        self.assertEqual(saved['id'], row['id'])
        self.assertEqual(saved['outcome'], row['outcome'])
        # Duplicate imports preserve labeled snapshots and never retrain.
        import_memory(snapshots_path)
        self.assertEqual(brain.load_logistic_state(), model)
        self.assertEqual(brain.list_neural_brain_snapshots()['total'], 1)

    def test_export_restore_retains_labels_weights_and_scope_statistics(self):
        saved = brain.save_neural_brain_snapshot({"id": "backup-row", "symbol": "SPY", "timeframe": "5m", "bestDirection": "bearish"})
        brain.label_neural_brain_outcome({"id": saved["id"], "targetHit": False, "reversalHappened": True})
        backup = brain.export_neural_brain_memory()
        filename = Path(self.directory.name) / 'backup.json'
        filename.write_text(json.dumps(backup))
        with patch.object(brain, 'DB_PATH', Path(self.directory.name) / 'restored.sqlite3'), patch.object(brain, 'ONLINE_MODEL_PATH', Path(self.directory.name) / 'restored-scopes.json'):
            import_memory(filename)
            restored = brain.export_neural_brain_memory()
            self.assertEqual(restored['snapshots'], backup['snapshots'])
            self.assertEqual(restored['onlineModel'], backup['onlineModel'])
            self.assertEqual(restored['scopeStatistics']['trainedExamples'], backup['scopeStatistics']['trainedExamples'])

    def test_outcome_corrections_are_preserved(self):
        snapshot = brain.save_neural_brain_snapshot({"id": "correctable", "bestDirection": "bullish"})
        brain.label_neural_brain_outcome({"id": snapshot["id"], "targetHit": True, "maxFavorableExcursion": 15})
        corrected = brain.label_neural_brain_outcome({"id": snapshot["id"], "targetHit": False, "result": "expired"})
        self.assertTrue(corrected['updated'])
        stored = brain.list_neural_brain_snapshots()['snapshots'][0]['outcome']
        self.assertFalse(stored['targetHit'])
        self.assertEqual(stored['maxFavorableExcursion'], 15)
        self.assertEqual(stored['result'], 'expired')

    def test_concurrent_outcome_retries_train_once(self):
        from concurrent.futures import ThreadPoolExecutor
        snapshot = brain.save_neural_brain_snapshot({"id": "retry", "bestDirection": "bullish", "buyConfidence": 80})
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: brain.label_neural_brain_outcome({"id": snapshot["id"], "targetHit": True}), range(12)))
        self.assertEqual(sum(bool(row["updated"]) for row in results), 1)
        self.assertEqual(online.status(brain.load_logistic_state())["trainedExamples"], 4)

    def test_cors_restricts_origins_and_supports_json_posts(self):
        with TestClient(main.app) as client:
            allowed = client.options('/api/neural-brain/predict', headers={"Origin": "https://trading-intelligence-dashboard.onrender.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(allowed.headers['access-control-allow-origin'], 'https://trading-intelligence-dashboard.onrender.com')
            denied = client.options('/api/neural-brain/predict', headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"})
            self.assertEqual(denied.status_code, 400)
            self.assertNotIn('access-control-allow-origin', denied.headers)

    def test_original_typescript_prediction_and_learning_parity(self):
        compiler = ROOT / 'node_modules/typescript/bin/tsc'
        if not compiler.exists():
            self.skipTest('Install frontend dependencies for cross-language parity checks')
        directory = Path(self.directory.name)
        compiled = directory / 'reference'
        subprocess.run(['node', str(compiler), '--module', 'commonjs', '--target', 'es2020', '--esModuleInterop', '--skipLibCheck', '--outDir', str(compiled),
                        'lib/neuralBrain.ts', 'lib/neuralBrainMemory.ts', 'lib/neuralBrainOnline.ts'], cwd=ROOT, check=True, capture_output=True)
        inputs = [
            {"scorecards": {"smcDirection": "", "smc": "bullish", "alphaxDirection": "", "alphax": "bearish", "ghostDirection": "", "ghost": "bullish", "bullScore": 0, "bearScore": 0}},
            {"scorecards": {"bullScore": 85, "bearScore": 15, "smcDirection": "bullish", "alphaxDirection": "bullish", "ghostDirection": "bullish"}, "mlFeatures": {"smcStrength": 75}},
            {"scorecards": {"bullScore": 15, "bearScore": 85, "smcDirection": "bearish", "alphaxDirection": "bearish", "ghostDirection": "bearish"}, "externalData": {"macroRisk": 0}},
            {"candles": [{"open": 100, "high": 102, "low": 99, "close": 101}, {"open": 101, "high": 104, "low": 100, "close": 103}], "scorecards": {"bullScore": 50, "bearScore": 50}},
        ]
        env = {**os.environ, 'NEURAL_BRAIN_ONLINE_MODEL_FILE': str(directory / 'reference-model.json')}
        result = subprocess.run(['node', 'tests/neural_reference.cjs', str(compiled)], cwd=ROOT, env=env, input=json.dumps(inputs), text=True, capture_output=True, check=True)
        expected = json.loads(result.stdout)
        bases = [build_neural_brain_scorecard(scorecards=item.get('scorecards'), ml_features=item.get('mlFeatures'), external_data=item.get('externalData'), candles=item.get('candles'), auto_record=False) for item in inputs]
        fields = ('buyConfidence', 'sellConfidence', 'targetHitProbability', 'reversalRisk', 'chopRisk')
        for base, reference in zip(bases, expected['bases']):
            for field in fields:
                self.assertAlmostEqual(base[field], reference[field], places=2)
        state = online.initial_state()
        for index in range(12):
            base = bases[index % len(bases)]
            state = online.learn(state, {**base, 'decisionStrength': 60, 'riskStatus': 'Aligned', 'scorecardInputs': {'inputs': base['inputs'], 'request': inputs[index % len(inputs)]},
                                        'outcome': {'targetHit': index % 3 != 0, 'reversalHappened': index % 3 == 0, 'chopHappened': index % 4 == 0}})
            predicted = online.apply_prediction(state, base)
            reference = expected['predictions'][index]
            for field in fields:
                self.assertAlmostEqual(predicted[field], reference[field], places=2)
            self.assertEqual(predicted['decision'], reference['decision'])
        for task in online.TASKS:
            self.assertEqual(state['tasks'][task]['examples'], expected['state']['tasks'][task]['examples'])
            for key, weight in expected['state']['tasks'][task]['weights'].items():
                self.assertAlmostEqual(state['tasks'][task]['weights'][key], weight, places=10)
