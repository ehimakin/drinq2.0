import json
import sqlite3
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.mobile.games.trivia.pintless.api import router as pintless_router

app = FastAPI(title="Drinq API")
app.include_router(pintless_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).resolve().parents[1] / "drinq.sqlite3"
OrderStatus = Literal[
    "received",
    "accepted",
    "ready",
    "assigned",
    "loaded",
    "en_route",
    "arrived",
    "fulfilled",
    "rejected",
    "cancelled",
    "failed",
]
TERMINAL_STATUSES = {"fulfilled", "rejected", "cancelled", "failed"}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "received": {"accepted", "rejected", "cancelled"},
    "accepted": {"ready", "assigned", "cancelled"},
    "ready": {"assigned", "loaded", "cancelled"},
    "assigned": {"loaded", "en_route", "cancelled"},
    "loaded": {"en_route", "arrived", "cancelled"},
    "en_route": {"arrived", "failed", "cancelled"},
    "arrived": {"fulfilled", "failed", "cancelled"},
    "fulfilled": set(),
    "rejected": set(),
    "cancelled": set(),
    "failed": set(),
}
# DEV ONLY: default staff PIN map for local prototype testing.
# Remove this and replace with secure per-venue credential management before production.
DEV_STAFF_PINS: dict[str, str] = {
    "brentford-fc": "8888",
}
STAFF_TOKENS: dict[str, dict[str, str]] = {}
ACTIVE_CUSTOMER_ORDER_STATUSES = (
    "received",
    "accepted",
    "ready",
    "assigned",
    "loaded",
    "en_route",
    "arrived",
)
ACTIVE_RUNNER_ORDER_STATUSES = ("assigned", "loaded", "en_route", "arrived")


class RegisterRequest(BaseModel):
    name: str
    email: str
    venue_slug: str


class CustomerProfileRequest(BaseModel):
    venue_slug: str
    name: str
    email: str
    delivery_mode: str
    delivery_target: str


class OrderItem(BaseModel):
    item_id: str
    item_name: str
    price_text: str
    quantity: int


class CreateOrderRequest(BaseModel):
    venue_slug: str
    customer_name: str
    customer_email: str
    delivery_mode: str
    delivery_target: str
    items: list[OrderItem]
    checkout_type: Literal["guest", "remembered"] = "guest"
    customer_token: str | None = None


class UpdateOrderStatusRequest(BaseModel):
    status: OrderStatus


class StaffAuthRequest(BaseModel):
    venue_slug: str
    pin: str
    role: Literal["runner", "venue", "admin"]


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS mailing_list (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          venue_slug TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_slug TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          default_delivery_mode TEXT NOT NULL,
          default_delivery_target TEXT NOT NULL,
          preferred_payment_method TEXT,
          profile_token TEXT NOT NULL UNIQUE,
          account_level TEXT NOT NULL DEFAULT 'profile',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_order_at TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_venue_email
        ON customers (venue_slug, email)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_slug TEXT NOT NULL,
          customer_id INTEGER,
          assigned_runner_token TEXT,
          assigned_runner_role TEXT,
          customer_name TEXT NOT NULL,
          customer_email TEXT NOT NULL,
          delivery_mode TEXT NOT NULL,
          delivery_target TEXT NOT NULL,
          items_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          checkout_type TEXT NOT NULL DEFAULT 'guest',
          status TEXT NOT NULL,
          eta_text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        )
        """
    )
    cur.execute("PRAGMA table_info(orders)")
    order_columns = {str(row[1]) for row in cur.fetchall()}
    if "customer_id" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN customer_id INTEGER")
    if "assigned_runner_token" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN assigned_runner_token TEXT")
    if "assigned_runner_role" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN assigned_runner_role TEXT")
    if "version" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    if "checkout_type" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN checkout_type TEXT NOT NULL DEFAULT 'guest'")
    conn.commit()
    conn.close()


def read_order_row(cur: sqlite3.Cursor, order_id: int) -> sqlite3.Row:
    cur.execute(
        """
        SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
               customer_name, customer_email, delivery_mode, delivery_target,
               items_json, version, checkout_type, status, eta_text, created_at, updated_at
        FROM orders
        WHERE id = ?
        """,
        (order_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    return row


def read_active_customer_order_row(cur: sqlite3.Cursor, *, venue_slug: str, customer_id: int) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
               customer_name, customer_email, delivery_mode, delivery_target,
               items_json, version, checkout_type, status, eta_text, created_at, updated_at
        FROM orders
        WHERE venue_slug = ? AND customer_id = ? AND status IN (?, ?, ?, ?, ?, ?, ?)
        ORDER BY id DESC
        LIMIT 1
        """,
        (venue_slug, customer_id, *ACTIVE_CUSTOMER_ORDER_STATUSES),
    )
    return cur.fetchone()


