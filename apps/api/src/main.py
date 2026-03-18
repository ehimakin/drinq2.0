import json
import hashlib
import sqlite3
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
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
VENUE_TIMEZONE = ZoneInfo("Europe/London")
MAX_DAILY_DISPLAY_ORDER_NUMBER = 999
PaymentStatus = Literal["pending", "captured", "failed", "refunded"]
OrderStatus = Literal[
    "received",
    "accepted",
    "ready",
    "ready_for_collection",
    "assigned",
    "loaded",
    "en_route",
    "arrived",
    "collected",
    "uncollected",
    "fulfilled",
    "rejected",
    "cancelled",
    "failed",
]
TERMINAL_STATUSES = {"fulfilled", "collected", "uncollected", "rejected", "cancelled", "failed"}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "received": {"accepted", "rejected", "cancelled"},
    "accepted": {"ready", "ready_for_collection", "assigned", "cancelled", "failed"},
    "ready": {"assigned", "loaded", "cancelled", "failed"},
    "ready_for_collection": {"collected", "uncollected", "cancelled", "failed"},
    "assigned": {"loaded", "en_route", "cancelled", "failed"},
    "loaded": {"en_route", "arrived", "cancelled", "failed"},
    "en_route": {"arrived", "failed", "cancelled"},
    "arrived": {"fulfilled", "failed", "cancelled"},
    "collected": set(),
    "uncollected": set(),
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
DEV_VENDOR_PINS: dict[str, dict[str, str]] = {
    "brentford-fc": {
        "50pints": "8888",
        "vibe-coding-sux": "9999",
    }
}
STAFF_TOKENS: dict[str, dict[str, object]] = {}
ACTIVE_CUSTOMER_ORDER_STATUSES = (
    "received",
    "accepted",
    "ready",
    "ready_for_collection",
    "assigned",
    "loaded",
    "en_route",
    "arrived",
)
ACTIVE_RUNNER_ORDER_STATUSES = ("assigned", "loaded", "en_route", "arrived")
RUNNER_HEARTBEAT_TIMEOUT_SECONDS = 90
RUNNER_STALLED_SECONDS_BY_STATUS: dict[str, int] = {
    "assigned": 180,
    "loaded": 300,
    "en_route": 900,
    "arrived": 300,
}
RUNNER_RECOVERY_INCIDENT_CODES = {
    "runner_assignment_released",
    "runner_unreachable",
    "runner_progress_stalled",
}
DEFAULT_MENU_ITEMS: dict[str, list[dict[str, object]]] = {
    "brentford-fc": [
        {
            "item_id": "bf-lager",
            "item_name": "House Lager Pint",
            "category": "Beer",
            "price_text": "PS6.80",
            "available_modes": ["Seat Delivery", "Nearest Point", "Click & Collect"],
            "sort_order": 10,
        },
        {
            "item_id": "bf-cider",
            "item_name": "Dry Cider Pint",
            "category": "Beer",
            "price_text": "PS6.60",
            "available_modes": ["Seat Delivery", "Nearest Point", "Click & Collect"],
            "sort_order": 20,
        },
        {
            "item_id": "bf-gintonic",
            "item_name": "Gin & Tonic",
            "category": "Spirits",
            "price_text": "PS8.20",
            "available_modes": ["Seat Delivery", "Nearest Point", "Click & Collect"],
            "sort_order": 30,
        },
        {
            "item_id": "bf-soft",
            "item_name": "Soft Drink 500ml",
            "category": "Soft Drinks",
            "price_text": "PS3.00",
            "available_modes": ["Seat Delivery", "Nearest Point", "Click & Collect"],
            "sort_order": 40,
        },
        {
            "item_id": "bf-water",
            "item_name": "Water 500ml",
            "category": "Soft Drinks",
            "price_text": "PS2.20",
            "available_modes": ["Seat Delivery", "Nearest Point", "Click & Collect"],
            "sort_order": 50,
        },
    ]
}
DEFAULT_VENUE_RECORDS: dict[str, dict[str, str]] = {
    "brentford-fc": {
        "name": "Brentford FC - Gtech Community Stadium",
        "runner_access_code": "8888",
    }
}
DEFAULT_VENDOR_RECORDS: dict[str, list[dict[str, str]]] = {
    "brentford-fc": [
        {
            "slug": "50pints",
            "name": "50Pints",
        },
        {
            "slug": "vibe-coding-sux",
            "name": "Vibe coding sux",
        },
    ]
}


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


class CustomerUpgradeRequest(BaseModel):
    venue_slug: str
    email: str
    password: str


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
    tip_amount_pennies: int = 0


class AddTipRequest(BaseModel):
    tip_amount_pennies: int


class UpdateOrderStatusRequest(BaseModel):
    status: OrderStatus


class StaffAuthRequest(BaseModel):
    venue_slug: str
    pin: str
    role: Literal["runner", "vendor", "venue", "admin"]
    vendor_slug: str | None = None


class RunnerAccessRequest(BaseModel):
    access_code: str


class CollectVerificationRequest(BaseModel):
    pickup_code: str


class MenuItemPayload(BaseModel):
    venue_slug: str
    item_id: str
    item_name: str
    category: str
    price_text: str
    available_modes: list[str]
    is_active: bool = True


class OrderIssueRequest(BaseModel):
    reason: str | None = None


class OrderAttentionRequest(BaseModel):
    reason: str


class BugReportRequest(BaseModel):
    title: str | None = None
    message: str
    description: str | None = None
    source: str | None = None
    role: str | None = None
    venue_slug: str | None = None
    route_name: str | None = None
    page_url: str | None = None
    user_agent: str | None = None
    stack: str | None = None
    context_json: dict[str, object] | None = None


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


async def parse_request_model(request: Request, model: type[BaseModel]) -> BaseModel:
    raw_body = await request.body()
    try:
        return model.model_validate_json(raw_body)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


