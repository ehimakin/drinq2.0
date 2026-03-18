# Drinq Web Prototype

Rudimentary browser prototype for venue-specific QR menu flow.

## Run locally

```bash
cd /Users/ehim/dev/drinqSoft/drinq2.0/apps/web
python3 -m http.server 4173
```

Open:

- `http://localhost:4173/?venue=brentford-fc`

Start API in another terminal:

```bash
cd /Users/ehim/dev/drinqSoft/drinq2.0/apps/api
source .venv/bin/activate
uvicorn src.main:app --reload --port 8000
```

Then use:

- `http://localhost:4173/?venue=brentford-fc&api=http://localhost:8000`

## Role-based views

Default role is `customer` (no staff buttons shown).

Use query param `role` for staff prototypes:

- Runner: `?role=runner`
- Venue ops: `?role=venue`
- Admin (both): `?role=admin`

Example:

- `http://localhost:4173/?venue=brentford-fc&api=http://localhost:8000&role=runner`

## Staff PIN gate (dev)

Staff routes now require PIN-based login through API.

- Endpoint: `POST /api/staff/auth`
- Default local dev PIN for `brentford-fc`: `8888`

IMPORTANT:

- This PIN is for local prototype use only and must be replaced before production.

## QR URL format

Use a venue slug in the URL:

- `http://<host>:4173/?venue=brentford-fc`

For local phone testing, replace `<host>` with your machine LAN IP, for example:

- `http://192.168.0.13:4173/?venue=brentford-fc`

The page supports:

- query parameter: `?venue=<slug>`
- hash route: `#/v/<slug>`
- path route: `/v/<slug>` (works when host has fallback routing)
- checkout route: `#/checkout`
- order status route: `#/order-status/<orderId>`
- runner dashboard route: `#/runner`
- venue ops route: `#/venue`
