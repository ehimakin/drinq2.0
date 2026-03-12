# Drinq 2.0

Unified repository for Drinq's cross-platform app and API.

## Monorepo Layout

- `apps/mobile` Expo + React Native app (iOS, Android, Web)
- `apps/api` FastAPI backend
- `apps/web` reserved for dedicated web app (if needed later)
- `packages/shared` shared types/schemas/utilities
- `docs` product and architecture notes
- `scripts` project scripts and legacy utilities

## Quick Start

### 1) Mobile app (Expo)

```bash
cd apps/mobile
npm install
npm run start
```

### 2) API (FastAPI)

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

## Notes

- Current mobile feature code includes the Pintless waiting game.
- API includes the matching Pintless endpoints under `/games/pintless/*`.