def init_db() -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS venues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          runner_access_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    cur.execute("PRAGMA table_info(venues)")
    venue_columns = {str(row[1]) for row in cur.fetchall()}
    if "runner_access_code" not in venue_columns:
        cur.execute("ALTER TABLE venues ADD COLUMN runner_access_code TEXT")
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_runner_access_code
        ON venues (runner_access_code)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS vendors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_id INTEGER NOT NULL,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (venue_id) REFERENCES venues(id)
        )
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_venue_slug
        ON vendors (venue_id, slug)
        """
    )
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
          preferred_delivery_mode TEXT,
          preferred_delivery_target TEXT,
          preferred_payment_method TEXT,
          profile_token TEXT NOT NULL UNIQUE,
          account_level TEXT NOT NULL DEFAULT 'profile',
          password_hash TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_order_at TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS menu_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_slug TEXT NOT NULL,
          vendor_id INTEGER,
          item_id TEXT NOT NULL,
          item_name TEXT NOT NULL,
          category TEXT NOT NULL,
          price_text TEXT NOT NULL,
          available_modes_json TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 100,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (vendor_id) REFERENCES vendors(id)
        )
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_venue_item
        ON menu_items (venue_slug, item_id)
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_venue_email
        ON customers (venue_slug, email)
        """
    )
    cur.execute("PRAGMA table_info(customers)")
    customer_columns = {str(row[1]) for row in cur.fetchall()}
    if "preferred_delivery_mode" not in customer_columns:
        cur.execute("ALTER TABLE customers ADD COLUMN preferred_delivery_mode TEXT")
    if "preferred_delivery_target" not in customer_columns:
        cur.execute("ALTER TABLE customers ADD COLUMN preferred_delivery_target TEXT")
    if "password_hash" not in customer_columns:
        cur.execute("ALTER TABLE customers ADD COLUMN password_hash TEXT")
    cur.execute("PRAGMA table_info(menu_items)")
    menu_item_columns = {str(row[1]) for row in cur.fetchall()}
    if "vendor_id" not in menu_item_columns:
        cur.execute("ALTER TABLE menu_items ADD COLUMN vendor_id INTEGER")
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_vendor_item
        ON menu_items (vendor_id, item_id)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_slug TEXT NOT NULL,
          business_day TEXT,
          display_order_number INTEGER,
          customer_id INTEGER,
          assigned_runner_token TEXT,
          assigned_runner_role TEXT,
          assignment_started_at TEXT,
          last_runner_heartbeat_at TEXT,
          status_updated_at TEXT,
          pickup_code TEXT,
          ready_for_collection_at TEXT,
          payment_status TEXT NOT NULL DEFAULT 'captured',
          payment_reference TEXT,
          failure_reason TEXT,
          failed_at TEXT,
          refund_reason TEXT,
          refunded_at TEXT,
          paid_at TEXT,
          tip_amount_pennies INTEGER NOT NULL DEFAULT 0,
          tipped_at TEXT,
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
    if "business_day" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN business_day TEXT")
    if "display_order_number" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN display_order_number INTEGER")
    if "customer_id" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN customer_id INTEGER")
    if "assigned_runner_token" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN assigned_runner_token TEXT")
    if "assigned_runner_role" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN assigned_runner_role TEXT")
    if "assignment_started_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN assignment_started_at TEXT")
    if "last_runner_heartbeat_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN last_runner_heartbeat_at TEXT")
    if "status_updated_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN status_updated_at TEXT")
    if "pickup_code" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN pickup_code TEXT")
    if "ready_for_collection_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN ready_for_collection_at TEXT")
    if "payment_status" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'captured'")
    if "payment_reference" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN payment_reference TEXT")
    if "failure_reason" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN failure_reason TEXT")
    if "failed_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN failed_at TEXT")
    if "refund_reason" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN refund_reason TEXT")
    if "refunded_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN refunded_at TEXT")
    if "paid_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN paid_at TEXT")
    if "tip_amount_pennies" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN tip_amount_pennies INTEGER NOT NULL DEFAULT 0")
    if "tipped_at" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN tipped_at TEXT")
    if "version" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    if "checkout_type" not in order_columns:
        cur.execute("ALTER TABLE orders ADD COLUMN checkout_type TEXT NOT NULL DEFAULT 'guest'")
    cur.execute(
        """
        UPDATE orders
        SET status_updated_at = COALESCE(status_updated_at, updated_at, created_at)
        WHERE status_updated_at IS NULL
        """
    )
    cur.execute(
        """
        UPDATE orders
        SET assignment_started_at = COALESCE(assignment_started_at, status_updated_at, updated_at, created_at)
        WHERE assignment_started_at IS NULL AND assigned_runner_token IS NOT NULL
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS order_incidents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL,
          venue_slug TEXT NOT NULL,
          code TEXT NOT NULL,
          severity TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          auto_detected INTEGER NOT NULL DEFAULT 1,
          opened_by_role TEXT,
          resolved_by_role TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          detected_at TEXT NOT NULL,
          last_observed_at TEXT NOT NULL,
          resolved_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (order_id) REFERENCES orders(id)
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_order_incidents_order_status
        ON order_incidents (order_id, status, code)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS bug_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          message TEXT NOT NULL,
          description TEXT,
          source TEXT,
          role TEXT,
          venue_slug TEXT,
          route_name TEXT,
          page_url TEXT,
          user_agent TEXT,
          stack TEXT,
          context_json TEXT,
          created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at
        ON bug_reports (created_at DESC)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_orders_venue_business_day_display
        ON orders (venue_slug, business_day, display_order_number)
        """
    )
    cur.execute(
        """
        SELECT id, venue_slug, created_at
        FROM orders
        WHERE business_day IS NULL OR display_order_number IS NULL
        ORDER BY venue_slug ASC, created_at ASC, id ASC
        """
    )
    legacy_rows = cur.fetchall()
    display_counters: dict[tuple[str, str], int] = {}
    for row in legacy_rows:
        venue_slug = str(row["venue_slug"] or "").strip()
        business_day = business_day_for_timestamp(str(row["created_at"] or ""))
        counter_key = (venue_slug, business_day)
        next_number = display_counters.get(counter_key, 0) + 1
        display_counters[counter_key] = min(next_number, MAX_DAILY_DISPLAY_ORDER_NUMBER)
        cur.execute(
            """
            UPDATE orders
            SET business_day = COALESCE(business_day, ?),
                display_order_number = COALESCE(display_order_number, ?)
            WHERE id = ?
            """,
            (business_day, display_counters[counter_key], int(row["id"])),
        )
    now = datetime.now(timezone.utc).isoformat()
    known_venue_slugs = set(DEFAULT_VENUE_RECORDS) | set(DEFAULT_MENU_ITEMS)
    cur.execute("SELECT DISTINCT venue_slug FROM menu_items")
    known_venue_slugs.update(str(row["venue_slug"] or "").strip() for row in cur.fetchall())
    cur.execute("SELECT DISTINCT venue_slug FROM orders")
    known_venue_slugs.update(str(row["venue_slug"] or "").strip() for row in cur.fetchall())
    cur.execute("SELECT DISTINCT venue_slug FROM customers")
    known_venue_slugs.update(str(row["venue_slug"] or "").strip() for row in cur.fetchall())
    known_venue_slugs = {slug for slug in known_venue_slugs if slug}
    for venue_slug in sorted(known_venue_slugs):
        venue_defaults = DEFAULT_VENUE_RECORDS.get(venue_slug, {})
        venue_name = venue_defaults.get("name", venue_slug.replace("-", " ").title())
        runner_access_code = venue_defaults.get("runner_access_code")
        cur.execute(
            """
            INSERT INTO venues (slug, name, runner_access_code, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
              name = excluded.name,
              runner_access_code = COALESCE(excluded.runner_access_code, venues.runner_access_code),
              updated_at = excluded.updated_at
            """,
            (venue_slug, venue_name, runner_access_code, now, now),
        )
    for venue_slug in sorted(known_venue_slugs):
        vendor_defaults = DEFAULT_VENDOR_RECORDS.get(
            venue_slug,
            [
                {
                    "slug": f"{venue_slug}-vendor",
                    "name": f"{venue_slug.replace('-', ' ').title()} Vendor",
                }
            ],
        )
        cur.execute("SELECT id FROM venues WHERE slug = ?", (venue_slug,))
        venue_row = cur.fetchone()
        if venue_row is None:
            continue
        venue_id = int(venue_row["id"])
        for vendor_default in vendor_defaults:
            cur.execute(
                """
                INSERT INTO vendors (venue_id, slug, name, is_default, is_active, created_at, updated_at)
                VALUES (?, ?, ?, 0, 1, ?, ?)
                ON CONFLICT(venue_id, slug) DO UPDATE SET
                  name = excluded.name,
                  is_active = 1,
                  updated_at = excluded.updated_at
                """,
                (venue_id, vendor_default["slug"], vendor_default["name"], now, now),
            )
        if venue_slug in DEFAULT_VENDOR_RECORDS:
            seeded_slugs = [vendor_default["slug"] for vendor_default in vendor_defaults]
            placeholders = ", ".join("?" for _ in seeded_slugs)
            cur.execute(
                f"""
                UPDATE vendors
                SET is_active = CASE WHEN slug IN ({placeholders}) THEN 1 ELSE 0 END,
                    is_default = 0,
                    updated_at = ?
                WHERE venue_id = ?
                """,
                (*seeded_slugs, now, venue_id),
            )
        else:
            cur.execute(
                "UPDATE vendors SET is_default = 0, updated_at = ? WHERE venue_id = ?",
                (now, venue_id),
            )
    cur.execute(
        """
        SELECT mi.id, mi.venue_slug
        FROM menu_items mi
        WHERE mi.vendor_id IS NULL
        """
    )
    for row in cur.fetchall():
        cur.execute(
            """
            SELECT v.id
            FROM vendors v
            JOIN venues ve ON ve.id = v.venue_id
            WHERE ve.slug = ?
            ORDER BY v.slug ASC, v.id ASC
            LIMIT 1
            """,
            (str(row["venue_slug"]),),
        )
        vendor_row = cur.fetchone()
        if vendor_row is not None:
            cur.execute("UPDATE menu_items SET vendor_id = ? WHERE id = ?", (int(vendor_row["id"]), int(row["id"])))
    for venue_slug, items in DEFAULT_MENU_ITEMS.items():
        cur.execute("SELECT COUNT(*) FROM menu_items WHERE venue_slug = ?", (venue_slug,))
        existing_count = int(cur.fetchone()[0] or 0)
        if existing_count > 0:
            continue
        seeded_vendor_slugs = [vendor_default["slug"] for vendor_default in DEFAULT_VENDOR_RECORDS.get(venue_slug, [])]
        if seeded_vendor_slugs:
            placeholders = ", ".join("?" for _ in seeded_vendor_slugs)
            cur.execute(
                f"""
                SELECT v.id
                FROM vendors v
                JOIN venues ve ON ve.id = v.venue_id
                WHERE ve.slug = ? AND v.slug IN ({placeholders}) AND v.is_active = 1
                ORDER BY v.slug ASC, v.id ASC
                """,
                (venue_slug, *seeded_vendor_slugs),
            )
        else:
            cur.execute(
                """
                SELECT v.id
                FROM vendors v
                JOIN venues ve ON ve.id = v.venue_id
                WHERE ve.slug = ? AND v.is_active = 1
                ORDER BY v.slug ASC, v.id ASC
                """,
                (venue_slug,),
            )
        venue_vendor_ids = [int(vendor_row["id"]) for vendor_row in cur.fetchall()]
        for item in items:
            cur.execute(
                """
                INSERT INTO menu_items (
                  venue_slug, vendor_id, item_id, item_name, category, price_text,
                  available_modes_json, is_active, sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    venue_slug,
                    venue_vendor_ids[(int(item["sort_order"]) // 10 - 1) % len(venue_vendor_ids)] if venue_vendor_ids else None,
                    str(item["item_id"]),
                    str(item["item_name"]),
                    str(item["category"]),
                    str(item["price_text"]),
                    json.dumps(item["available_modes"]),
                    int(item["sort_order"]),
                    now,
                    now,
                ),
            )
    for venue_slug, vendor_defaults in DEFAULT_VENDOR_RECORDS.items():
        if len(vendor_defaults) < 2:
            continue
        cur.execute(
            """
            SELECT mi.id
            FROM menu_items mi
            WHERE mi.venue_slug = ?
            ORDER BY mi.sort_order ASC, mi.item_name ASC, mi.id ASC
            """,
            (venue_slug,),
        )
        item_rows = cur.fetchall()
        seeded_vendor_slugs = [vendor_default["slug"] for vendor_default in vendor_defaults]
        placeholders = ", ".join("?" for _ in seeded_vendor_slugs)
        cur.execute(
            f"""
            SELECT v.id
            FROM vendors v
            JOIN venues ve ON ve.id = v.venue_id
            WHERE ve.slug = ? AND v.slug IN ({placeholders}) AND v.is_active = 1
            ORDER BY v.slug ASC, v.id ASC
            """,
            (venue_slug, *seeded_vendor_slugs),
        )
        vendor_rows = cur.fetchall()
        vendor_ids = [int(vendor_row["id"]) for vendor_row in vendor_rows]
        if len(vendor_ids) < 2:
            continue
        cur.execute(
            f"""
            SELECT COUNT(DISTINCT vendor_id) AS seeded_vendor_count
            FROM menu_items
            WHERE venue_slug = ? AND vendor_id IN ({placeholders})
            """,
            (venue_slug, *vendor_ids),
        )
        seeded_vendor_count = int(cur.fetchone()["seeded_vendor_count"] or 0)
        other_placeholders = ", ".join("?" for _ in vendor_ids)
        cur.execute(
            f"""
            SELECT COUNT(*) AS other_vendor_items
            FROM menu_items
            WHERE venue_slug = ? AND (vendor_id IS NULL OR vendor_id NOT IN ({other_placeholders}))
            """,
            (venue_slug, *vendor_ids),
        )
        other_vendor_items = int(cur.fetchone()["other_vendor_items"] or 0)
        if seeded_vendor_count == len(vendor_ids) and other_vendor_items == 0:
            continue
        for index, item_row in enumerate(item_rows):
            cur.execute(
                "UPDATE menu_items SET vendor_id = ? WHERE id = ?",
                (vendor_ids[index % len(vendor_ids)], int(item_row["id"])),
            )
    conn.commit()
    conn.close()


def read_venue_row(cur: sqlite3.Cursor, venue_slug: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, slug, name, runner_access_code, created_at, updated_at
        FROM venues
        WHERE slug = ?
        """,
        (venue_slug.strip(),),
    )
    return cur.fetchone()


