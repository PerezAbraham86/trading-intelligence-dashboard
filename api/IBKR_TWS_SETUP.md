# MarketBOS read-only SPY TWS relay

Development branch: `ibkr-tws-integration`. The integration remains disabled by default.
Installing this code does not activate the relay or change the selected data source.

## Architecture and explicit source ownership

An authenticated TWS or IB Gateway exposes a local/private API socket. The independent
Python connector uses `ib_async` to speak the official IBKR binary TWS protocol.
It qualifies `Stock('SPY', 'SMART', 'USD')`, requests `TRADES`, `1 min`, `formatDate=2`,
`endDateTime=''`, and `keepUpToDate=True`. The active minute receives provider updates;
older minutes become completed. It does not synthesize ticks or fill missing minutes.

The connector sends HMAC-signed HTTPS POST batches to `/api/ibkr/tws/relay` on the
existing FastAPI backend. FastAPI validates authentication, timestamps, OHLCV, nonce,
sequence, contract metadata and size, then stores bars in an isolated SQLite warehouse.
Existing candle, live-price, live-candle, SSE, engine and dashboard routes read that
warehouse when `IBKR_MARKET_DATA_SOURCE=tws_relay`. The existing indicators, chart,
Heikin Ashi, intelligence and Neural Brain consume those same genuine candles.

`client_portal` remains the default and preserves existing REST behavior. Selecting
`tws_relay` never calls REST, even for missing symbols, disconnected sockets, missing
configuration, denied entitlements or missing history. The current socket subscription
supports SPY one-minute candles only. Other symbol selections remain available but
report waiting/unsupported until explicitly implemented; they never substitute data.
Higher SPY chart timeframes aggregate observed one-minute OHLCV. The response identifies
`ibkr_tws_aggregated_1m`, observed-minute count and partial coverage. Empty periods are
not filled; daily/weekly buckets use New York calendar boundaries, including DST.

A forming TRADES bar close is the displayed price, identified as
`forming_trade_bar_close`. This integration does not pretend that trade-bar prices
are bid/ask quotes or market depth. Bid/ask and sizes remain unavailable unless a
separate genuine IBKR subscription is implemented. Liquidity/structure calculations
based on candles remain available. No analytical algorithms or learning models are
removed or reduced.

## Connector machine: Python 3.11 or 3.12

Use a computer already running the authenticated Gateway, or one with a private
network path to it. Render localhost is not your computer. The API socket must not
be exposed to the Internet, forwarded on a public router, or hosted in a browser.
Prefer loopback; for a remote Gateway use an existing secure private network/tunnel.
The connector resolves its socket host once and refuses public addresses.

From the repository root:

```bash
git fetch origin
git switch ibkr-tws-integration
python3 -m venv .venv-tws
source .venv-tws/bin/activate
python -m pip install -r api/requirements-connector.txt
cp api/.env.connector.example .env.connector
```

On Windows use `py -3.12 -m venv .venv-tws` and
`.venv-tws\Scripts\Activate.ps1` instead of the activation command above.

Edit `.env.connector` locally. Set both enabled flags to `true`, fill the dedicated
relay secret, and confirm host, socket port, environment and client ID. Do not put
brokerage username/password, cookies or 2FA values into this file or into Render.

```bash
python -m api.ibkr_tws_client --env-file .env.connector --check-config
python -m api.ibkr_tws_client --env-file .env.connector
```

The first command validates configuration and does not open a brokerage socket.
The second runs until Ctrl+C. Existing exported environment settings take precedence
over the file. Never paste the private file or secret into issue reports or logs.

## Enable the existing official socket manually

Sign into your live or paper TWS/IB Gateway yourself. Complete any IBKR authentication
or 2FA prompts directly. In TWS open **Global Configuration → API → Settings**;
in IB Gateway open **Configure → Settings → API → Settings** (labels can vary by version).
Enable **ActiveX and Socket Clients** where that option is present. Keep **Read-Only API**
checked. Read the socket port shown in that screen and configure the connector to match.
Keep localhost-only access where available; for a private remote connector restrict the
trusted IP list/firewall to that machine. Do not enable public socket access. Use a
nonzero client ID unique among your existing API clients.

| Application | Live default | Paper default |
| --- | --- | --- |
| IB Gateway | 4001 | 4002 |
| TWS | 7496 | 7497 |

Explicit `IBKR_TWS_PORT` always wins. `IBKR_TWS_ENVIRONMENT` describes the configured
session; it does not authenticate or change the brokerage account. The connector
connects with `readonly=True`, disables startup account/order/execution fetches and
also overrides the library's unconditional positions synchronization. No order
submission, order modification, order cancellation or automated login code is exposed.
Cancelling an old **historical-data subscription** during resubscription is not an
order cancellation.

