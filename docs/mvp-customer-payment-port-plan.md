# MVP Customer And Payment Port Plan

## Scope

This document extracts the useful customer-flow and payment-flow behavior from the legacy MVP and converts it into an implementation backlog for `drinq2.0`.

Reference source files:

- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/MenuViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/OrderViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/ExecutePaymentViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/AuthenticateViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/createorder.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/updateStream.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/payment.php`

## MVP Customer Flow Behaviors Worth Porting

### 1. Active-order gating is central, not optional

Observed behavior:

- The native menu flow repeatedly checks for `current_order_id`.
- If an order already exists, the user is routed back toward the order/status flow instead of starting over.
- This is present both in navigation behavior and in explicit alert copy.

Why it matters:

- This is one of the MVP’s strongest product instincts.
- It gives customers a predictable mental model.
- It reduces duplicate ordering risk.

`drinq2.0` direction:

- Keep server-side active-order enforcement as the source of truth.
- Keep menu browse access while locking order creation when appropriate.
- Make `Resume Active Order` the canonical escape hatch.

Backlog:

- Refine all customer entry points so they reconcile active state before allowing cart/checkout progression.
- Keep this enforcement in backend rules, not just UI controls.

### 2. The order-status screen is the center of the post-checkout experience

Observed behavior:

- The MVP treats the order view as the persistent “home” for an active order.
- Payment, collection, and receipt flows all orbit that screen.
- The app uses local state plus server polling to keep the customer anchored there.

Why it matters:

- This is the correct product shape for fulfilment-heavy ordering.

`drinq2.0` direction:

- Continue making the order-status route the durable recovery point for every live order.
- Avoid scattering the live-order experience across multiple loosely connected screens.

Backlog:

- Tighten customer order-status copy and progression states.
- Make every post-checkout path route through status and back to status cleanly.

### 3. Click and collect should feel operationally distinct

Observed behavior:

- The MVP explicitly shows a collection code to the customer after payment.
- Collection is not treated like delivery.

Why it matters:

- It validates the current direction in `drinq2.0` to branch collect away from runner flow.

`drinq2.0` direction:

- Keep click-and-collect as its own fulfilment lane.
- Show the pickup code prominently once the order is ready for collection.

Backlog:

- Improve customer-facing ready-for-collection screen copy.
- Consider a more deliberate pickup-code presentation rather than plain text only.

### 4. Lightweight remembered state creates continuity

Observed behavior:

- The MVP relies heavily on local persisted state such as `current_order_id`, `paymentSet`, and profile/payment markers.
- This gave continuity across app transitions, even if the implementation was fragile.

Why it matters:

- The product benefit is valid even if the implementation should change.

`drinq2.0` direction:

- Keep lightweight device continuity.
- Prefer backend-backed state with minimal local markers.

Backlog:

- Continue keeping local `active_order_id` and customer token.
- Reconcile from the server whenever the app resumes or route changes.

## MVP Payment Behaviors Worth Porting

### 1. Payment is part of fulfilment, not a detached settings feature

Observed behavior:

- The MVP pulls payment directly into the order lifecycle.
- Order completion, payment execution, receipt, and collection are tightly linked.

Why it matters:

- This is correct product thinking.
- Payment setup is valuable only insofar as it accelerates ordering and completion.

`drinq2.0` direction:

- Keep payment integrated with checkout and order status.
- Avoid building “payment settings” in isolation before the ordering flow is solid.

Backlog:

- Define payment milestones inside the order lifecycle:
  - payment required
  - payment authorized
  - payment confirmed
  - receipt available

### 2. Saved payment preference matters, but raw card handling should not survive

Observed behavior:

- The MVP attempted saved card behavior and repeat payment shortcuts.
- It also directly handled too much payment detail client-side and across custom backend code.

Why it matters:

- The product objective is strong.
- The implementation is not acceptable to transplant.

`drinq2.0` direction:

- Preserve the repeat-payment ambition.
- Rebuild with PSP-managed tokens and wallet flows only.

Backlog:

- Introduce a payment abstraction in `apps/api` for:
  - provider customer id
  - preferred method type
  - tokenized method reference
  - wallet capability flags
- Keep raw card data out of Drinq systems entirely.

### 3. Receipt and proof-of-payment are part of trust

Observed behavior:

- The MVP spends a lot of UI and flow effort on receipt handling.
- Payment success is not just a silent flag; it changes what the customer sees and can do.

Why it matters:

- Customers need confidence that the order was accepted and paid.

`drinq2.0` direction:

- Treat receipt/confirmation as a first-class order outcome.

Backlog:

- Add clear order-paid confirmation state.
- Add a receipt-ready concept even if the first version is simple.
- Tie click-and-collect code and paid confirmation together where relevant.

### 4. Payment method fallback logic is valuable

Observed behavior:

- The MVP clearly explored multiple payment routes and fallback behaviors.
- It tried to adapt based on what the venue or stored customer state supported.

Why it matters:

- Different venues and devices will support different payment methods.

`drinq2.0` direction:

- Keep flexible payment capability handling.
- Do not hard-code per-provider behavior into the UI.

Backlog:

- Model payment capabilities per venue and per customer/device.
- Render checkout payment choices from capability data, not fixed assumptions.

## MVP Behaviors To Avoid Repeating

### 1. Local state as the primary source of truth

The MVP stores too much operational truth in `UserDefaults`.

In `drinq2.0`:

- local state should help recovery
- server state should decide reality

### 2. Payment state spread across many ad hoc flags

The MVP uses values like:

- `paymentSet`
- `paymentExecuted`
- `current_order_completed`
- `receipt`

This creates coupling and ambiguity.

In `drinq2.0`:

- derive payment and fulfilment state from the order model
- keep local flags minimal and disposable

### 3. Tight coupling between payment implementation and app navigation

The MVP navigation logic is heavily entangled with payment branch logic.

In `drinq2.0`:

- keep payment execution logic isolated
- let route transitions respond to order state, not payment implementation details

## Concrete `drinq2.0` Backlog

### Priority A

- Finish explicit order lifecycle modeling for paid vs unpaid progression.
- Add customer-facing paid/confirmed state in the order-status UI.
- Tighten click-and-collect status presentation and pickup-code display.
- Keep one-active-order enforcement consistent across all customer entry points.

### Priority B

- Design a PSP-backed payment preference model.
- Add provider-neutral payment capability fields to customer and venue models.
- Refactor checkout so payment options are rendered from capability data.

### Priority C

- Add a lightweight receipt view or receipt-ready state.
- Add account-upgrade hooks that build on remembered customer state.
- Revisit magic-link or OTP verification for higher-trust flows.

## Recommended Implementation Order

1. Lock order state semantics first.
2. Make customer status and collect experience feel complete.
3. Add payment capability and preference modeling.
4. Rebuild repeat-payment flow using a modern PSP.
5. Add higher-trust identity upgrade and account surfaces.

## Immediate Build Recommendation

The next code work after this audit should not be “port payment from the MVP.”

It should be:

1. finish the customer and collect fulfilment lifecycle in `drinq2.0`
2. define a modern payment domain model
3. then rebuild payment UX on top of that model

That preserves the MVP’s strongest product instincts without importing its technical debt.