def read_venue_by_runner_access_code(cur: sqlite3.Cursor, access_code: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, slug, name, runner_access_code, created_at, updated_at
        FROM venues
        WHERE runner_access_code = ?
        LIMIT 1
        """,
        (access_code.strip(),),
    )
    return cur.fetchone()


def read_first_vendor_row(cur: sqlite3.Cursor, venue_slug: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT v.id, v.slug, v.name, v.venue_id, v.is_default, v.is_active
        FROM vendors v
        JOIN venues ve ON ve.id = v.venue_id
        WHERE ve.slug = ? AND v.is_active = 1
        ORDER BY v.slug ASC, v.id ASC
        LIMIT 1
        """,
        (venue_slug.strip(),),
    )
    return cur.fetchone()


def read_vendor_by_slug(cur: sqlite3.Cursor, venue_slug: str, vendor_slug: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT v.id, v.slug, v.name, v.venue_id, v.is_default, v.is_active
        FROM vendors v
        JOIN venues ve ON ve.id = v.venue_id
        WHERE ve.slug = ? AND v.slug = ?
        LIMIT 1
        """,
        (venue_slug.strip(), vendor_slug.strip()),
    )
    return cur.fetchone()


def business_day_for_timestamp(raw_timestamp: str) -> str:
    if raw_timestamp:
        try:
            parsed = datetime.fromisoformat(raw_timestamp)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(VENUE_TIMEZONE).date().isoformat()
        except ValueError:
            pass
    return datetime.now(VENUE_TIMEZONE).date().isoformat()


def parse_iso_timestamp(raw_timestamp: str | None) -> datetime | None:
    if not raw_timestamp:
        return None
    try:
        parsed = datetime.fromisoformat(raw_timestamp)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def touch_order_record(cur: sqlite3.Cursor, order_id: int, *, now_iso: str) -> None:
    cur.execute(
        """
        UPDATE orders
        SET updated_at = ?, version = COALESCE(version, 1) + 1
        WHERE id = ?
        """,
        (now_iso, order_id),
    )


def read_open_order_incidents(cur: sqlite3.Cursor, order_id: int) -> list[sqlite3.Row]:
    cur.execute(
        """
        SELECT id, order_id, venue_slug, code, severity, summary, detail,
               auto_detected, opened_by_role, resolved_by_role, status,
               detected_at, last_observed_at, resolved_at, created_at, updated_at
        FROM order_incidents
        WHERE order_id = ? AND status = 'open'
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
          END,
          id DESC
        """,
        (order_id,),
    )
    return cur.fetchall()


def serialize_incident_row(row: sqlite3.Row) -> dict[str, object]:
    return {
        "incident_id": int(row["id"]),
        "code": row["code"],
        "severity": row["severity"],
        "summary": row["summary"],
        "detail": row["detail"],
        "auto_detected": bool(row["auto_detected"]),
        "opened_by_role": row["opened_by_role"],
        "resolved_by_role": row["resolved_by_role"],
        "status": row["status"],
        "detected_at": row["detected_at"],
        "last_observed_at": row["last_observed_at"],
        "resolved_at": row["resolved_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def open_order_incident(
    cur: sqlite3.Cursor,
    order_row: sqlite3.Row,
    *,
    code: str,
    severity: str,
    summary: str,
    detail: str | None = None,
    auto_detected: bool = True,
    opened_by_role: str | None = None,
    observed_at: str | None = None,
) -> bool:
    observed = observed_at or datetime.now(timezone.utc).isoformat()
    order_id = int(order_row["id"])
    cur.execute(
        """
        SELECT id, detail
        FROM order_incidents
        WHERE order_id = ? AND code = ? AND status = 'open'
        ORDER BY id DESC
        LIMIT 1
        """,
        (order_id, code),
    )
    existing = cur.fetchone()
    if existing is not None:
        next_detail = detail if detail is not None else existing["detail"]
        cur.execute(
            """
            UPDATE order_incidents
            SET detail = ?, last_observed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_detail, observed, observed, int(existing["id"])),
        )
        return False

    cur.execute(
        """
        INSERT INTO order_incidents (
          order_id, venue_slug, code, severity, summary, detail,
          auto_detected, opened_by_role, resolved_by_role, status,
          detected_at, last_observed_at, resolved_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'open', ?, ?, NULL, ?, ?)
        """,
        (
            order_id,
            str(order_row["venue_slug"]),
            code,
            severity,
            summary,
            detail,
            1 if auto_detected else 0,
            opened_by_role,
            observed,
            observed,
            observed,
            observed,
        ),
    )
    return True


def resolve_order_incidents(
    cur: sqlite3.Cursor,
    order_id: int,
    *,
    actor_role: str,
    codes: set[str] | None = None,
    auto_detected: bool | None = None,
) -> int:
    clauses = ["order_id = ?", "status = 'open'"]
    params: list[object] = [order_id]
    if codes:
        placeholders = ", ".join("?" for _ in codes)
        clauses.append(f"code IN ({placeholders})")
        params.extend(sorted(codes))
    if auto_detected is not None:
        clauses.append("auto_detected = ?")
        params.append(1 if auto_detected else 0)
    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute(
        f"""
        UPDATE order_incidents
        SET status = 'resolved', resolved_by_role = ?, resolved_at = ?, updated_at = ?
        WHERE {' AND '.join(clauses)}
        """,
        (actor_role, now_iso, now_iso, *params),
    )
    return int(cur.rowcount or 0)


def release_runner_assignment(cur: sqlite3.Cursor, order_id: int, *, now_iso: str) -> None:
    cur.execute(
        """
        UPDATE orders
        SET assigned_runner_token = NULL,
            assigned_runner_role = NULL,
            assignment_started_at = NULL,
            last_runner_heartbeat_at = NULL,
            updated_at = ?,
            version = COALESCE(version, 1) + 1
        WHERE id = ?
        """,
        (now_iso, order_id),
    )