## Settings

Connector-only variables are in `api/.env.connector.example`:

| Variable | Purpose |
| --- | --- |
| `IBKR_TWS_ENABLED=true` | Explicitly allow the independent connector to start |
| `IBKR_TWS_HOST=127.0.0.1` | Local/private Gateway address |
| `IBKR_TWS_APPLICATION=gateway` | Select gateway/tws default port family |
| `IBKR_TWS_ENVIRONMENT=live` | Configured live/paper session |
| `IBKR_TWS_PORT=4001` | Actual socket port; override defaults if needed |
| `IBKR_TWS_CLIENT_ID=11` | Unique nonzero API client ID |
| `IBKR_TWS_READONLY=true` | Required; false is rejected |
| `IBKR_SYMBOL=SPY` | Supported initial contract |
| `IBKR_BAR_SIZE=1 min` | Supported source bar size |
| `IBKR_HISTORY_DURATION=1 D` | Initial bounded lookback; 1 D through 5 D |
| `IBKR_USE_RTH=false` | false selects IBKR-reported extended trading sessions |
| `IBKR_TWS_TIMEOUT_SECONDS=15` | Connection/qualification/heartbeat timeout |
| `IBKR_TWS_RECONNECT_MIN_SECONDS=30` | Initial reconnect delay |
| `IBKR_TWS_RECONNECT_MAX_SECONDS=300` | Exponential backoff cap |
| `IBKR_TWS_HEARTBEAT_SECONDS=20` | Relay/socket health interval, 10–30 seconds |
| `IBKR_RELAY_ENABLED=true` | Permit outbound relay |
| `IBKR_RELAY_BACKEND_URL` | Existing backend HTTPS origin |
| `IBKR_RELAY_SECRET` | Dedicated random secret, at least 32 characters |
| `IBKR_RELAY_CONNECTOR_ID=marketbos-spy` | Must match the receiver |

Backend-only variables to configure **after merge/deployment is authorized**:

```dotenv
IBKR_MARKET_DATA_SOURCE=tws_relay
IBKR_RELAY_ENABLED=true
IBKR_RELAY_SECRET=<same dedicated random secret>
IBKR_RELAY_CONNECTOR_ID=marketbos-spy
IBKR_RELAY_DB_PATH=.data/ibkr_tws_relay.sqlite3
IBKR_RELAY_OFFLINE_SECONDS=75
```

Generate a dedicated secret locally with `python -c "import secrets; print(secrets.token_hex(32))"`
and enter it through private environment settings on both machines. This is not a
brokerage credential. Do not commit it, place it in frontend code or use a `NEXT_PUBLIC_`
variable for it. No production secret has been generated or installed by this work.

Keep the deployed frontend origin in `CORS_ALLOWED_ORIGINS`. Public frontend settings:

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://trading-intelligence-dashboard-1.onrender.com
NEXT_PUBLIC_DEFAULT_SYMBOL=SPY
```

The optional symbol default applies on first load; saved chart selections win. Select
SPY/1m explicitly if an existing saved layout selects MES. Static export remains enabled.

The receiver requires FastAPI's request scheme to be HTTPS. In a reverse proxy setup,
configure Uvicorn to trust forwarded-protocol headers only from the actual ingress
proxy. Do not trust arbitrary incoming `X-Forwarded-Proto` headers. Render terminates
TLS at its ingress; verify this trusted-proxy configuration during the authorized
rollout before starting the relay. Inspect `/api/ibkr/tws/status`: `httpsVerified`
reports the scheme seen by FastAPI after trusted proxy processing. It must be true
for a request through the existing HTTPS backend origin before enabling submissions.
For the existing Render web service, an alternative **explicit opt-in** is
`IBKR_RELAY_RENDER_EDGE_TLS=true`. It requires `RENDER=true` and an
`https://` `RENDER_EXTERNAL_URL`. This trusts Render's managed HTTPS edge
termination as a deployment boundary rather than trusting any client-supplied
`X-Forwarded-Proto` header. Only use it when the service is reachable solely
through Render's managed ingress; it is not suitable for a directly exposed
application port or arbitrary self-hosting. The status endpoint separately
reports `httpsVerified` (ASGI scheme), `renderEdgeTlsPolicy`, and
`relayTransportReady`. HMAC authentication, timestamp, nonce, and replay
checks still apply. Keep the relay disabled until deployment policy and
security tests are reviewed.

