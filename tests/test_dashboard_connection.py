import unittest
from fastapi.testclient import TestClient
from api.main import app

ORIGIN = 'https://trading-intelligence-dashboard-2.onrender.com'

class DashboardConnectionTests(unittest.TestCase):
    def test_actual_origin_reads_disconnected_data_and_errors(self):
        with TestClient(app, raise_server_exceptions=False) as client:
            for path in ['/health', '/api/ibkr/status?symbol=MES1!', '/api/candles?symbol=MES1!&timeframe=1m', '/api/no-such-route', '/api/neural-brain/outcomes']:
                method = client.post if path.endswith('outcomes') else client.get
                response = method(path, headers={'Origin': ORIGIN})
                self.assertEqual(response.headers.get('access-control-allow-origin'), ORIGIN, path)
            status = client.get('/api/ibkr/status?symbol=MES1!', headers={'Origin': ORIGIN}).json()
            self.assertFalse(status['ready'])
            self.assertIn('reason', status)
            for method in ('GET', 'POST'):
                response = client.options('/api/neural-brain/predict', headers={'Origin': ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['access-control-allow-origin'], ORIGIN)
            self.assertNotIn('access-control-allow-origin', client.get('/health', headers={'Origin': 'https://untrusted.example'}).headers)

    def test_unhandled_error_is_readable_without_details(self):
        from api.main import readable_server_error
        from starlette.requests import Request
        import asyncio
        request = Request({'type': 'http', 'headers': [(b'origin', ORIGIN.encode())]})
        response = asyncio.run(readable_server_error(request, RuntimeError('private detail')))
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers['access-control-allow-origin'], ORIGIN)
        self.assertNotIn(b'private detail', response.body)