def record_runner_heartbeat(cur: sqlite3.Cursor, order_row: sqlite3.Row, *, runner_token: str) -> sqlite3.Row:
    if str(order_row["status"] or "") not in ACTIVE_RUNNER_ORDER_STATUSES:
        return order_row
    if str(order_row["assigned_runner_token"] or "") != runner_token:
        return order_row
    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE orders
        SET last_runner_heartbeat_at = ?
        WHERE id = ?
        """,
        (now_iso, int(order_row["id"])),
    )
    resolved = resolve_order_incidents(
        cur,
        int(order_row["id"]),
        actor_role="system",
        codes={"runner_unreachable"},
        auto_detected=True,
    )
    if resolved:
        touch_order_record(cur, int(order_row["id"]), now_iso=now_iso)
    return read_order_row(cur, int(order_row["id"]))


def reconcile_order_operational_health(cur: sqlite3.Cursor, order_row: sqlite3.Row) -> sqlite3.Row:
    status = str(order_row["status"] or "")
    if status in TERMINAL_STATUSES:
        return order_row

    order_id = int(order_row["id"])
    assigned_runner_token = str(order_row["assigned_runner_token"] or "")
    if status not in ACTIVE_RUNNER_ORDER_STATUSES or not assigned_runner_token:
        return order_row

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    changed = False
    last_runner_signal = (
        parse_iso_timestamp(str(order_row["last_runner_heartbeat_at"] or ""))
        or parse_iso_timestamp(str(order_row["assignment_started_at"] or ""))
        or parse_iso_timestamp(str(order_row["status_updated_at"] or ""))
        or parse_iso_timestamp(str(order_row["updated_at"] or ""))
        or parse_iso_timestamp(str(order_row["created_at"] or ""))
    )

    if last_runner_signal is not None:
        heartbeat_age = (now - last_runner_signal).total_seconds()
        if heartbeat_age > RUNNER_HEARTBEAT_TIMEOUT_SECONDS:
            if status == "assigned":
                incident_created = open_order_incident(
                    cur,
                    order_row,
                    code="runner_assignment_released",
                    severity="high",
                    summary="Runner assignment released after the device went silent.",
                    detail="The runner stopped checking in while this order was assigned, so the assignment was cleared for reassignment.",
                    observed_at=now_iso,
                )
                release_runner_assignment(cur, order_id, now_iso=now_iso)
                changed = True
            else:
                incident_created = open_order_incident(
                    cur,
                    order_row,
                    code="runner_unreachable",
                    severity="high",
                    summary="Runner connection lost during delivery.",
                    detail=f"The assigned runner stopped checking in while the order was {status.replace('_', ' ')}.",
                    observed_at=now_iso,
                )
                if incident_created:
                    touch_order_record(cur, order_id, now_iso=now_iso)
                    changed = True

    if status in RUNNER_STALLED_SECONDS_BY_STATUS:
        progress_anchor = (
            parse_iso_timestamp(str(order_row["status_updated_at"] or ""))
            or parse_iso_timestamp(str(order_row["updated_at"] or ""))
            or parse_iso_timestamp(str(order_row["created_at"] or ""))
        )
        if progress_anchor is not None:
            stalled_for = (now - progress_anchor).total_seconds()
            if stalled_for > RUNNER_STALLED_SECONDS_BY_STATUS[status]:
                incident_created = open_order_incident(
                    cur,
                    order_row,
                    code="runner_progress_stalled",
                    severity="warning",
                    summary=f"Order has remained {status.replace('_', ' ')} longer than expected.",
                    detail="The order has not progressed within the expected time window and should be reviewed.",
                    observed_at=now_iso,
                )
                if incident_created:
                    touch_order_record(cur, order_id, now_iso=now_iso)
                    changed = True

    if changed:
        return read_order_row(cur, order_id)
    return order_row


def load_order_with_health(cur: sqlite3.Cursor, order_id: int) -> sqlite3.Row:
    row = read_order_row(cur, order_id)
    return reconcile_order_operational_health(cur, row)


def serialize_order_row_with_health(cur: sqlite3.Cursor, row: sqlite3.Row) -> dict[str, object]:
    incidents = read_open_order_incidents(cur, int(row["id"]))
    payload = serialize_order_row(row)
    payload["attention_required"] = len(incidents) > 0
    payload["open_incidents"] = [serialize_incident_row(incident) for incident in incidents]
    return payload


def allocate_display_order_number(cur: sqlite3.Cursor, *, venue_slug: str, business_day: str) -> int:
    cur.execute(
        """
        SELECT COALESCE(MAX(display_order_number), 0)
        FROM orders
        WHERE venue_slug = ? AND business_day = ?
        """,
        (venue_slug, business_day),
    )
    next_number = int(cur.fetchone()[0] or 0) + 1
    if next_number > MAX_DAILY_DISPLAY_ORDER_NUMBER:
        raise HTTPException(
            status_code=409,
            detail=f"Daily display order number limit reached for {business_day}.",
        )
    return next_number


def read_order_row(cur: sqlite3.Cursor, order_id: int) -> sqlite3.Row:
    cur.execute(
        """
        SELECT id, venue_slug, business_day, display_order_number,
               customer_id, assigned_runner_token, assigned_runner_role,
               assignment_started_at, last_runner_heartbeat_at, status_updated_at,
               pickup_code, ready_for_collection_at, payment_status, payment_reference,
               failure_reason, failed_at, refund_reason, refunded_at, paid_at,
               tip_amount_pennies, tipped_at,
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
    status_placeholders = ", ".join("?" for _ in ACTIVE_CUSTOMER_ORDER_STATUSES)
    cur.execute(
        f"""
        SELECT id, venue_slug, business_day, display_order_number,
               customer_id, assigned_runner_token, assigned_runner_role,
               pickup_code, ready_for_collection_at, payment_status, payment_reference,
               failure_reason, failed_at, refund_reason, refunded_at, paid_at,
               tip_amount_pennies, tipped_at,
               customer_name, customer_email, delivery_mode, delivery_target,
               items_json, version, checkout_type, status, eta_text, created_at, updated_at
        FROM orders
        WHERE venue_slug = ? AND customer_id = ? AND status IN ({status_placeholders})
        ORDER BY id DESC
        LIMIT 1
        """,
        (venue_slug, customer_id, *ACTIVE_CUSTOMER_ORDER_STATUSES),
    )
    return cur.fetchone()


def read_active_runner_order_row(cur: sqlite3.Cursor, *, venue_slug: str, runner_token: str) -> sqlite3.Row | None:
    status_placeholders = ", ".join("?" for _ in ACTIVE_RUNNER_ORDER_STATUSES)
    cur.execute(
        f"""
        SELECT id, venue_slug, business_day, display_order_number,
               customer_id, assigned_runner_token, assigned_runner_role,
               pickup_code, ready_for_collection_at, payment_status, payment_reference,
               failure_reason, failed_at, refund_reason, refunded_at, paid_at,
               tip_amount_pennies, tipped_at,
               customer_name, customer_email, delivery_mode, delivery_target,
               items_json, version, checkout_type, status, eta_text, created_at, updated_at
        FROM orders
        WHERE venue_slug = ? AND assigned_runner_token = ? AND status IN ({status_placeholders})
        ORDER BY id DESC
        LIMIT 1
        """,
        (venue_slug, runner_token, *ACTIVE_RUNNER_ORDER_STATUSES),
    )
    return cur.fetchone()


