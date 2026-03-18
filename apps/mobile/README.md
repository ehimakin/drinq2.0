# Drinq Mobile

Expo + React Native + Expo Router app for optional staff operations and mobile parity work.

Important product rule:

- Customers are expected to use `apps/web`
- Venue staff can use `apps/web` or this Expo app
- Runners can use `apps/web` or this Expo app

## Run

```bash
npm install
npm run start
```

## Routes

- `app/index.tsx` home
- `app/(customer)` secondary customer prototype only, not the primary product surface
- `app/(runner)` runner flow
- `app/(venue)` venue flow
- `app/(admin)` admin flow
