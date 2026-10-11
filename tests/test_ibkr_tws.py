"""TWS/relay fixtures are test-only; no live brokerage connection is made."""
import asyncio
import ast
import concurrent.futures
import json
import os
import tempfile
import time
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from ib_async import BarData, BarDataList, StartupFetchNONE
from pydantic import ValidationError
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from api import ibkr_client as rest, main, market_data, ibkr_tws_relay as relay, external_data_engine
from api.ibkr_tws_client import Config, Connector, MarketDataIB, classify_error, convert_bar, exchange_schedule, private_host
from api.ibkr_tws_schema import Candle, RelayPayload

KEY = 'test-only-relay-key-0123456789abcdef'
ROOT = Path(__file__).resolve().parents[1]


def config(**changes):
    values = dict(host='127.0.0.1', port=4001, client_id=11, environment='live', duration='1 D', use_rth=False,
                  timeout=5, retry_min=30, retry_max=300, relay_url='https://backend.test', relay_secret=KEY,
                  connector_id='marketbos-spy', heartbeat=20, history_interval=0)
    return Config(**{**values, **changes})


def bar(epoch=None, completed=False, **changes):
    epoch = epoch or int(time.time()) // 60 * 60
    return {**dict(epoch=epoch, open=500.0, high=502.0, low=499.0, close=501.0, volume=123.0,
                   completed=completed, updatedAt=time.time()), **changes}


def payload(**changes):
    return {**dict(version=1, source='ibkr_tws', connectorId='marketbos-spy', bootId='a' * 32, sequence=1,
                   symbol='SPY', timeframe='1m', secType='STK', exchange='SMART', currency='USD', conid=756733,
                   environment='live', useRTH=False, state='connected', connected=True, subscribed=True,
                   errorCode=None, lastDataUpdate=time.time(), schedule=[], candles=[bar()], gapRecoveryLimited=False), **changes}