def read_active_runner_order_row(cur: sqlite3.Cursor, *, venue_slug: str, runner_token: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
               customer_name, customer_email, delivery_mode, delivery_target,
               items_json, version, checkout_type, status, eta_text, created_at, updated_at
        FROM orders
        WHERE venue_slug = ? AND assigned_runner_token = ? AND status IN (?, ?, ?, ?)
        ORDER BY id DESC
        LIMIT 1
        """,
        (venue_slug, runner_token, *ACTIVE_RUNNER_ORDER_STATUSES),
    )
    return cur.fetchone()


def serialize_order_row(row: sqlite3.Row) -> dict[str, object]:
    return {
        "order_id": row["id"],
        "venue_slug": row["venue_slug"],
        "customer_id": row["customer_id"],
        "assigned_runner_token": row["assigned_runner_token"],
        "assigned_runner_role": row["assigned_runner_role"],
        "customer_name": row["customer_name"],
        "customer_email": row["customer_email"],
        "delivery_mode": row["delivery_mode"],
        "delivery_target": row["delivery_target"],
        "items": json.loads(row["items_json"]),
        "version": row["version"],
        "checkout_type": row["checkout_type"],
        "status": row["status"],
        "eta_text": row["eta_text"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def transition_order_status(
    cur: sqlite3.Cursor,
    order_id: int,
    target_status: OrderStatus,
    *,
    actor_role: str,
    actor_token: str | None = None,
) -> dict[str, str | int]:
    row = read_order_row(cur, order_id)
    current_status = str(row["status"])
    if current_status == target_status:
        return {"order_id": order_id, "status": current_status, "version": int(row["version"])}

    if current_status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Cannot transition terminal status '{current_status}'.")

    allowed = ALLOWED_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Invalid transition '{current_status}' -> '{target_status}'.",
        )

    assigned_runner_token = row["assigned_runner_token"]
    assigned_runner_role = row["assigned_runner_role"]
    if actor_role == "runner":
        if target_status == "assigned":
            if assigned_runner_token and assigned_runner_token != actor_token:
                raise HTTPException(status_code=409, detail="Order is already assigned to another runner.")
            existing_runner_order = read_active_runner_order_row(
                cur,
                venue_slug=str(row["venue_slug"]),
                runner_token=str(actor_token),
            )
            if existing_runner_order is not None and int(existing_runner_order["id"]) != order_id:
                raise HTTPException(status_code=409, detail="Runner already has an active assigned order.")
            assigned_runner_token = actor_token
            assigned_runner_role = actor_role
        elif target_status in ACTIVE_RUNNER_ORDER_STATUSES:
            if assigned_runner_token != actor_token:
                raise HTTPException(status_code=403, detail="Order is assigned to a different runner.")

    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE orders
        SET status = ?, updated_at = ?, version = COALESCE(version, 1) + 1,
            assigned_runner_token = ?, assigned_runner_role = ?
        WHERE id = ?
        """,
        (target_status, now, assigned_runner_token, assigned_runner_role, order_id),
    )
    cur.execute("SELECT version FROM orders WHERE id = ?", (order_id,))
    version_row = cur.fetchone()
    version = int(version_row["version"]) if version_row is not None else 1
    return {"order_id": order_id, "status": target_status, "version": version}


def make_profile_token() -> str:
    return secrets.token_urlsafe(24)


def serialize_customer_profile(row: sqlite3.Row) -> dict[str, str | int | None]:
    return {
        "customer_id": row["id"],
        "venue_slug": row["venue_slug"],
        "name": row["name"],
        "email": row["email"],
        "delivery_mode": row["default_delivery_mode"],
        "delivery_target": row["default_delivery_target"],
        "preferred_payment_method": row["preferred_payment_method"],
        "account_level": row["account_level"],
        "customer_token": row["profile_token"],
    }