def serialize_order_row(row: sqlite3.Row) -> dict[str, object]:
    return {
        "order_id": row["id"],
        "business_day": row["business_day"],
        "display_order_number": int(row["display_order_number"] or row["id"]),
        "venue_slug": row["venue_slug"],
        "customer_id": row["customer_id"],
        "assigned_runner_token": row["assigned_runner_token"],
        "assigned_runner_role": row["assigned_runner_role"],
        "assignment_started_at": row["assignment_started_at"],
        "last_runner_heartbeat_at": row["last_runner_heartbeat_at"],
        "status_updated_at": row["status_updated_at"],
        "pickup_code": row["pickup_code"],
        "ready_for_collection_at": row["ready_for_collection_at"],
        "payment_status": row["payment_status"],
        "payment_reference": row["payment_reference"],
        "failure_reason": row["failure_reason"],
        "failed_at": row["failed_at"],
        "refund_reason": row["refund_reason"],
        "refunded_at": row["refunded_at"],
        "paid_at": row["paid_at"],
        "tip_amount_pennies": int(row["tip_amount_pennies"] or 0),
        "tipped_at": row["tipped_at"],
        "has_tip": int(row["tip_amount_pennies"] or 0) > 0,
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


def serialize_menu_item_row(row: sqlite3.Row) -> dict[str, object]:
    row_keys = set(row.keys())
    return {
        "venue_slug": row["venue_slug"],
        "vendor_id": int(row["vendor_id"]) if "vendor_id" in row_keys and row["vendor_id"] is not None else None,
        "vendor_slug": row["vendor_slug"] if "vendor_slug" in row_keys else None,
        "vendor_name": row["vendor_name"] if "vendor_name" in row_keys else None,
        "item_id": row["item_id"],
        "item_name": row["item_name"],
        "category": row["category"],
        "price_text": row["price_text"],
        "available_modes": json.loads(row["available_modes_json"]),
        "is_active": bool(row["is_active"]),
        "sort_order": int(row["sort_order"] or 0),
        "updated_at": row["updated_at"],
    }


def is_click_and_collect_mode(delivery_mode: str) -> bool:
    return delivery_mode.strip().lower() == "click & collect"


def normalize_tip_amount_pennies(amount: int) -> int:
    normalized = int(amount or 0)
    if normalized < 0:
        raise HTTPException(status_code=400, detail="Tip amount cannot be negative.")
    if normalized > 5000:
        raise HTTPException(status_code=400, detail="Tip amount is too large for this prototype.")
    return normalized


def add_tip_to_order(cur: sqlite3.Cursor, order_id: int, tip_amount_pennies: int) -> dict[str, object]:
    row = read_order_row(cur, order_id)
    if int(row["tip_amount_pennies"] or 0) > 0:
        raise HTTPException(status_code=409, detail="Tip already recorded for this order.")
    normalized_tip = normalize_tip_amount_pennies(tip_amount_pennies)
    if normalized_tip == 0:
        raise HTTPException(status_code=400, detail="Tip amount must be greater than zero.")
    tipped_at = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE orders
        SET tip_amount_pennies = ?, tipped_at = ?, updated_at = ?, version = COALESCE(version, 1) + 1
        WHERE id = ?
        """,
        (normalized_tip, tipped_at, tipped_at, order_id),
    )
    updated = read_order_row(cur, order_id)
    return serialize_order_row(updated)


def make_pickup_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(4))


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
    same_status_runner_claim = (
        actor_role == "runner"
        and current_status == "assigned"
        and target_status == "assigned"
        and not str(row["assigned_runner_token"] or "")
    )
    if current_status == target_status and not same_status_runner_claim:
        return {"order_id": order_id, "status": current_status, "version": int(row["version"])}

    if current_status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Cannot transition terminal status '{current_status}'.")

    allowed = ALLOWED_TRANSITIONS.get(current_status, set())
    if target_status not in allowed and not same_status_runner_claim:
        raise HTTPException(
            status_code=409,
            detail=f"Invalid transition '{current_status}' -> '{target_status}'.",
        )

    assigned_runner_token = row["assigned_runner_token"]
    assigned_runner_role = row["assigned_runner_role"]
    assignment_started_at = row["assignment_started_at"]
    last_runner_heartbeat_at = row["last_runner_heartbeat_at"]
    pickup_code = row["pickup_code"]
    ready_for_collection_at = row["ready_for_collection_at"]
    collect_order = is_click_and_collect_mode(str(row["delivery_mode"]))

    if collect_order and target_status in {"assigned", "loaded", "en_route", "arrived", "fulfilled"}:
        raise HTTPException(status_code=409, detail="Click and collect orders do not enter runner delivery flow.")

    if not collect_order and target_status in {"ready_for_collection", "collected", "uncollected"}:
        raise HTTPException(status_code=409, detail="Delivery orders do not enter collection flow.")

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
            assignment_started_at = datetime.now(timezone.utc).isoformat()
            last_runner_heartbeat_at = assignment_started_at
        elif target_status in ACTIVE_RUNNER_ORDER_STATUSES:
            if not assigned_runner_token and current_status == "assigned":
                assigned_runner_token = actor_token
                assigned_runner_role = actor_role
                assignment_started_at = row["assignment_started_at"] or datetime.now(timezone.utc).isoformat()
            if assigned_runner_token != actor_token:
                raise HTTPException(status_code=403, detail="Order is assigned to a different runner.")
            last_runner_heartbeat_at = datetime.now(timezone.utc).isoformat()

    now = datetime.now(timezone.utc).isoformat()
    if target_status == "ready_for_collection":
        pickup_code = pickup_code or make_pickup_code()
        ready_for_collection_at = now
    if target_status not in ACTIVE_RUNNER_ORDER_STATUSES:
        last_runner_heartbeat_at = None if target_status in TERMINAL_STATUSES else last_runner_heartbeat_at
    cur.execute(
        """
        UPDATE orders
        SET status = ?, updated_at = ?, status_updated_at = ?, version = COALESCE(version, 1) + 1,
            assigned_runner_token = ?, assigned_runner_role = ?,
            assignment_started_at = ?, last_runner_heartbeat_at = ?,
            pickup_code = ?, ready_for_collection_at = ?
        WHERE id = ?
        """,
        (
            target_status,
            now,
            now,
            assigned_runner_token,
            assigned_runner_role,
            assignment_started_at,
            last_runner_heartbeat_at,
            pickup_code,
            ready_for_collection_at,
            order_id,
        ),
    )
    if target_status in ACTIVE_RUNNER_ORDER_STATUSES and actor_role == "runner":
        resolve_order_incidents(
            cur,
            order_id,
            actor_role="system",
            codes=RUNNER_RECOVERY_INCIDENT_CODES,
            auto_detected=True,
        )
    cur.execute("SELECT version FROM orders WHERE id = ?", (order_id,))
    version_row = cur.fetchone()
    version = int(version_row["version"]) if version_row is not None else 1
    return {"order_id": order_id, "status": target_status, "version": version}


def make_profile_token() -> str:
    return secrets.token_urlsafe(24)


def hash_member_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=2**14, r=8, p=1).hex()
    return f"{salt}:{digest}"


def serialize_customer_profile(row: sqlite3.Row) -> dict[str, str | int | None]:
    preferred_delivery_mode = row["preferred_delivery_mode"]
    preferred_delivery_target = row["preferred_delivery_target"]
    last_delivery_mode = row["default_delivery_mode"]
    last_delivery_target = row["default_delivery_target"]
    return {
        "customer_id": row["id"],
        "venue_slug": row["venue_slug"],
        "name": row["name"],
        "email": row["email"],
        "delivery_mode": preferred_delivery_mode or last_delivery_mode,
        "delivery_target": preferred_delivery_target or last_delivery_target,
        "preferred_delivery_mode": preferred_delivery_mode,
        "preferred_delivery_target": preferred_delivery_target,
        "last_delivery_mode": last_delivery_mode,
        "last_delivery_target": last_delivery_target,
        "preferred_payment_method": row["preferred_payment_method"],
        "account_level": row["account_level"],
        "customer_token": row["profile_token"],
    }


def get_staff_token(authorization: str | None, *, venue_slug: str, allowed_roles: set[str]) -> tuple[str, dict[str, str]]:
    token_record = require_staff_token(authorization, venue_slug=venue_slug, allowed_roles=allowed_roles)
    token = authorization.split(" ", 1)[1].strip() if authorization else ""
    return token, token_record


def resolve_vendor_for_staff_login(cur: sqlite3.Cursor, venue_slug: str, vendor_slug: str | None = None) -> sqlite3.Row:
    vendor_row = (
        read_vendor_by_slug(cur, venue_slug, vendor_slug)
        if vendor_slug and vendor_slug.strip()
        else read_first_vendor_row(cur, venue_slug)
    )
    if vendor_row is None:
        raise HTTPException(status_code=404, detail="Vendor not found for this venue.")
    if not bool(vendor_row["is_active"]):
        raise HTTPException(status_code=403, detail="Vendor is inactive.")
    return vendor_row


def resolve_vendor_slug_for_dev_pin(venue_slug: str, pin: str, vendor_slug: str | None = None) -> str:
    venue_vendor_pins = DEV_VENDOR_PINS.get(venue_slug.strip(), {})
    normalized_pin = pin.strip()
    if vendor_slug and vendor_slug.strip():
        expected_pin = venue_vendor_pins.get(vendor_slug.strip())
        if expected_pin != normalized_pin:
            raise HTTPException(status_code=401, detail="Invalid vendor PIN.")
        return vendor_slug.strip()

    for configured_vendor_slug, configured_pin in venue_vendor_pins.items():
        if configured_pin == normalized_pin:
            return configured_vendor_slug
    raise HTTPException(status_code=401, detail="Invalid vendor PIN.")


def get_vendor_token_scope(
    token_record: dict[str, object],
    *,
    allow_admin: bool = False,
) -> int | None:
    role = str(token_record.get("role") or "")
    if role == "admin" and allow_admin:
        return None
    if role != "vendor":
        raise HTTPException(status_code=403, detail="Vendor scope required.")
    vendor_id = token_record.get("vendor_id")
    if vendor_id is None:
        raise HTTPException(status_code=403, detail="Vendor token is missing vendor scope.")
    return int(vendor_id)


def order_is_owned_by_vendor(cur: sqlite3.Cursor, order_row: sqlite3.Row, vendor_id: int) -> bool:
    try:
        order_items = json.loads(order_row["items_json"])
    except (TypeError, ValueError):
        return False
    item_ids = sorted({str(item.get("item_id") or "").strip() for item in order_items if str(item.get("item_id") or "").strip()})
    if not item_ids:
        return False
    placeholders = ", ".join("?" for _ in item_ids)
    cur.execute(
        f"""
        SELECT item_id, vendor_id
        FROM menu_items
        WHERE venue_slug = ? AND item_id IN ({placeholders}) AND vendor_id IS NOT NULL
        """,
        (str(order_row["venue_slug"]), *item_ids),
    )
    owners = {str(row["item_id"]): int(row["vendor_id"]) for row in cur.fetchall()}
    if len(owners) != len(item_ids):
        return False
    return set(owners.values()) == {vendor_id}


def read_customer_by_token(cur: sqlite3.Cursor, venue_slug: str, token: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
               preferred_delivery_mode, preferred_delivery_target,
               preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
        FROM customers
        WHERE venue_slug = ? AND profile_token = ?
        """,
        (venue_slug, token),
    )
    return cur.fetchone()


