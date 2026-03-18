# Drinq MVP Migration Audit

## Scope

This audit compares the legacy MVP in `/Users/ehim/dev/Drinq` with the current `drinq2.0` repo in `/Users/ehim/dev/drinqSoft/drinq2.0`.

The goal is not a raw merge. The goal is to identify which MVP behaviors are worth preserving and how they should be rebuilt inside the current `apps/api` and `apps/web` architecture.

## What Exists In The MVP

### Legacy backend shape

The MVP backend is a PHP/MySQL endpoint cluster under:

- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL`

Key files inspected:

- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/engine.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/createorder.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/updateStream.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/fetchmenu.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/fetchorders.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/payment.php`

Observed characteristics:

- A central `TSP_orders` table drives order lifecycle.
- Order state is represented as timestamp columns such as `received`, `accepted`, `completed`, `collected`, `rejected`, `paid`.
- Venue-specific menus are represented with dynamic or venue-scoped table naming.
- API responses are inconsistent: JSON in some places, custom delimiter strings in others.
- The polling/stream concept is implemented by repeatedly reading order rows and comparing state on the client side.

### Native iOS app shape

The MVP iOS app is under:

- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq`

Key files inspected:

- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/VenueViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/MenuViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/OrderViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/ExecutePaymentViewController.swift`
- `/Users/ehim/dev/Drinq/Drinq Server Files/Drinq_prd/Drinq/Drinq/AuthenticateViewController.swift`

Observed product patterns:

- Strong active-order gating: users are prevented from beginning a new order while another is still live.
- Venue and runner flows are operationally distinct.
- The order-status screen is central to the experience and survives transitions between payment, collection, and completion.
- Payment and wallet behavior were clearly explored in depth.
- There is an explicit authentication or verification step for elevated access.

## MVP Behaviors Worth Keeping

### 1. Active-order protection

The MVP consistently tries to stop a customer from creating multiple live orders.

Why it matters:

- It prevents duplicate fulfilment.
- It reduces confusion when customers navigate unpredictably.
- It keeps the operational side manageable.

Current `drinq2.0` status:

- Already partly implemented in `apps/api/src/main.py`.
- Should be preserved and tightened further.

Recommendation:

- Keep and formalize this as a backend-enforced rule.
- Continue using active-order lookup on page entry and status polling on the client.

### 2. Stream-like order state updates

The MVP polling engine is primitive but directionally correct: the client keeps checking for changes and reacts to order state transitions.

Why it matters:

- This is the right foundation for resilient status pages and runner dashboards.

Current `drinq2.0` status:

- Already moving in the right direction with `version` and polling.

Recommendation:

- Keep the model, not the implementation.
- Rebuild it cleanly with explicit JSON APIs and change markers like `version` and `updated_at`.

### 3. Clear separation of customer, venue, and runner experiences

The MVP treats roles differently in a product sense, not just a permission sense.

Why it matters:

- Runner and venue workflows have different operational constraints.
- Customer flow should optimize confidence and low friction.

Current `drinq2.0` status:

- Already reflected in route separation and role-based screens.

Recommendation:

- Keep this separation and continue rebuilding each lane explicitly.

### 4. Payment UX ambition

The MVP shows that payment, wallet behavior, and saved payment preference were central product concerns.

Why it matters:

- Frictionless repeat payment is core to the product.

Current `drinq2.0` status:

- Still early and intentionally simplified.

Recommendation:

- Preserve the product intent.
- Do not preserve the legacy implementation.
- Rebuild around a modern PSP and tokenized wallet flow.

## MVP Elements That Should Not Be Ported Directly

### 1. Legacy payment integrations and embedded credentials

Examples:

- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/payment.php`
- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/engine.php`

Problems:

- Hard-coded credentials
- Legacy provider coupling
- Unsafe secret handling

Recommendation:

- Replace entirely.
- Use environment-managed credentials and a modern PSP integration.

### 2. Stringly typed PHP endpoints and delimiter-based responses

Example:

- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/createorder.php`

Problems:

- Hard to validate
- Hard to evolve
- Brittle parsing on the client

Recommendation:

- Replace entirely with typed JSON APIs in FastAPI.

### 3. Timestamp-column state machine

Example:

- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/updateStream.php`

Problems:

- State is inferred from many nullable columns
- Transition enforcement is weak
- Hard to branch fulfilment modes cleanly

Recommendation:

- Keep the business sequence.
- Replace the persistence model with explicit `status`, `version`, and optional audit history.

### 4. Venue-specific table naming and dynamic schema assumptions

Example:

- `/Users/ehim/dev/Drinq/Drinq Server Files/SwiftToMySQL/fetchmenu.php`

Problems:

- Hard to scale
- Hard to query consistently
- Hard to migrate

Recommendation:

- Normalize around shared tables with venue foreign keys.

## Translation Matrix Into `drinq2.0`

### Port as product behavior

- Active-order blocking and recovery
- Role-specific workflows
- Live order progression model
- Customer-facing order-status centrality
- Strong repeat-order convenience
- Verification for higher-trust operations

### Rebuild in current architecture

- Order stream/polling
- Menu and venue data APIs
- Checkout submission
- Click-and-collect flow
- Runner assignment and progression
- Customer profile and upgrade path
- Payment and saved payment preferences

### Defer until core flows stabilize

- Full account signup perks and loyalty
- Deep payment preference management
- Native mobile rebuild
- Rich notifications and background behaviors

### Discard

- Hard-coded secrets
- Delimiter responses
- Dynamic table naming
- Loose PHP scripts with mixed side effects
- Direct migration of vendor directories or pods logic

## Recommended Migration Order

### Phase 1: Lock the backend state model

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/api/src/main.py`

Work:

- Finish hardening explicit status transitions.
- Keep customer, runner, venue, and collect branches cleanly separated.
- Add any missing query endpoints needed to mirror MVP operational confidence.

### Phase 2: Port proven UX behaviors from native app into web

Target:

- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/app.js`
- `/Users/ehim/dev/drinqSoft/drinq2.0/apps/web/styles.css`

Work:

- Audit the native app’s order-status and gating behaviors.
- Port the best UX ideas to web equivalents.
- Keep server state as source of truth.

### Phase 3: Rebuild payment flow intentionally

Target:

- `apps/api`
- `apps/web`

Work:

- Define the PSP strategy.
- Recreate saved-payment behavior without storing raw payment details.
- Preserve the MVP’s low-friction ambition, not its implementation.

### Phase 4: Rebuild identity upgrade path

Work:

- Keep the current Level 1 remembered profile model.
- Add Level 2 authenticated account upgrade based on explicit value exchange.
- Ensure historical orders only surface when attribution is trustworthy.

### Phase 5: Decide whether to rebuild native mobile

Work:

- Only after API and operational flows stabilize.
- Use the MVP iOS app as a reference for product patterns, not as a codebase to transplant.

## Immediate Next Recommendation

Do not merge the MVP repo into `drinq2.0`.

Instead:

1. Continue shipping core operational correctness in `drinq2.0`.
2. Use the MVP as a reference archive.
3. Run a second-pass audit focused on one vertical at a time:
   - customer flow
   - venue flow
   - runner flow
   - payment flow
4. Port the strongest MVP behavior from each vertical into the current stack.

## Highest-Risk MVP Areas

- Secret management
- Payment code
- Auth/verification assumptions
- Database coupling
- Duplicate and partially obsolete server directories

## Best MVP Assets To Reuse

- Product behavior
- UI flow ideas
- Operational sequencing
- Some branding and design assets

The best use of the MVP is as a behavioral reference, not as a code donor in bulk.