def get_staff_token(authorization: str | None, *, venue_slug: str, allowed_roles: set[str]) -> tuple[str, dict[str, str]]:
    token_record = require_staff_token(authorization, venue_slug=venue_slug, allowed_roles=allowed_roles)
    token = authorization.split(" ", 1)[1].strip() if authorization else ""
    return token, token_record


def read_customer_by_token(cur: sqlite3.Cursor, venue_slug: str, token: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
               preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
        FROM customers
        WHERE venue_slug = ? AND profile_token = ?
        """,
        (venue_slug, token),
    )
    return cur.fetchone()


def upsert_customer_profile(
    cur: sqlite3.Cursor,
    *,
    venue_slug: str,
    name: str,
    email: str,
    delivery_mode: str,
    delivery_target: str,
    customer_token: str | None = None,
) -> sqlite3.Row:
    now = datetime.now(timezone.utc).isoformat()
    normalized_venue_slug = venue_slug.strip()
    normalized_name = name.strip()
    normalized_email = email.strip().lower()
    normalized_delivery_mode = delivery_mode.strip()
    normalized_delivery_target = delivery_target.strip()

    existing: sqlite3.Row | None = None
    if customer_token:
        existing = read_customer_by_token(cur, normalized_venue_slug, customer_token.strip())

    if existing is None:
        cur.execute(
            """
            SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
                   preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
            FROM customers
            WHERE venue_slug = ? AND email = ?
            """,
            (normalized_venue_slug, normalized_email),
        )
        existing = cur.fetchone()

    if existing is None:
        token = customer_token.strip() if customer_token else make_profile_token()
        cur.execute(
            """
            INSERT INTO customers (
              venue_slug, name, email, default_delivery_mode, default_delivery_target,
              preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'profile', ?, ?, ?)
            """,
            (
                normalized_venue_slug,
                normalized_name,
                normalized_email,
                normalized_delivery_mode,
                normalized_delivery_target,
                None,
                token,
                now,
                now,
                now,
            ),
        )
        customer_id = cur.lastrowid
    else:
        token = str(existing["profile_token"] or customer_token or make_profile_token())
        customer_id = int(existing["id"])
        cur.execute(
            """
            UPDATE customers
            SET name = ?, email = ?, default_delivery_mode = ?, default_delivery_target = ?,
                profile_token = ?, updated_at = ?, last_order_at = ?
            WHERE id = ?
            """,
            (
                normalized_name,
                normalized_email,
                normalized_delivery_mode,
                normalized_delivery_target,
                token,
                now,
                now,
                customer_id,
            ),
        )

    cur.execute(
        """
        SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
               preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
        FROM customers
        WHERE id = ?
        """,
        (customer_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Could not load customer profile.")
    return row


def require_staff_token(
    authorization: str | None,
    *,
    venue_slug: str | None = None,
    allowed_roles: set[str] | None = None,
) -> dict[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization token.")
    token = authorization.split(" ", 1)[1].strip()
    token_record = STAFF_TOKENS.get(token)
    if token_record is None:
        raise HTTPException(status_code=401, detail="Invalid or expired staff token.")

    if venue_slug and token_record["venue_slug"] != venue_slug:
        raise HTTPException(status_code=403, detail="Token does not match venue.")

    if allowed_roles and token_record["role"] not in allowed_roles:
        raise HTTPException(status_code=403, detail="Role does not have permission.")
    return token_record


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/staff/auth")
def staff_auth(payload: StaffAuthRequest) -> dict[str, str]:
    expected_pin = DEV_STAFF_PINS.get(payload.venue_slug.strip())
    if expected_pin is None or payload.pin.strip() != expected_pin:
        raise HTTPException(status_code=401, detail="Invalid staff PIN.")

    token = secrets.token_urlsafe(24)
    STAFF_TOKENS[token] = {
        "venue_slug": payload.venue_slug.strip(),
        "role": payload.role,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"token": token, "role": payload.role, "venue_slug": payload.venue_slug.strip()}


@app.post("/api/register")
def register_user(payload: RegisterRequest) -> dict[str, int | str]:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO mailing_list (name, email, venue_slug, created_at) VALUES (?, ?, ?, ?)",
        (payload.name.strip(), payload.email.strip().lower(), payload.venue_slug.strip(), now),
    )
    conn.commit()
    register_id = cur.lastrowid
    conn.close()
    return {"id": register_id, "status": "registered"}


@app.get("/api/customers/profile")
def get_customer_profile(
    venue_slug: str,
    x_customer_token: str | None = Header(default=None),
) -> dict[str, object]:
    if not x_customer_token:
        raise HTTPException(status_code=401, detail="Missing customer token.")

    conn = get_conn()
    cur = conn.cursor()
    row = read_customer_by_token(cur, venue_slug.strip(), x_customer_token.strip())
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Customer profile not found.")
    return serialize_customer_profile(row)


@app.post("/api/customers/profile")
def save_customer_profile(payload: CustomerProfileRequest) -> dict[str, object]:
    conn = get_conn()
    cur = conn.cursor()
    row = upsert_customer_profile(
        cur,
        venue_slug=payload.venue_slug,
        name=payload.name,
        email=payload.email,
        delivery_mode=payload.delivery_mode,
        delivery_target=payload.delivery_target,
    )
    conn.commit()
    conn.close()
    return serialize_customer_profile(row)


@app.post("/api/orders")
def create_order(payload: CreateOrderRequest) -> dict[str, object]:
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item.")

    now = datetime.now(timezone.utc).isoformat()
    eta_text = "12-18 min" if payload.delivery_mode.lower().startswith("seat") else "8-12 min"
    conn = get_conn()
    cur = conn.cursor()
    customer_id: int | None = None
    customer_profile: dict[str, str | int | None] | None = None
    if payload.checkout_type == "remembered":
        customer_row = upsert_customer_profile(
            cur,
            venue_slug=payload.venue_slug,
            name=payload.customer_name,
            email=payload.customer_email,
            delivery_mode=payload.delivery_mode,
            delivery_target=payload.delivery_target,
            customer_token=payload.customer_token,
        )
        customer_id = int(customer_row["id"])
        customer_profile = serialize_customer_profile(customer_row)
        active_order_row = read_active_customer_order_row(
            cur,
            venue_slug=payload.venue_slug.strip(),
            customer_id=customer_id,
        )
        if active_order_row is not None:
            conn.commit()
            conn.close()
            return {
                "order_id": active_order_row["id"],
                "status": active_order_row["status"],
                "eta_text": active_order_row["eta_text"],
                "checkout_type": active_order_row["checkout_type"],
                "version": active_order_row["version"],
                "existing_active_order": True,
                "customer_profile": customer_profile,
            }

    cur.execute(
        """
        INSERT INTO orders (
          venue_slug, customer_id, customer_name, customer_email, delivery_mode, delivery_target,
          items_json, checkout_type, status, eta_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.venue_slug.strip(),
            customer_id,
            payload.customer_name.strip(),
            payload.customer_email.strip().lower(),
            payload.delivery_mode.strip(),
            payload.delivery_target.strip(),
            json.dumps([item.model_dump() for item in payload.items]),
            payload.checkout_type,
            "received",
            eta_text,
            now,
            now,
        ),
    )
    conn.commit()
    order_id = cur.lastrowid
    conn.close()
    response: dict[str, object] = {
        "order_id": order_id,
        "status": "received",
        "eta_text": eta_text,
        "checkout_type": payload.checkout_type,
        "version": 1,
    }
    if customer_profile is not None:
        response["customer_profile"] = customer_profile
    return response