def read_customer_by_email(cur: sqlite3.Cursor, venue_slug: str, email: str) -> sqlite3.Row | None:
    cur.execute(
        """
        SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
               preferred_delivery_mode, preferred_delivery_target,
               preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
        FROM customers
        WHERE venue_slug = ? AND email = ?
        """,
        (venue_slug, email.strip().lower()),
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
        existing = read_customer_by_email(cur, normalized_venue_slug, normalized_email)

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
               preferred_delivery_mode, preferred_delivery_target,
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
    vendor_id: int | None = None,
) -> dict[str, object]:
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

    if vendor_id is not None and token_record["role"] == "vendor":
        token_vendor_id = token_record.get("vendor_id")
        if token_vendor_id is None or int(token_vendor_id) != vendor_id:
            raise HTTPException(status_code=403, detail="Token does not match vendor.")
    token_record["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    return token_record


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/bug-reports")
def create_bug_report(payload: BugReportRequest) -> dict[str, object]:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Bug report message is required.")
    created_at = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO bug_reports (
          title, message, description, source, role, venue_slug, route_name,
          page_url, user_agent, stack, context_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.title.strip() if payload.title else None,
            message,
            payload.description.strip() if payload.description else None,
            payload.source.strip() if payload.source else None,
            payload.role.strip() if payload.role else None,
            payload.venue_slug.strip() if payload.venue_slug else None,
            payload.route_name.strip() if payload.route_name else None,
            payload.page_url.strip() if payload.page_url else None,
            payload.user_agent.strip() if payload.user_agent else None,
            payload.stack.strip() if payload.stack else None,
            json.dumps(payload.context_json) if payload.context_json is not None else None,
            created_at,
        ),
    )
    conn.commit()
    report_id = int(cur.lastrowid)
    conn.close()
    return {"report_id": report_id, "created_at": created_at}


