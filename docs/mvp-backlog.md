# MVP Port Backlog For `drinq2.0`

## Purpose

This backlog turns the MVP migration audit into a practical build order for the current repo.

Target code paths:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`
- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`
- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/styles.css`

This is intentionally ordered by operational value and dependency, not by subsystem.

## Current Baseline

Already in place:

- remembered-customer checkout path
- guest checkout
- active-order lookup for customers and runners
- runner assignment guards
- click-and-collect split from runner flow
- pickup code generation and verification
- background polling for order, runner, and venue views

What is still missing is a more complete product layer around payment, customer status semantics, and a few MVP-grade workflow refinements.

## Priority 1: Complete The Core Order Lifecycle

### 1. Add explicit payment state to the order model

Why:

- The MVP tied payment tightly to fulfilment.
- The current prototype still treats all orders as if payment is mostly implicit.

Implement:

- add payment state fields to `orders`
- minimum useful shape:
  - `payment_status`
  - `payment_reference`
  - `paid_at`
  - `receipt_url` or `receipt_reference`

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`

### 2. Make customer order status copy reflect fulfilment mode and payment state

Why:

- The MVP made the order/status view the center of the live-order journey.
- `drinq2.0` already has the route, but the content is still sparse.

Implement:

- better customer-facing copy for:
  - awaiting venue acceptance
  - accepted/preparing
  - ready for collection
  - assigned / out for delivery
  - paid / unpaid / failed payment
  - uncollected warning

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`

### 3. Add a customer-facing “collection phase” presentation

Why:

- Click and collect now works operationally, but the customer experience should feel distinct and confident.

Implement:

- pickup code emphasis
- ready-for-collection guidance
- 12-minute hold warning
- collected confirmation
- uncollected explanation

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`
- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/styles.css`

## Priority 2: Finish MVP-Grade Customer Reliability

### 4. Reconcile customer identity and active-order state on every important route

Why:

- The MVP was aggressive about not letting customers drift into broken states.

Implement:

- audit menu, checkout, order status, and route recovery
- ensure each one resolves remembered customer and active order consistently

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`

### 5. Reduce browser fragility in public customer requests

Why:

- We already hit browser-side issues from mobile cross-origin behavior.
- The same class of issue can reappear on customer GETs that still use custom headers.

Implement:

- move customer token from custom header to a safer transport on public customer routes
- examples:
  - query param
  - cookie
  - simple auth token field design

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`
- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`

### 6. Add customer order history endpoint semantics properly

Why:

- The MVP clearly leaned on continuity and history.
- The current remembered-customer model is ready for this.

Implement:

- `GET /api/customers/orders`
- scope by remembered customer token
- include only attributable orders
- sort newest first

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`

## Priority 3: Introduce A Real Payment Domain Model

### 7. Add `customer_payment_preferences`

Why:

- The MVP product intent around saved payment is important.
- It should not live as ad hoc flags on the customer or in local storage.

Implement:

- new table for tokenized preference metadata
- suggested fields:
  - `customer_id`
  - `provider`
  - `provider_customer_id`
  - `preferred_method_type`
  - `preferred_method_reference`
  - `last4`
  - `brand`
  - `wallet_type`
  - `created_at`
  - `updated_at`

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`

### 8. Add payment capability metadata per venue

Why:

- The MVP explored multiple payment routes and fallbacks.
- Checkout should eventually render choices from capability data, not fixed assumptions.

Implement:

- per venue:
  - supports wallet
  - supports saved card
  - pay on collection allowed
  - pay before fulfilment required

Target:

- likely venue data model in API plus corresponding web rendering

### 9. Define payment status transitions that align with fulfilment

Why:

- Payment and fulfilment should not be independent guesses.

Implement:

- minimum path:
  - `unpaid`
  - `authorization_pending`
  - `authorized`
  - `captured`
  - `failed`
  - `refunded`

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`

## Priority 4: Improve Venue And Runner Operations

### 10. Add aging indicators for collect and delivery orders

Why:

- The MVP’s stream-driven ops model was trying to solve queue pressure.

Implement:

- age badges in venue ops
- separate emphasis for:
  - newly received
  - waiting too long
  - ready for collection nearing deadline

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`
- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/styles.css`

### 11. Add dedicated collect lane presentation in venue ops

Why:

- Click and collect is now operationally separate and should feel separate visually too.

Implement:

- dedicated section or clear visual grouping for collect orders
- clearer pickup-code handling
- better emphasis on `Ready For Collection`, `Verify Collected`, `Mark Uncollected`

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`

### 12. Keep runner queue focused on delivery-ready work only

Why:

- This is one of the MVP’s strongest operational instincts.

Implement:

- continue excluding collect orders
- consider excluding not-yet-actionable delivery orders from runner attention

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`

## Priority 5: Build The Upgrade Path From Remembered Customer To Account

### 13. Add account-upgrade fields to customers

Why:

- The current Level 1 remembered-customer model is intentionally lightweight.
- The next step should be additive, not identity-replacing.

Implement:

- fields such as:
  - `account_level`
  - `password_hash` or auth-provider linkage
  - `verified_email_at`
  - `verified_phone_at`

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`

### 14. Add invitation points for upgrade

Why:

- The MVP had stronger native onboarding and gated value exchange.

Implement:

- invite after successful repeat order
- invite after receipt/history access
- invite when perks become relevant

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`

## Recommended Working Order

### Sprint A

- payment state fields on orders
- customer status copy pass
- improved click-and-collect customer presentation
- public customer request hardening

### Sprint B

- customer order history
- collect lane presentation in venue ops
- order aging indicators

### Sprint C

- customer payment preferences schema
- venue payment capability model
- checkout payment capability rendering

### Sprint D

- account-upgrade schema and invitation points

## What To Avoid

- do not port MVP payment code directly
- do not mirror MVP local-state sprawl in the browser
- do not let the UI become the source of order truth
- do not delay payment domain modeling until after more UI work

## Immediate Best Next Task

If implementation starts from this backlog today, the best first build is:

1. add payment state to orders
2. improve customer order-status and click-and-collect presentation
3. harden public customer token transport

That would convert the current prototype from “operationally working” to “product-shape credible” without pulling in legacy debt.