@app.get("/api/customers/active-order")
def get_customer_active_order(
    venue_slug: str,
    x_customer_token: str | None = Header(default=None),
) -> dict[str, object]:
    if not x_customer_token:
        raise HTTPException(status_code=401, detail="Missing customer token.")

    conn = get_conn()
    cur = conn.cursor()
    customer_row = read_customer_by_token(cur, venue_slug.strip(), x_customer_token.strip())
    if customer_row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Customer profile not found.")
    active_order_row = read_active_customer_order_row(
        cur,
        venue_slug=venue_slug.strip(),
        customer_id=int(customer_row["id"]),
    )
    conn.close()
    return {"active_order": serialize_order_row(active_order_row) if active_order_row is not None else None}


@app.get("/api/runners/active-order")
def get_runner_active_order(
    venue_slug: str,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    runner_token, _ = get_staff_token(
        authorization,
        venue_slug=venue_slug.strip(),
        allowed_roles={"runner", "admin"},
    )
    conn = get_conn()
    cur = conn.cursor()
    active_order_row = read_active_runner_order_row(
        cur,
        venue_slug=venue_slug.strip(),
        runner_token=runner_token,
    )
    conn.close()
    return {"active_order": serialize_order_row(active_order_row) if active_order_row is not None else None}


@app.get("/api/orders")
def list_orders(
    venue_slug: str | None = None,
    status: OrderStatus | None = Query(default=None),
    limit: int = 100,
    authorization: str | None = Header(default=None),
) -> dict[str, list[dict]]:
    require_staff_token(authorization, venue_slug=venue_slug, allowed_roles={"runner", "venue", "admin"})
    conn = get_conn()
    cur = conn.cursor()
    safe_limit = max(1, min(limit, 200))
    if venue_slug and status:
        cur.execute(
            """
            SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
                   customer_name, delivery_mode, delivery_target,
                   version, checkout_type, status, eta_text, created_at, updated_at
            FROM orders
            WHERE venue_slug = ? AND status = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (venue_slug, status, safe_limit),
        )
    elif venue_slug:
        cur.execute(
            """
            SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
                   customer_name, delivery_mode, delivery_target,
                   version, checkout_type, status, eta_text, created_at, updated_at
            FROM orders
            WHERE venue_slug = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (venue_slug, safe_limit),
        )
    elif status:
        cur.execute(
            """
            SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
                   customer_name, delivery_mode, delivery_target,
                   version, checkout_type, status, eta_text, created_at, updated_at
            FROM orders
            WHERE status = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (status, safe_limit),
        )
    else:
        cur.execute(
            """
            SELECT id, venue_slug, customer_id, assigned_runner_token, assigned_runner_role,
                   customer_name, delivery_mode, delivery_target,
                   version, checkout_type, status, eta_text, created_at, updated_at
            FROM orders
            ORDER BY id DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
    rows = cur.fetchall()
    conn.close()
    return {
        "orders": [
            {
                "order_id": row["id"],
                "venue_slug": row["venue_slug"],
                "customer_id": row["customer_id"],
                "assigned_runner_token": row["assigned_runner_token"],
                "assigned_runner_role": row["assigned_runner_role"],
                "customer_name": row["customer_name"],
                "delivery_mode": row["delivery_mode"],
                "delivery_target": row["delivery_target"],
                "version": row["version"],
                "checkout_type": row["checkout_type"],
                "status": row["status"],
                "eta_text": row["eta_text"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
    }


@app.get("/api/order-status/{order_id}")
def order_status(order_id: int) -> dict:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    conn.close()
    return {
        "order_id": row["id"],
        "venue_slug": row["venue_slug"],
        "customer_id": row["customer_id"],
        "assigned_runner_token": row["assigned_runner_token"],
        "assigned_runner_role": row["assigned_runner_role"],
        "customer_name": row["customer_name"],
        "customer_email": row["customer_email"],
        "delivery_mode": row["delivery_mode"],
        "delivery_target": row["delivery_target"],
        "items": json.loads(row["items_json"]),
        "version": row["version"],
        "checkout_type": row["checkout_type"],
        "status": row["status"],
        "eta_text": row["eta_text"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@app.post("/api/orders/{order_id}/accept")
def accept_order(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"venue", "admin"})
    result = transition_order_status(cur, order_id, "accepted", actor_role="venue")
    conn.commit()
    conn.close()
    return result


@app.post("/api/orders/{order_id}/reject")
def reject_order(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"venue", "admin"})
    result = transition_order_status(cur, order_id, "rejected", actor_role="venue")
    conn.commit()
    conn.close()
    return result


@app.post("/api/orders/{order_id}/ready")
def ready_order(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"venue", "admin"})
    result = transition_order_status(cur, order_id, "ready", actor_role="venue")
    conn.commit()
    conn.close()
    return result


@app.post("/api/order-status/{order_id}")
def update_order_status(
    order_id: int,
    payload: UpdateOrderStatusRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    actor_token, token_record = get_staff_token(
        authorization,
        venue_slug=str(row["venue_slug"]),
        allowed_roles={"runner", "venue", "admin"},
    )
    result = transition_order_status(
        cur,
        order_id,
        payload.status,
        actor_role=str(token_record["role"]),
        actor_token=actor_token,
    )
    conn.commit()
    conn.close()
    return result