@app.post("/api/staff/auth")
def staff_auth(payload: StaffAuthRequest) -> dict[str, object]:
    normalized_venue_slug = payload.venue_slug.strip()
    normalized_pin = payload.pin.strip()
    resolved_vendor_slug: str | None = None
    if payload.role == "vendor":
        resolved_vendor_slug = resolve_vendor_slug_for_dev_pin(
            normalized_venue_slug,
            normalized_pin,
            payload.vendor_slug,
        )
    else:
        expected_pin = DEV_STAFF_PINS.get(normalized_venue_slug)
        if expected_pin is None or normalized_pin != expected_pin:
            raise HTTPException(status_code=401, detail="Invalid staff PIN.")

    token_record: dict[str, object] = {
        "venue_slug": normalized_venue_slug,
        "role": payload.role,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.role == "vendor":
        conn = get_conn()
        cur = conn.cursor()
        vendor_row = resolve_vendor_for_staff_login(cur, normalized_venue_slug, resolved_vendor_slug)
        conn.close()
        token_record["vendor_id"] = int(vendor_row["id"])
        token_record["vendor_slug"] = str(vendor_row["slug"])
        token_record["vendor_name"] = str(vendor_row["name"])

    token = secrets.token_urlsafe(24)
    STAFF_TOKENS[token] = token_record
    return {"token": token, **token_record}


@app.post("/api/runner/access")
def runner_access(payload: RunnerAccessRequest) -> dict[str, object]:
    access_code = payload.access_code.strip()
    if not access_code:
        raise HTTPException(status_code=422, detail="Access code is required.")

    conn = get_conn()
    cur = conn.cursor()
    venue_row = read_venue_by_runner_access_code(cur, access_code)
    conn.close()
    if venue_row is None:
        raise HTTPException(status_code=401, detail="Invalid runner access code.")

    token_record: dict[str, object] = {
        "venue_slug": str(venue_row["slug"]),
        "venue_name": str(venue_row["name"]),
        "role": "runner",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }
    token = secrets.token_urlsafe(24)
    STAFF_TOKENS[token] = token_record
    return {"token": token, **token_record}


@app.post("/api/register")
async def register_user(request: Request) -> dict[str, int | str]:
    payload = await parse_request_model(request, RegisterRequest)
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


@app.get("/api/customers/lookup")
def lookup_customer(
    venue_slug: str,
    email: str,
) -> dict[str, str | int | bool | None]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_customer_by_email(cur, venue_slug.strip(), email.strip())
    conn.close()
    if row is None:
        return {"exists": False, "venue_slug": venue_slug.strip(), "email": email.strip().lower()}
    return {
        "exists": True,
        "customer_id": row["id"],
        "venue_slug": row["venue_slug"],
        "name": row["name"],
        "email": row["email"],
        "account_level": row["account_level"],
    }


@app.post("/api/customers/profile")
def save_customer_profile(payload: CustomerProfileRequest) -> dict[str, object]:
    conn = get_conn()
    cur = conn.cursor()
    existing = read_customer_by_email(cur, payload.venue_slug.strip(), payload.email.strip())
    row = existing
    if row is None:
        row = upsert_customer_profile(
            cur,
            venue_slug=payload.venue_slug,
            name=payload.name,
            email=payload.email,
            delivery_mode=payload.delivery_mode,
            delivery_target=payload.delivery_target,
        )
    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE customers
        SET name = ?, email = ?, preferred_delivery_mode = ?, preferred_delivery_target = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            payload.name.strip(),
            payload.email.strip().lower(),
            payload.delivery_mode.strip(),
            payload.delivery_target.strip(),
            now,
            int(row["id"]),
        ),
    )
    cur.execute(
        """
        SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
               preferred_delivery_mode, preferred_delivery_target,
               preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
        FROM customers
        WHERE id = ?
        """,
        (int(row["id"]),),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        raise HTTPException(status_code=500, detail="Could not load updated customer profile.")
    return serialize_customer_profile(row)


@app.post("/api/customers/upgrade-account")
def upgrade_customer_account(payload: CustomerUpgradeRequest) -> dict[str, object]:
    normalized_venue_slug = payload.venue_slug.strip()
    normalized_email = payload.email.strip().lower()
    password = payload.password.strip()
    if len(password) < 8:
      raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    conn = get_conn()
    cur = conn.cursor()
    row = read_customer_by_email(cur, normalized_venue_slug, normalized_email)
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Customer profile not found.")

    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE customers
        SET account_level = 'member', password_hash = ?, updated_at = ?
        WHERE id = ?
        """,
        (hash_member_password(password), now, int(row["id"])),
    )
    cur.execute(
        """
        SELECT id, venue_slug, name, email, default_delivery_mode, default_delivery_target,
               preferred_delivery_mode, preferred_delivery_target,
               preferred_payment_method, profile_token, account_level, created_at, updated_at, last_order_at
        FROM customers
        WHERE id = ?
        """,
        (int(row["id"]),),
    )
    updated_row = cur.fetchone()
    conn.commit()
    conn.close()
    if updated_row is None:
        raise HTTPException(status_code=500, detail="Could not load upgraded customer profile.")
    return serialize_customer_profile(updated_row)


@app.get("/api/menu")
def get_menu(
    venue_slug: str,
    include_inactive: bool = False,
    authorization: str | None = Header(default=None),
) -> dict[str, list[dict[str, object]]]:
    token_record: dict[str, object] | None = None
    vendor_scope_id: int | None = None
    if include_inactive:
        token_record = require_staff_token(authorization, venue_slug=venue_slug, allowed_roles={"vendor", "admin"})
        if str(token_record.get("role") or "") == "vendor":
            vendor_scope_id = get_vendor_token_scope(token_record)
    conn = get_conn()
    cur = conn.cursor()
    if include_inactive:
        if vendor_scope_id is not None:
            cur.execute(
                """
                SELECT mi.venue_slug, mi.vendor_id, v.slug AS vendor_slug, v.name AS vendor_name,
                       mi.item_id, mi.item_name, mi.category, mi.price_text, mi.available_modes_json,
                       mi.is_active, mi.sort_order, mi.updated_at
                FROM menu_items mi
                LEFT JOIN vendors v ON v.id = mi.vendor_id
                WHERE mi.venue_slug = ? AND mi.vendor_id = ?
                ORDER BY mi.sort_order ASC, mi.item_name ASC
                """,
                (venue_slug.strip(), vendor_scope_id),
            )
        else:
            cur.execute(
                """
                SELECT mi.venue_slug, mi.vendor_id, v.slug AS vendor_slug, v.name AS vendor_name,
                       mi.item_id, mi.item_name, mi.category, mi.price_text, mi.available_modes_json,
                       mi.is_active, mi.sort_order, mi.updated_at
                FROM menu_items mi
                LEFT JOIN vendors v ON v.id = mi.vendor_id
                WHERE mi.venue_slug = ?
                ORDER BY mi.sort_order ASC, mi.item_name ASC
                """,
                (venue_slug.strip(),),
            )
    else:
        cur.execute(
            """
            SELECT mi.venue_slug, mi.vendor_id, v.slug AS vendor_slug, v.name AS vendor_name,
                   mi.item_id, mi.item_name, mi.category, mi.price_text, mi.available_modes_json,
                   mi.is_active, mi.sort_order, mi.updated_at
            FROM menu_items mi
            LEFT JOIN vendors v ON v.id = mi.vendor_id
            WHERE mi.venue_slug = ? AND mi.is_active = 1
            ORDER BY mi.sort_order ASC, mi.item_name ASC
            """,
            (venue_slug.strip(),),
        )
    rows = cur.fetchall()
    conn.close()
    return {"items": [serialize_menu_item_row(row) for row in rows]}


@app.post("/api/menu/items")
def create_menu_item(
    payload: MenuItemPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    token_record = require_staff_token(authorization, venue_slug=payload.venue_slug.strip(), allowed_roles={"vendor", "admin"})
    now = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    cur = conn.cursor()
    target_vendor = (
        resolve_vendor_for_staff_login(cur, payload.venue_slug.strip(), str(token_record.get("vendor_slug") or ""))
        if str(token_record.get("role") or "") == "vendor"
        else read_first_vendor_row(cur, payload.venue_slug)
    )
    if target_vendor is None:
        conn.close()
        raise HTTPException(status_code=500, detail="Default vendor is not configured for this venue.")
    cur.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM menu_items WHERE venue_slug = ? AND vendor_id = ?",
        (payload.venue_slug.strip(), int(target_vendor["id"])),
    )
    next_sort_order = int(cur.fetchone()[0] or 0) + 10
    cur.execute(
        """
        INSERT INTO menu_items (
          venue_slug, vendor_id, item_id, item_name, category, price_text,
          available_modes_json, is_active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.venue_slug.strip(),
            int(target_vendor["id"]),
            payload.item_id.strip(),
            payload.item_name.strip(),
            payload.category.strip(),
            payload.price_text.strip(),
            json.dumps(payload.available_modes),
            1 if payload.is_active else 0,
            next_sort_order,
            now,
            now,
        ),
    )
    cur.execute(
        """
        SELECT mi.venue_slug, mi.vendor_id, v.slug AS vendor_slug, v.name AS vendor_name,
               mi.item_id, mi.item_name, mi.category, mi.price_text, mi.available_modes_json,
               mi.is_active, mi.sort_order, mi.updated_at
        FROM menu_items mi
        LEFT JOIN vendors v ON v.id = mi.vendor_id
        WHERE venue_slug = ? AND item_id = ?
        """,
        (payload.venue_slug.strip(), payload.item_id.strip()),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return serialize_menu_item_row(row)


@app.put("/api/menu/items/{item_id}")
def update_menu_item(
    item_id: str,
    payload: MenuItemPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    token_record = require_staff_token(authorization, venue_slug=payload.venue_slug.strip(), allowed_roles={"vendor", "admin"})
    now = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    cur = conn.cursor()
    if str(token_record.get("role") or "") == "vendor":
        vendor_scope_id = get_vendor_token_scope(token_record)
        cur.execute(
            """
            UPDATE menu_items
            SET item_name = ?, category = ?, price_text = ?, available_modes_json = ?, is_active = ?, updated_at = ?
            WHERE venue_slug = ? AND vendor_id = ? AND item_id = ?
            """,
            (
                payload.item_name.strip(),
                payload.category.strip(),
                payload.price_text.strip(),
                json.dumps(payload.available_modes),
                1 if payload.is_active else 0,
                now,
                payload.venue_slug.strip(),
                vendor_scope_id,
                item_id.strip(),
            ),
        )
    else:
        cur.execute(
            """
            UPDATE menu_items
            SET item_name = ?, category = ?, price_text = ?, available_modes_json = ?, is_active = ?, updated_at = ?
            WHERE venue_slug = ? AND item_id = ?
            """,
            (
                payload.item_name.strip(),
                payload.category.strip(),
                payload.price_text.strip(),
                json.dumps(payload.available_modes),
                1 if payload.is_active else 0,
                now,
                payload.venue_slug.strip(),
                item_id.strip(),
            ),
        )
    cur.execute(
        """
        SELECT mi.venue_slug, mi.vendor_id, v.slug AS vendor_slug, v.name AS vendor_name,
               mi.item_id, mi.item_name, mi.category, mi.price_text, mi.available_modes_json,
               mi.is_active, mi.sort_order, mi.updated_at
        FROM menu_items mi
        LEFT JOIN vendors v ON v.id = mi.vendor_id
        WHERE venue_slug = ? AND item_id = ?
        """,
        (payload.venue_slug.strip(), item_id.strip()),
    )
    row = cur.fetchone()
    conn.commit()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    return serialize_menu_item_row(row)


@app.delete("/api/menu/items/{item_id}")
def delete_menu_item(
    item_id: str,
    venue_slug: str,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    token_record = require_staff_token(authorization, venue_slug=venue_slug.strip(), allowed_roles={"vendor", "admin"})
    conn = get_conn()
    cur = conn.cursor()
    if str(token_record.get("role") or "") == "vendor":
        vendor_scope_id = get_vendor_token_scope(token_record)
        cur.execute(
            "DELETE FROM menu_items WHERE venue_slug = ? AND vendor_id = ? AND item_id = ?",
            (venue_slug.strip(), vendor_scope_id, item_id.strip()),
        )
    else:
        cur.execute(
            "DELETE FROM menu_items WHERE venue_slug = ? AND item_id = ?",
            (venue_slug.strip(), item_id.strip()),
        )
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    if deleted < 1:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    return {"deleted_item_id": item_id.strip(), "venue_slug": venue_slug.strip()}


@app.post("/api/orders")
async def create_order(request: Request) -> dict[str, object]:
    payload = await parse_request_model(request, CreateOrderRequest)
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item.")

    now = datetime.now(timezone.utc).isoformat()
    business_day = business_day_for_timestamp(now)
    payment_status: PaymentStatus = "captured"
    payment_reference = "prototype_checkout"
    normalized_delivery_mode = payload.delivery_mode.strip()
    eta_text = (
        "Ready in 5-10 min"
        if is_click_and_collect_mode(normalized_delivery_mode)
        else "12-18 min" if normalized_delivery_mode.lower().startswith("seat") else "8-12 min"
    )
    conn = get_conn()
    cur = conn.cursor()
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
            "business_day": active_order_row["business_day"],
            "display_order_number": int(active_order_row["display_order_number"] or active_order_row["id"]),
            "status": active_order_row["status"],
            "eta_text": active_order_row["eta_text"],
            "checkout_type": active_order_row["checkout_type"],
            "version": active_order_row["version"],
            "existing_active_order": True,
            "customer_profile": customer_profile,
        }

    display_order_number = allocate_display_order_number(
        cur,
        venue_slug=payload.venue_slug.strip(),
        business_day=business_day,
    )
    cur.execute(
        """
        INSERT INTO orders (
          venue_slug, business_day, display_order_number, customer_id, payment_status, payment_reference, paid_at,
          tip_amount_pennies, tipped_at,
          customer_name, customer_email, delivery_mode, delivery_target,
          items_json, checkout_type, status, eta_text, created_at, updated_at, status_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.venue_slug.strip(),
            business_day,
            display_order_number,
            customer_id,
            payment_status,
            payment_reference,
            now,
            normalize_tip_amount_pennies(payload.tip_amount_pennies),
            now if normalize_tip_amount_pennies(payload.tip_amount_pennies) > 0 else None,
            payload.customer_name.strip(),
            payload.customer_email.strip().lower(),
            normalized_delivery_mode,
            payload.delivery_target.strip(),
            json.dumps([item.model_dump() for item in payload.items]),
            payload.checkout_type,
            "received",
            eta_text,
            now,
            now,
            now,
        ),
    )
    conn.commit()
    order_id = cur.lastrowid
    conn.close()
    response: dict[str, object] = {
        "order_id": order_id,
        "business_day": business_day,
        "display_order_number": display_order_number,
        "status": "received",
        "eta_text": eta_text,
        "checkout_type": payload.checkout_type,
        "payment_status": payment_status,
        "payment_reference": payment_reference,
        "paid_at": now,
        "tip_amount_pennies": normalize_tip_amount_pennies(payload.tip_amount_pennies),
        "tipped_at": now if normalize_tip_amount_pennies(payload.tip_amount_pennies) > 0 else None,
        "has_tip": normalize_tip_amount_pennies(payload.tip_amount_pennies) > 0,
        "version": 1,
    }
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
    payload = None
    if active_order_row is not None:
        reconciled_row = load_order_with_health(cur, int(active_order_row["id"]))
        payload = serialize_order_row_with_health(cur, reconciled_row)
    conn.commit()
    conn.close()
    return {"active_order": payload}


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
    payload = None
    if active_order_row is not None:
        active_order_row = record_runner_heartbeat(cur, active_order_row, runner_token=runner_token)
        reconciled_row = reconcile_order_operational_health(cur, active_order_row)
        payload = serialize_order_row_with_health(cur, reconciled_row)
    conn.commit()
    conn.close()
    return {"active_order": payload}


@app.get("/api/orders")
def list_orders(
    venue_slug: str | None = None,
    status: OrderStatus | None = Query(default=None),
    limit: int = 100,
    authorization: str | None = Header(default=None),
) -> dict[str, list[dict]]:
    token_record = require_staff_token(authorization, venue_slug=venue_slug, allowed_roles={"runner", "vendor", "admin"})
    conn = get_conn()
    cur = conn.cursor()
    safe_limit = max(1, min(limit, 200))
    if venue_slug and status:
        cur.execute(
            """
            SELECT id
            FROM orders
            WHERE venue_slug = ? AND status = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (venue_slug, status, safe_limit),
        )
    elif venue_slug:
        cur.execute(
            """
            SELECT id
            FROM orders
            WHERE venue_slug = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (venue_slug, safe_limit),
        )
    elif status:
        cur.execute(
            """
            SELECT id
            FROM orders
            WHERE status = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (status, safe_limit),
        )
    else:
        cur.execute(
            """
            SELECT id
            FROM orders
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
    rows = [load_order_with_health(cur, int(row["id"])) for row in cur.fetchall()]
    if str(token_record.get("role") or "") == "vendor":
        vendor_scope_id = get_vendor_token_scope(token_record)
        rows = [row for row in rows if order_is_owned_by_vendor(cur, row, vendor_scope_id)]
    payload = [serialize_order_row_with_health(cur, row) for row in rows]
    conn.commit()
    conn.close()
    return {
        "orders": payload
    }


@app.get("/api/order-status/{order_id}")
def order_status(order_id: int) -> dict:
    conn = get_conn()
    cur = conn.cursor()
    row = load_order_with_health(cur, order_id)
    payload = serialize_order_row_with_health(cur, row)
    conn.commit()
    conn.close()
    return payload


@app.post("/api/orders/{order_id}/accept")
def accept_order(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    result = transition_order_status(cur, order_id, "accepted", actor_role="vendor")
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
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    result = transition_order_status(cur, order_id, "rejected", actor_role="vendor")
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
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    target_status: OrderStatus = "ready_for_collection" if is_click_and_collect_mode(str(row["delivery_mode"])) else "ready"
    result = transition_order_status(cur, order_id, target_status, actor_role="vendor")
    conn.commit()
    conn.close()
    return result


@app.post("/api/orders/{order_id}/collect")
def collect_order(
    order_id: int,
    payload: CollectVerificationRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    if not is_click_and_collect_mode(str(row["delivery_mode"])):
        conn.close()
        raise HTTPException(status_code=409, detail="Only click and collect orders can be marked collected.")
    expected_code = str(row["pickup_code"] or "").strip().upper()
    if not expected_code or expected_code != payload.pickup_code.strip().upper():
        conn.close()
        raise HTTPException(status_code=400, detail="Pickup code did not match.")
    result = transition_order_status(cur, order_id, "collected", actor_role="vendor")
    conn.commit()
    conn.close()
    return result


@app.post("/api/orders/{order_id}/uncollected")
def mark_order_uncollected(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, int | str]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    if not is_click_and_collect_mode(str(row["delivery_mode"])):
        conn.close()
        raise HTTPException(status_code=409, detail="Only click and collect orders can be marked uncollected.")
    result = transition_order_status(cur, order_id, "uncollected", actor_role="vendor")
    conn.commit()
    conn.close()
    return result


@app.post("/api/orders/{order_id}/fail")
def fail_order(
    order_id: int,
    payload: OrderIssueRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    result = transition_order_status(cur, order_id, "failed", actor_role="vendor")
    failed_at = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE orders
        SET failure_reason = ?, failed_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (payload.reason.strip() if payload.reason else None, failed_at, failed_at, order_id),
    )
    conn.commit()
    updated = read_order_row(cur, order_id)
    conn.close()
    response = serialize_order_row(updated)
    response["status_result"] = result
    return response


@app.post("/api/orders/{order_id}/attention")
def flag_order_attention(
    order_id: int,
    payload: OrderAttentionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Reason is required.")
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    now_iso = datetime.now(timezone.utc).isoformat()
    created = open_order_incident(
        cur,
        row,
        code="manual_attention",
        severity="warning",
        summary="Manual attention requested for this order.",
        detail=reason,
        auto_detected=False,
        opened_by_role=str(token_record["role"]),
        observed_at=now_iso,
    )
    if created:
        touch_order_record(cur, order_id, now_iso=now_iso)
    updated = load_order_with_health(cur, order_id)
    response = serialize_order_row_with_health(cur, updated)
    conn.commit()
    conn.close()
    return response


@app.post("/api/orders/{order_id}/resolve-attention")
def resolve_order_attention(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    resolved = resolve_order_incidents(cur, order_id, actor_role=str(token_record["role"]))
    if resolved:
        touch_order_record(cur, order_id, now_iso=datetime.now(timezone.utc).isoformat())
    updated = load_order_with_health(cur, order_id)
    response = serialize_order_row_with_health(cur, updated)
    conn.commit()
    conn.close()
    return response


@app.post("/api/orders/{order_id}/release-runner")
def release_order_runner(
    order_id: int,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    token_record = require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"vendor", "admin"})
    if str(token_record.get("role") or "") == "vendor" and not order_is_owned_by_vendor(cur, row, get_vendor_token_scope(token_record)):
        conn.close()
        raise HTTPException(status_code=403, detail="Order does not belong to this vendor.")
    if str(row["status"] or "") != "assigned" or not str(row["assigned_runner_token"] or ""):
        conn.close()
        raise HTTPException(status_code=409, detail="Only assigned orders with a runner can be released.")
    now_iso = datetime.now(timezone.utc).isoformat()
    open_order_incident(
        cur,
        row,
        code="manual_runner_release",
        severity="high",
        summary="Runner was manually released from this order.",
        detail="Venue staff released the runner assignment so another runner can recover the order.",
        auto_detected=False,
        opened_by_role=str(token_record["role"]),
        observed_at=now_iso,
    )
    release_runner_assignment(cur, order_id, now_iso=now_iso)
    updated = load_order_with_health(cur, order_id)
    response = serialize_order_row_with_health(cur, updated)
    conn.commit()
    conn.close()
    return response


@app.post("/api/orders/{order_id}/refund")
def refund_order(
    order_id: int,
    payload: OrderIssueRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    conn = get_conn()
    cur = conn.cursor()
    row = read_order_row(cur, order_id)
    require_staff_token(authorization, venue_slug=str(row["venue_slug"]), allowed_roles={"admin"})
    if str(row["payment_status"]) != "captured":
        conn.close()
        raise HTTPException(status_code=409, detail="Only captured payments can be refunded in this prototype.")
    refunded_at = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE orders
        SET payment_status = 'refunded', refund_reason = ?, refunded_at = ?, updated_at = ?, version = COALESCE(version, 1) + 1
        WHERE id = ?
        """,
        (payload.reason.strip() if payload.reason else None, refunded_at, refunded_at, order_id),
    )
    conn.commit()
    updated = read_order_row(cur, order_id)
    conn.close()
    return serialize_order_row(updated)


@app.post("/api/orders/{order_id}/tip")
async def add_tip(order_id: int, request: Request) -> dict[str, object]:
    payload = await parse_request_model(request, AddTipRequest)
    conn = get_conn()
    cur = conn.cursor()
    result = add_tip_to_order(cur, order_id, payload.tip_amount_pennies)
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
        allowed_roles={"runner", "vendor", "admin"},
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