def envelope(value, stamp=None, nonce=None, key=KEY):
    body = json.dumps(value, separators=(',', ':')).encode()
    stamp = str(stamp or int(time.time()))
    nonce = nonce or uuid.uuid4().hex
    return body, {'x-ibkr-timestamp': stamp, 'x-ibkr-nonce': nonce, 'x-ibkr-signature': relay.sign(body, stamp, nonce, key)}


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db = patch.object(relay, 'DB_PATH', Path(self.tmp.name) / 'relay.sqlite3')
        db.start(); self.addCleanup(db.stop)
        env = patch.dict(os.environ, {'IBKR_MARKET_DATA_SOURCE': 'tws_relay', 'IBKR_RELAY_ENABLED': 'true', 'IBKR_RELAY_SECRET': KEY, 'IBKR_RELAY_CONNECTOR_ID': 'marketbos-spy'})
        env.start(); self.addCleanup(env.stop)

    def send(self, value, **kwargs):
        return relay.ingest(*envelope(value, **kwargs))

    def test_candle_updates_completion_and_idempotent_revisions(self):
        old = bar(epoch=int(time.time()) // 60 * 60 - 120, completed=False)
        value = payload(candles=[old])
        self.assertEqual(self.send(value)['changed'], 1)
        self.assertEqual(self.send({**value, 'sequence': 2})['changed'], 0)
        updated = {**old, 'close': 501.5, 'completed': True, 'updatedAt': time.time()}
        self.send({**value, 'sequence': 3, 'lastDataUpdate': updated['updatedAt'], 'candles': [updated]})
        history = relay.historical('SPY', '1m')
        self.assertEqual(len(history['candles']), 1)
        self.assertEqual(history['candles'][0]['close'], 501.5)
        self.assertTrue(history['candles'][0]['completed'])
        with self.assertRaises(HTTPException) as error:
            self.send({**value, 'sequence': 4, 'candles': [{**updated, 'completed': False}]})
        self.assertEqual(error.exception.status_code, 409)

    def test_security_signature_expiry_replay_and_sequence(self):
        value = payload()
        body, headers = envelope(value)
        relay.ingest(body, headers)
        for candidate, auth, code in [(body, headers, 409), (body + b' ', headers, 401), (*envelope({**value, 'sequence': 2}, stamp=int(time.time()) - 100), 401), (*envelope(value), 409)]:
            with self.assertRaises(HTTPException) as error:
                relay.ingest(candidate, auth)
            self.assertEqual(error.exception.status_code, code)
        with self.assertRaises(HTTPException):
            self.send({**value, 'sequence': 2, 'connectorId': 'untrusted'})
        self.assertEqual(relay.snapshot()[0]['sequence'], 1)

    def test_restart_retires_old_boot_and_keeps_history_when_unqualified(self):
        value = payload()
        self.send(value)
        next_boot = {**value, 'bootId': 'b' * 32, 'conid': 0, 'sequence': 1, 'state': 'gateway_disconnected', 'connected': False, 'subscribed': False, 'candles': []}
        self.send(next_boot)
        history = relay.historical()
        self.assertEqual(len(history['candles']), 1)
        self.assertFalse(history['isLive'])
        with self.assertRaises(HTTPException):
            self.send({**value, 'sequence': 3})

    def test_replay_is_atomic_across_workers(self):
        body, headers = envelope(payload())
        def submit(_):
            try:
                relay.ingest(body, headers)
                return 200
            except HTTPException as error:
                return error.status_code
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(submit, range(4)))
        self.assertEqual(results.count(200), 1)
        self.assertEqual(results.count(409), 3)

    def test_malformed_oversized_payloads_and_no_secret_fields(self):
        value = payload()
        variants = [payload(candles=[bar(high=490.0)]), payload(candles=[bar(volume=-1.0)]),
                    payload(candles=[bar(close=float('nan'))]), payload(candles=[bar(epoch=int(time.time()) // 60 * 60 + 120)]),
                    {**value, 'candles': value['candles'] * 2}, {**value, 'password': 'should-not-be-accepted'},
                    payload(symbol='MES1!'), payload(timeframe='5m'), payload(lastDataUpdate=None)]
        for candidate in variants:
            with self.assertRaises(HTTPException) as error:
                self.send(candidate)
            self.assertEqual(error.exception.status_code, 422)
        with self.assertRaises(HTTPException) as error:
            relay.ingest(b'x' * (relay.MAX_BODY + 1), {})
        self.assertEqual(error.exception.status_code, 413)
        self.assertEqual(relay.snapshot()[1], [])

    def test_http_route_requires_https_and_returns_cors_errors(self):
        body, headers = envelope(payload())
        with TestClient(main.app, base_url='https://backend.test') as client:
            response = client.post(relay.PATH, content=body, headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            bad = client.post(relay.PATH, content=body, headers={'Origin': 'https://trading-intelligence-dashboard-2.onrender.com'})
            self.assertEqual(bad.status_code, 401)
            self.assertEqual(bad.headers['access-control-allow-origin'], 'https://trading-intelligence-dashboard-2.onrender.com')
            oversized = client.post(relay.PATH, content=b'x' * (relay.MAX_BODY + 1), headers=headers)
            self.assertEqual(oversized.status_code, 413)
        with TestClient(main.app) as client:
            self.assertEqual(client.post(relay.PATH, content=body, headers=headers).status_code, 400)

    def test_forwarded_https_requires_a_trusted_socket_peer(self):
        async def proxy_scope(scope, receive, send, trusted):
            if scope["type"] == "http":
                scope = {**scope, "client": ("10.0.0.8", 12345)}
            await ProxyHeadersMiddleware(main.app, trusted_hosts=trusted)(scope, receive, send)

        async def trusted_app(scope, receive, send):
            await proxy_scope(scope, receive, send, "10.0.0.8")

        async def untrusted_app(scope, receive, send):
            await proxy_scope(scope, receive, send, "127.0.0.1")

        body, headers = envelope(payload())
        headers["X-Forwarded-Proto"] = "https"
        with TestClient(untrusted_app) as client:
            self.assertEqual(client.post(relay.PATH, content=body, headers=headers).status_code, 400)
            self.assertFalse(client.get("/api/ibkr/tws/status", headers=headers).json()["httpsVerified"])
        with TestClient(trusted_app) as client:
            self.assertEqual(client.post(relay.PATH, content=body, headers=headers).status_code, 200)
            self.assertTrue(client.get("/api/ibkr/tws/status", headers=headers).json()["httpsVerified"])

    def test_production_defaults_install_without_enabling_tws(self):
        with patch.dict(os.environ, {}, clear=True), TestClient(main.app, base_url="https://backend.test") as client:
            self.assertEqual(market_data.selected_source(), "client_portal")
            self.assertFalse(relay.enabled())
            state = client.get("/api/ibkr/tws/status").json()
            self.assertEqual(state["status"], "IBKR Not Connected")
            self.assertFalse(state["configured"])
            self.assertFalse(state["ready"])
            self.assertFalse(state["isLive"])
            self.assertTrue(state["httpsVerified"])
            self.assertEqual(client.post(relay.PATH, content=b"{}").status_code, 503)

    def test_render_wildcard_proxy_default_cannot_enable_relay(self):
        for value in ["", "*", "0.0.0.0/0", "::/0", "invalid"]:
            with patch.dict(os.environ, {"RENDER": "true", "FORWARDED_ALLOW_IPS": value}):
                self.assertFalse(relay.proxy_trust_ready())
                self.assertFalse(relay.status()["configured"])
                with self.assertRaises(HTTPException) as error:
                    self.send(payload())
                self.assertEqual(error.exception.status_code, 503)
        with patch.dict(os.environ, {"RENDER": "true", "FORWARDED_ALLOW_IPS": "10.0.0.8,127.0.0.1"}):
            self.assertTrue(relay.proxy_trust_ready())
            self.assertEqual(self.send(payload())["changed"], 1)

    def test_live_closed_stale_offline_and_permission_statuses(self):
        value = payload()
        self.send(value)
        self.assertEqual(relay.status()['status'], 'Live market data')
        self.assertTrue(relay.latest()['candle'])
        now = int(time.time())
        self.send({**value, 'sequence': 2, 'candles': [], 'schedule': [{'start': now - 600, 'end': now + 600, 'intervals': []}]})
        self.assertEqual(relay.status()['status'], 'Market closed')
        self.assertFalse(relay.status()['isLive'])
        self.assertIsNone(relay.latest()['candle'])
        self.send({**value, 'sequence': 3, 'candles': [], 'lastDataUpdate': now - 180})
        self.assertEqual(relay.status()['status'], 'Stale market data')
        metadata, bars = relay.snapshot()
        self.assertEqual(relay.status(metadata=metadata, bars=bars, now=metadata['receivedAt'] + 100)['status'], 'Connector offline')
        self.send({**value, 'sequence': 4, 'state': 'subscription_required', 'subscribed': False, 'candles': []})
        self.assertEqual(relay.status()['status'], 'Market-data subscription required')
        self.assertFalse(relay.status()['ready'])
        self.send({**value, 'sequence': 5, 'state': 'authentication_required', 'subscribed': False, 'candles': []})
        self.assertEqual(relay.status()['status'], 'Authentication required')
        self.assertFalse(relay.status()['authenticated'])

    def test_aggregates_observed_bars_without_gap_fill(self):
        epoch = int(time.time()) // 300 * 300 - 600
        values = [bar(epoch=epoch, completed=True, volume=100.0), bar(epoch=epoch + 120, completed=True, open=501.0, close=502.0, volume=50.0)]
        self.send(payload(candles=values))
        aggregate = relay.historical('SPY', '5m')['candles']
        self.assertEqual(len(aggregate), 1)
        self.assertEqual(aggregate[0]['observedMinutes'], 2)
        self.assertTrue(aggregate[0]['partial'])
        self.assertEqual(aggregate[0]['volume'], 150.0)
        self.assertEqual(aggregate[0]['close'], 502.0)
        self.assertEqual(aggregate[0]['epoch'], epoch)

    def test_environment_and_rth_caches_never_mix(self):
        value = payload()
        self.send(value)
        self.send({**value, 'sequence': 2, 'environment': 'paper', 'candles': []})
        self.assertEqual(relay.historical()['candles'], [])
        self.send({**value, 'sequence': 3, 'useRTH': True, 'candles': []})
        self.assertEqual(relay.historical()['candles'], [])

    def test_existing_endpoints_and_analytics_use_tws_without_rest(self):
        self.send(payload())
        with patch.object(rest._SESSION, 'get') as get, TestClient(main.app) as client:
            for route in ['/api/candles', '/api/historical-candles', '/api/live-feed/latest', '/api/live-price', '/api/live-candle', '/api/engine-state', '/api/ibkr/history', '/api/dashboard/snapshot?includeProjection=false']:
                response = client.get(route, params={'symbol': 'SPY', 'timeframe': '1m'})
                self.assertEqual(response.status_code, 200, (route, response.text[:200]))
            candle = client.get('/api/candles?symbol=SPY&timeframe=1m').json()['candles'][0]
            self.assertEqual(candle['source'], 'ibkr_tws')
            self.assertEqual(client.get('/api/candles?symbol=MES1!&timeframe=1m').json()['candles'], [])
            self.assertEqual(client.get('/health').json()['marketDataSource'], 'tws_relay')
            get.assert_not_called()
        with patch.dict(os.environ, {'IBKR_MARKET_DATA_SOURCE': 'client_portal'}), patch.object(rest, 'get_historical_ohlcv', return_value={'source': 'ibkr_historical_ohlcv'}) as get:
            self.assertEqual(market_data.get_historical_ohlcv('SPY')['source'], 'ibkr_historical_ohlcv')
            get.assert_called_once()

    def test_trade_bar_prices_do_not_claim_level_one_quotes(self):
        with patch.object(external_data_engine, "get_ibkr_quote", return_value={"priceType": "forming_trade_bar_close", "isRealtime": True, "price": 501.0}):
            result = external_data_engine.build_ibkr_l1_quote_context("SPY")
            self.assertEqual(result["status"], "unavailable")
            self.assertIn("bid/ask", result["reason"])

    def test_disabled_and_invalid_source_fail_closed(self):
        with patch.dict(os.environ, {'IBKR_RELAY_ENABLED': 'false'}):
            with self.assertRaises(HTTPException):
                self.send(payload())
            self.assertFalse(relay.status()['ready'])
        with patch.dict(os.environ, {'IBKR_MARKET_DATA_SOURCE': 'unknown'}):
            with self.assertRaises(HTTPException):
                market_data.connection_status()


class ConfigAndConversionTests(unittest.TestCase):
    def test_ports_explicit_readonly_private_hosts_and_settings(self):
        values = {'IBKR_TWS_ENABLED': 'true', 'IBKR_RELAY_ENABLED': 'true', 'IBKR_RELAY_SECRET': KEY, 'IBKR_RELAY_BACKEND_URL': 'https://backend.test'}
        with patch.dict(os.environ, values, clear=True):
            for app, env, port in [('gateway', 'live', 4001), ('gateway', 'paper', 4002), ('tws', 'live', 7496), ('tws', 'paper', 7497)]:
                with patch.dict(os.environ, {'IBKR_TWS_APPLICATION': app, 'IBKR_TWS_ENVIRONMENT': env}):
                    self.assertEqual(Config.from_env().port, port)
            with patch.dict(os.environ, {'IBKR_TWS_PORT': '12345'}):
                self.assertEqual(Config.from_env().port, 12345)
            for change in [{'IBKR_TWS_READONLY': 'false'}, {'IBKR_TWS_CLIENT_ID': '0'}, {'IBKR_RELAY_BACKEND_URL': 'http://backend.test'}, {'IBKR_SYMBOL': 'MES1!'}, {'IBKR_TWS_HOST': '8.8.8.8'}, {'IBKR_HISTORY_DURATION': '50 D'}]:
                with patch.dict(os.environ, change), self.assertRaises(ValueError):
                    Config.from_env()
        self.assertEqual(private_host('127.0.0.1'), '127.0.0.1')
        self.assertEqual(config().delay(0), 30)
        self.assertEqual(config().delay(20), 300)

    def test_utc_conversion_and_invalid_provider_bar(self):
        epoch = int(time.time()) // 60 * 60 - 120
        ibbar = BarData(date=datetime.fromtimestamp(epoch, timezone.utc), open=500, high=502, low=499, close=501, volume=100)
        converted = convert_bar(ibbar, True)
        self.assertEqual(converted['epoch'], epoch)
        self.assertTrue(Candle(**converted).normalized(756733)['time'].endswith('+00:00'))
        ibbar.date = ibbar.date.replace(tzinfo=None)
        with self.assertRaises(ValueError):
            convert_bar(ibbar, True)
        with self.assertRaises(ValidationError):
            Candle(**bar(epoch=epoch + 1))

    def test_ibkr_exchange_calendar_handles_closures_and_dst(self):
        details = SimpleNamespace(timeZoneId='US/Eastern', liquidHours='20261010:CLOSED;20261012:0930-20261012:1600', tradingHours='20261010:CLOSED;20261012:0400-20261012:2000')
        schedule = exchange_schedule(details, True)
        self.assertEqual(schedule[0]['intervals'], [])
        self.assertEqual(datetime.fromtimestamp(schedule[1]['intervals'][0][0], timezone.utc).hour, 13)
        self.assertTrue(relay.market_closed(schedule, schedule[0]['start'] + 100))
        self.assertFalse(relay.market_closed(schedule, schedule[1]['intervals'][0][0] + 60))
        self.assertIsNone(relay.market_closed(schedule, schedule[-1]['end'] + 60))
        self.assertEqual(exchange_schedule(details, False)[1]['intervals'][0][0], schedule[1]['start'] + 4 * 3600)

    def test_error_classification_does_not_mistake_connectivity_for_login(self):
        self.assertEqual(classify_error(1100), ('gateway_disconnected', False))
        self.assertEqual(classify_error(10197), ('authentication_required', True))
        self.assertEqual(classify_error(354), ('subscription_required', True))
        self.assertEqual(classify_error(162, 'Historical Market Data Service error: No market data permissions'), ('subscription_required', True))
        self.assertEqual(classify_error(162, 'pacing violation'), ('pacing_limited', False))
        self.assertEqual(classify_error(1101), ('resubscribe', False))
        self.assertEqual(classify_error(1102), ('informational', False))

    def test_readonly_call_boundary_and_relay_schema(self):
        source = (ROOT / 'api/ibkr_tws_client.py').read_text()
        tree = ast.parse(source)
        forbidden = {'placeOrder', 'cancelOrder', 'reqGlobalCancel', 'reqAutoOpenOrders', 'reqExecutions', 'reqAccountUpdates'}
        called = {node.func.attr for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
        self.assertFalse(called & forbidden)
        self.assertIn('readonly=True', source)
        self.assertIn('fetchFields=StartupFetchNONE', source)
        self.assertIn('keepUpToDate=True', source)
        self.assertNotIn('account', RelayPayload.model_fields)
        self.assertNotIn('password', RelayPayload.model_fields)


class FakeIB:
    def __init__(self):
        from eventkit import Event
        self.errorEvent, self.disconnectedEvent = Event(), Event()
        self.connected = False
        self.contract = SimpleNamespace(conId=756733, symbol='SPY', secType='STK', currency='USD', exchange='SMART')
        self.connectAsync = AsyncMock(side_effect=self.connect)
        self.qualifyContractsAsync = AsyncMock(return_value=[self.contract])
        self.reqContractDetailsAsync = AsyncMock(return_value=[SimpleNamespace(timeZoneId='US/Eastern', liquidHours='', tradingHours='')])
        bars = BarDataList()
        bars.append(BarData(date=datetime.fromtimestamp(int(time.time()) // 60 * 60, timezone.utc), open=500, high=502, low=499, close=501, volume=100))
        self.reqHistoricalDataAsync = AsyncMock(return_value=bars)
        self.reqCurrentTimeAsync = AsyncMock(return_value=datetime.now(timezone.utc))
        self.reqMarketDataType = Mock()
        self.cancelHistoricalData = Mock()

    async def connect(self, *args, **kwargs):
        self.connected = True

    def isConnected(self):
        return self.connected

    def disconnect(self):
        self.connected = False
        self.disconnectedEvent.emit()


class ConnectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_qualification_subscription_and_same_minute_update(self):
        fake = FakeIB()
        connector = Connector(config(), fake)
        self.addCleanup(connector.session.close)
        await connector.establish()
        kwargs = fake.connectAsync.call_args.kwargs
        self.assertTrue(kwargs['readonly'])
        self.assertEqual(kwargs['fetchFields'], StartupFetchNONE)
        contract = fake.qualifyContractsAsync.call_args.args[0]
        self.assertEqual((contract.symbol, contract.secType, contract.exchange, contract.currency), ('SPY', 'STK', 'SMART', 'USD'))
        kwargs = fake.reqHistoricalDataAsync.call_args.kwargs
        self.assertEqual((kwargs['endDateTime'], kwargs['formatDate'], kwargs['whatToShow'], kwargs['barSizeSetting']), ('', 2, 'TRADES', '1 min'))
        self.assertTrue(kwargs['keepUpToDate'])
        fake.reqMarketDataType.assert_called_once_with(1)
        initial = connector.last_data_update
        connector.on_bars(connector.bars, False)
        self.assertEqual(connector.last_data_update, initial, 'Duplicate updates must not refresh data age')
        connector.bars[-1].close = 501.5
        connector.on_bars(connector.bars, False)
        self.assertEqual(list(connector.pending.values())[-1]['close'], 501.5)
        self.assertFalse(list(connector.pending.values())[-1]['completed'])

    async def test_restart_recovers_history_and_resubscribes(self):
        fake = FakeIB()
        connector = Connector(config(), fake)
        self.addCleanup(connector.session.close)
        await connector.establish()
        fake.disconnect()
        connector.last_disconnect = time.time() - 2 * 86400
        await connector.establish()
        self.assertEqual(fake.connectAsync.call_count, 2)
        self.assertEqual(fake.reqHistoricalDataAsync.call_count, 2)
        self.assertEqual(fake.reqHistoricalDataAsync.call_args.kwargs['durationStr'], '4 D')
        self.assertTrue(connector.subscribed)
        connector.last_disconnect = time.time() - 10 * 86400
        self.assertEqual(connector.lookback(), '5 D')
        self.assertTrue(connector.gap_limited)

    async def test_subscription_auth_errors_pause_and_data_loss_recovers(self):
        connector = Connector(config(), FakeIB())
        self.addCleanup(connector.session.close)
        connector.on_error(-1, 10197, 'competing session')
        self.assertTrue(connector.paused)
        self.assertEqual(connector.state, 'authentication_required')
        connector.on_disconnect()
        self.assertEqual(connector.state, 'authentication_required')
        connector.paused = False
        connector.on_error(-1, 354, 'not subscribed')
        self.assertTrue(connector.paused)
        self.assertFalse(connector.subscribed)
        connector.paused = False
        connector.on_error(-1, 1101, 'data lost')
        self.assertTrue(connector.resubscribe)

    async def test_no_positions_sync_and_no_fabricated_completion(self):
        ib = MarketDataIB()
        with patch.object(ib.client, 'reqPositions') as positions:
            self.assertEqual(await ib.reqPositionsAsync(), [])
            positions.assert_not_called()
        connector = Connector(config(), FakeIB())
        self.addCleanup(connector.session.close)
        old = bar(epoch=int(time.time()) // 60 * 60 - 120)
        connector.known[old['epoch']] = old
        connector.last_data_update = old['updatedAt']
        connector.finalize()
        self.assertTrue(connector.pending[old['epoch']]['completed'])
        self.assertEqual(connector.last_data_update, old['updatedAt'])
        for field in ('open', 'high', 'low', 'close', 'volume'):
            self.assertEqual(connector.pending[old['epoch']][field], old[field])

    async def test_monitor_reconnects_and_backfills_without_real_socket(self):
        fake = FakeIB()
        connector = Connector(config(heartbeat=0.001, retry_min=0.001), fake)
        async def monitor():
            if fake.connectAsync.call_count == 1:
                raise asyncio.TimeoutError()
            connector.stop.set()
            return datetime.now(timezone.utc)
        fake.reqCurrentTimeAsync.side_effect = monitor
        connector.relay_loop = AsyncMock()
        await connector.run()
        self.assertEqual(fake.connectAsync.call_count, 2)
        self.assertEqual(fake.reqHistoricalDataAsync.call_count, 2)

    async def test_relay_has_signed_body_tls_no_redirect_and_no_credentials(self):
        connector = Connector(config(), FakeIB())
        self.addCleanup(connector.session.close)
        mock = Mock(status_code=200)
        mock.json.return_value = {'accepted': True}
        with patch.object(connector.session, 'post', return_value=mock) as post:
            value = connector.payload([])
            connector.post(value)
            self.assertEqual(post.call_args.args[0], 'https://backend.test' + relay.PATH)
            self.assertFalse(post.call_args.kwargs['allow_redirects'])
            self.assertNotIn('verify', post.call_args.kwargs)
            body, headers = post.call_args.kwargs['data'], post.call_args.kwargs['headers']
            self.assertEqual(headers['X-IBKR-Signature'], relay.sign(body, headers['X-IBKR-Timestamp'], headers['X-IBKR-Nonce'], KEY))
            self.assertNotIn(KEY, body.decode())


    async def test_empty_historical_result_is_not_claimed_as_active_subscription(self):
        fake = FakeIB()
        fake.reqHistoricalDataAsync.return_value = BarDataList()
        connector = Connector(config(), fake)
        self.addCleanup(connector.session.close)
        await connector.establish()
        self.assertFalse(connector.subscribed)
        self.assertTrue(connector.resubscribe)
        self.assertEqual(connector.state, 'waiting_for_data')
        self.assertEqual(connector.pending, {})
        self.assertIsNone(connector.last_data_update)

    async def test_relay_ack_preserves_inflight_updates_and_recovers_lost_warehouse(self):
        connector = Connector(config(), FakeIB())
        self.addCleanup(connector.session.close)
        previous = bar()
        revised = {**previous, 'close': 501.5}
        connector.pending[previous['epoch']] = revised
        connector.known[previous['epoch']] = revised
        connector.acknowledge([previous], {'accepted': True})
        self.assertEqual(connector.pending[previous['epoch']], revised)
        connector.acknowledge([revised], {'accepted': True})
        self.assertFalse(connector.pending)
        connector.acknowledge([], {'accepted': True, 'needsBackfill': True})
        self.assertEqual(connector.pending[previous['epoch']], revised)

    async def test_paused_authentication_never_attempts_a_connection(self):
        fake = FakeIB()
        connector = Connector(config(heartbeat=0.001), fake)
        self.addCleanup(connector.session.close)
        connector.on_error(-1, 10197, 'authentication required')
        async def stop_after_reporting():
            await asyncio.sleep(0.01)
            connector.stop.set()
        connector.relay_loop = stop_after_reporting
        await connector.run()
        fake.connectAsync.assert_not_called()
        fake.reqHistoricalDataAsync.assert_not_called()
