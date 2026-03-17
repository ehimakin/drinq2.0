# Drinq 2.0

Unified repository for Drinq's customer web app, optional ops mobile app, and API.

## Monorepo Layout

- `apps/web` primary customer-facing web app, also usable for venue and runner operations
- `apps/mobile` optional Expo ops companion for venue and runner parity work
- `apps/api` FastAPI backend
- `packages/shared` shared types/schemas/utilities
- `docs` product and architecture notes
- `scripts` project scripts and legacy utilities

## Quick Start

### 1) Customer and staff web app

```bash
cd apps/web
python3 -m http.server 4173
```

### 2) API (FastAPI)

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

### 3) Optional mobile ops app

```bash
cd apps/mobile
npm install
npm run start
```

## Platform Split

- Customer: `apps/web`
- Venue: `apps/web` first, `apps/mobile` optional
- Runner: `apps/web` first, `apps/mobile` optional

## Notes

- Expo web renders the mobile app shell, not the primary customer web experience.
- Current mobile feature code includes the Pintless waiting game.
- API includes the matching Pintless endpoints under `/games/pintless/*`.