Render supplies `FORWARDED_ALLOW_IPS=*` by default. The relay fails closed on Render
with wildcard, unrestricted, invalid or missing proxy trust settings;
`proxyTrustReady` must also be true. Configure only verified ingress IPs/CIDRs before
enabling the relay. This guard does not change the existing Client Portal integration.
An untrusted caller supplying `X-Forwarded-Proto: https` does not satisfy the relay
HTTPS requirement. If the diagnostic is false, restrict Uvicorn `FORWARDED_ALLOW_IPS`
to the actual verified ingress proxy addresses; do not set wildcard trust or guess
address ranges. Leave the relay disabled until that configuration is verified.
Do not create another Render service or change plans.

## Security and recovery

The HMAC covers method, exact route, timestamp, nonce and raw body. Requests older or
more than 90 seconds ahead are rejected. Keep connector and backend clocks synchronized.
Nonces and strictly increasing per-boot sequences are checked in a SQLite write
transaction; retired boots cannot overwrite a newer session. Credentials/account
fields and unknown schema fields are rejected. Payloads are capped at 256 KiB and
500 bars. The connector verifies HTTPS certificates and refuses redirects. It sends
no account/position/order data and never sends the relay secret in the body.

Real socket disconnects reconnect with exponential backoff. Each reconnect qualifies
SPY again and requests a bounded historical backfill plus a new subscription. The
lookback expands to cover the outage up to five days; longer outages set
`gapRecoveryLimited=true`. This warning means older missing data remains missing.
Recovery of an older gap requires an additional explicitly reviewed history workflow;
it is never hidden by fabricated bars.

IBKR errors 1100/2103/2105 report connectivity loss; they are not called authentication
failures. Restored/lost-data notices trigger a paced resubscription/backfill. Historical
requests are separated by at least 60 seconds on recovery. Authentication, competing
session, denied subscription and bad contract/configuration errors pause retries;
resolve the issue manually, then restart the connector. No login/2FA is automated.
A successful socket heartbeat does not update the data-freshness timestamp.

Relay/network outages retain a bounded queue of real candles (20,000) and retry with
backoff. If a backend restart loses its local warehouse, its acknowledgement requests
backfill from the connector's retained real history. Free Render disk is ephemeral;
SQLite is not guaranteed durable across redeployments. No paid disk/service is added.
Keep the connector running to repopulate retained bars. The separate Neural Brain
backup/export procedure still applies to its prediction/outcome/weight storage.

Exchange closures and early closes come from IBKR contract-detail trading hours,
refreshed every six hours. Unknown schedule coverage is not guessed as closed.
The public status distinguishes market closed, waiting, stale, authentication required,
subscription required, Gateway disconnected and connector offline. A recent heartbeat
without a fresh active provider candle is never shown as live market data.

## Validation and remaining live checks

Automated tests use fixtures/mocked sockets and HTTPS only. They test qualification,
UTC conversion, same-minute revisions, completion, duplicate handling, backfill,
reconnects, error states, exchange closures, source isolation, signatures, replay,
sequence checks, HTTPS, size limits, malformed data and existing REST compatibility.
They do not prove that this account has SPY historical or streaming entitlements.

```bash
python -m pip install -r api/requirements-dev.txt
python -m unittest discover -s tests -v
npm install --no-audit --no-fund
npm run build
npm test
```

Install Node dependencies before running the Python tests for the existing TypeScript
Neural Brain parity test. `npm run build` must produce `out/` with every dashboard page.

Before real candles appear: authorize merge and deployment, configure the existing
backend privately, authenticate the official Gateway yourself, enable its read-only
socket, run the connector on its local/private host, confirm the HTTPS relay is accepted,
and select SPY/1m. Inspect `/api/ibkr/tws/status`, `/api/ibkr/status?symbol=SPY`, and
`/api/candles?symbol=SPY&timeframe=1m`. Confirm `source=ibkr_tws`, expected conid and UTC
bar boundaries against TWS; observe actual intrabar revisions and completion. If IBKR
denies access, report **Market-data subscription required** and stop—this work does not
purchase subscriptions or alter brokerage permissions. Market closures may legitimately
produce saved history and no live update. No authenticated live verification has been
performed as part of this branch-only implementation.

Official references:
- https://ib-api-reloaded.github.io/ib_async/api.html
- https://interactivebrokers.github.io/tws-api/historical_bars.html
- https://interactivebrokers.github.io/tws-api/message_codes.html
- https://www.interactivebrokers.com/docs/tws-api/doc/market-data-historical/historical-bars/receiving-historical-bars

The development implementation passed 57 backend tests, fourteen frontend tests and a
production static export build with the optional SPY default. New Python modules pass
Pyflakes. The existing `npm run lint` command requires an ESLint configuration that
the repository does not currently contain; it opens an interactive setup prompt.
Production build TypeScript checks pass. These checks do not verify live entitlements.

The static frontend publishes `/build-info.json` with only its Git commit and build
time. Use this alongside backend `/health` to verify the deployed commit.
