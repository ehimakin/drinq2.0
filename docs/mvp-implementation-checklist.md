# Drinq MVP Implementation Checklist

## 1. Stabilize baseline

- Commit current `dev` branch state so new work is incremental.
- Keep customer web + API flow runnable.

## 2. Complete customer web MVP

- Keep routes:
  - menu (`/`)
  - checkout (`#/checkout`)
  - order status (`#/order-status/:id`)
- Keep register + order create flow through API.

## 3. Add venue ops web screen

- Add `#/venue` dashboard for:
  - incoming orders
  - accept / reject
  - mark ready for handoff
- Add API endpoints:
  - `POST /api/orders/{id}/accept`
  - `POST /api/orders/{id}/reject`
  - `POST /api/orders/{id}/ready`

## 4. Build runner mobile MVP routes

- Add runner app route group:
  - `apps/mobile/app/(runner)/index.tsx`
  - `apps/mobile/app/(runner)/order/[id].tsx`
- Show queue for venue slug.
- Allow state updates from runner UI.

## 5. Enforce backend state machine

- Canonical flow:
  - `received -> accepted -> ready -> assigned -> loaded -> en_route -> arrived -> fulfilled`
- Terminal:
  - `rejected`, `cancelled`, `failed`, `fulfilled`
- Reject invalid transitions with `409`.

## 6. Persist operational metadata

- Add fields/tables later for:
  - runner assignment metadata
  - event logs
  - SLA timings

## 7. Manual acceptance test

- Customer places order via web.
- Venue accepts and marks ready.
- Runner assigns and delivers.
- Customer status page reflects each transition.
