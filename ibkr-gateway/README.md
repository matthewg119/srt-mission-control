# IBKR Client Portal Gateway

Runs the official Interactive Brokers Client Portal Gateway in Docker,
exposing the IBKR Web API on `https://localhost:5055`.

## Setup

1. Copy `.env.example` to `.env` and set your paper account ID:
   ```
   cp .env.example .env
   # edit IBKR_ACCOUNT_ID=DU...
   ```

2. Build and start the container:
   ```
   cd ibkr-gateway
   docker compose up -d --build
   ```

3. Open **https://localhost:5055** in your browser.
   - Accept the self-signed cert warning ("Advanced → Proceed to localhost")
   - Log in with your **IBKR Paper** credentials (the DU... account)
   - You should see "Client login succeeds"

4. Verify authentication:
   ```
   curl -k https://localhost:5055/v1/api/iserver/auth/status
   # Expected: {"authenticated":true,"competing":false,...}
   ```

## Auth expiry

IBKR sessions last approximately **24 hours**. After that the gateway returns
`{"authenticated":false}` and the bot will stop trading and send a Telegram
alert. To re-authenticate, open https://localhost:5055 again and log in.

To keep the session alive, the gateway automatically pings IBKR every few
minutes, but this only extends the session — it cannot refresh it fully after
expiry without a new browser login.

## Stopping

```
docker compose down
```

## VPS deployment (future)

When deploying to a cloud VPS:
1. Install a real TLS certificate for the VPS domain (Let's Encrypt is free)
2. Update `conf.yaml` to use your cert + key
3. Set `IBKR_GATEWAY_URL=https://your-vps-domain.com:5055` in Vercel env vars
4. Remove `NODE_TLS_REJECT_UNAUTHORIZED=0` — never use this flag over public internet
5. Lock `ips.allow` in `conf.yaml` to your bot server's IP only

## API reference

- Auth status: `GET /v1/api/iserver/auth/status`
- Tickle (keep-alive): `POST /v1/api/tickle`
- Contract search: `POST /v1/api/iserver/secdef/search`
- Price history: `GET /v1/api/iserver/marketdata/history`
- Options chain: `GET /v1/api/iserver/secdef/strikes`
- Place order: `POST /v1/api/iserver/account/{accountId}/orders`
- Positions: `GET /v1/api/portfolio/{accountId}/positions/0`

Full docs: https://www.interactivebrokers.com/api/doc.html
Reference impl: https://github.com/hackingthemarkets/interactive-brokers-web-api
