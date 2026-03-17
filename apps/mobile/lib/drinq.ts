import { Platform } from "react-native";

export type VenueMenuItem = {
  id: string;
  name: string;
  category: string;
  price: string;
  options: string[];
};

export type VenueDefinition = {
  slug: string;
  name: string;
  tag: string;
  subtitle: string;
  fulfillmentModes: {
    label: string;
    eta: string;
    fee: string;
    detail: string;
  }[];
  menuItems: VenueMenuItem[];
};

export type CartLine = {
  item_id: string;
  item_name: string;
  price_text: string;
  quantity: number;
};

export type CustomerProfile = {
  customerId?: number | null;
  token: string;
  name: string;
  email: string;
  deliveryMode: string;
  deliveryTarget: string;
  checkoutType: "guest" | "remembered";
};

export type OrderStatusResponse = {
  order_id: number;
  venue_slug: string;
  customer_id?: number | null;
  pickup_code?: string | null;
  ready_for_collection_at?: string | null;
  payment_status: string;
  payment_reference?: string | null;
  paid_at?: string | null;
  tip_amount_pennies: number;
  tipped_at?: string | null;
  has_tip: boolean;
  customer_name: string;
  customer_email: string;
  delivery_mode: string;
  delivery_target: string;
  items: CartLine[];
  version: number;
  checkout_type: "guest" | "remembered";
  status: string;
  eta_text: string;
  created_at: string;
  updated_at: string;
};

export const VENUE: VenueDefinition = {
  slug: "brentford-fc",
  name: "Brentford FC - Gtech Community Stadium",
  tag: "MATCHDAY PARTNER",
  subtitle: "Don't queue. Order drinks to your seat, nearest point, or collect at your pace.",
  fulfillmentModes: [
    {
      label: "Seat Delivery",
      eta: "15-20 min",
      fee: "PS1.99",
      detail: "Runner delivers directly to your seat block/row/seat."
    },
    {
      label: "Nearest Point",
      eta: "8-12 min",
      fee: "PS0.99",
      detail: "Pickup at your closest accessible delivery point."
    },
    {
      label: "Click & Collect",
      eta: "5-10 min",
      fee: "Free",
      detail: "Collect at designated partner bar lane."
    }
  ],
  menuItems: [
    {
      id: "bf-lager",
      name: "House Lager Pint",
      category: "Beer",
      price: "PS6.80",
      options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
    },
    {
      id: "bf-cider",
      name: "Dry Cider Pint",
      category: "Beer",
      price: "PS6.60",
      options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
    },
    {
      id: "bf-gintonic",
      name: "Gin & Tonic",
      category: "Spirits",
      price: "PS8.20",
      options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
    },
    {
      id: "bf-soft",
      name: "Soft Drink 500ml",
      category: "Soft Drinks",
      price: "PS3.00",
      options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
    },
    {
      id: "bf-water",
      name: "Water 500ml",
      category: "Soft Drinks",
      price: "PS2.20",
      options: ["Seat Delivery", "Nearest Point", "Click & Collect"]
    }
  ]
};

export function getApiBase() {
  if (Platform.OS === "android") {
    return "http://10.0.2.2:8000";
  }
  return "http://localhost:8000";
}

export function parsePriceText(priceText: string) {
  const normalized = Number(String(priceText).replace(/[^0-9.]/g, ""));
  return Number.isFinite(normalized) ? Math.round(normalized * 100) : 0;
}

export function formatPennies(amount: number) {
  return `PS${(Math.max(0, amount) / 100).toFixed(2)}`;
}

export function cartSubtotalPennies(items: CartLine[]) {
  return items.reduce((sum, item) => sum + parsePriceText(item.price_text) * item.quantity, 0);
}

export function deliveryFeePennies(deliveryMode: string) {
  const mode = VENUE.fulfillmentModes.find((entry) => entry.label === deliveryMode);
  if (!mode || mode.fee.toLowerCase() === "free") return 0;
  return parsePriceText(mode.fee);
}

export function totalPennies(items: CartLine[], deliveryMode: string, tipAmountPennies = 0) {
  return cartSubtotalPennies(items) + deliveryFeePennies(deliveryMode) + Math.max(0, tipAmountPennies);
}

export function isClickAndCollect(deliveryMode: string) {
  return deliveryMode.trim().toLowerCase() === "click & collect";
}

export function describeCustomerOrderState(order: Pick<OrderStatusResponse, "status" | "delivery_mode">) {
  const status = String(order.status || "").toLowerCase();
  const collectOrder = isClickAndCollect(order.delivery_mode);
  if (status === "received") return { chip: "ORDER RECEIVED", copy: "Your order is with the venue team and waiting to be accepted." };
  if (status === "accepted") {
    return {
      chip: collectOrder ? "PREPARING ORDER" : "ORDER ACCEPTED",
      copy: collectOrder
        ? "Your order has been accepted and is being prepared for collection."
        : "Your order has been accepted and is being prepared for delivery."
    };
  }
  if (status === "ready_for_collection") {
    return { chip: "READY FOR COLLECTION", copy: "Head to the collection lane and share your pickup code with staff." };
  }
  if (status === "ready") return { chip: "READY TO DISPATCH", copy: "Your order is ready and will be assigned for delivery shortly." };
  if (status === "assigned") return { chip: "RUNNER ASSIGNED", copy: "A runner has been assigned and will pick up your order now." };
  if (status === "loaded") return { chip: "READY WITH RUNNER", copy: "Your order is with the runner and about to leave." };
  if (status === "en_route") return { chip: "ON THE WAY", copy: "Your order is on the way to you now." };
  if (status === "arrived") return { chip: "ARRIVING NOW", copy: "Your runner is arriving with the order now." };
  if (status === "collected") return { chip: "COLLECTION COMPLETE", copy: "Collected successfully." };
  if (status === "fulfilled") return { chip: "ORDER COMPLETE", copy: "Delivered successfully." };
  if (status === "uncollected") return { chip: "ORDER CLOSED", copy: "This order was marked uncollected by the venue." };
  if (status === "rejected") return { chip: "ORDER DECLINED", copy: "The venue declined this order." };
  if (status === "cancelled") return { chip: "ORDER CANCELLED", copy: "This order has been cancelled." };
  if (status === "failed") return { chip: "ORDER ISSUE", copy: "There was a fulfilment issue with this order." };
  return { chip: "ORDER LIVE", copy: "Your order is being processed." };
}

export function describePaymentStatus(paymentStatus: string) {
  const status = String(paymentStatus || "").toLowerCase();
  if (status === "captured") return { label: "Paid", copy: "Payment confirmed for this order." };
  if (status === "failed") return { label: "Payment Failed", copy: "Payment could not be confirmed." };
  if (status === "refunded") return { label: "Refunded", copy: "Payment has been refunded." };
  return { label: "Payment Pending", copy: "Payment is still being processed." };
}

async function safeJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function saveCustomerProfile(profile: {
  name: string;
  email: string;
  deliveryMode: string;
  deliveryTarget: string;
}) {
  const response = await fetch(`${getApiBase()}/api/customers/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue_slug: VENUE.slug,
      name: profile.name,
      email: profile.email,
      delivery_mode: profile.deliveryMode,
      delivery_target: profile.deliveryTarget
    })
  });
  if (!response.ok) {
    throw new Error(`Profile save failed (${response.status})`);
  }
  return safeJson(response);
}

export async function fetchActiveCustomerOrder(customerToken: string) {
  const response = await fetch(
    `${getApiBase()}/api/customers/active-order?venue_slug=${encodeURIComponent(VENUE.slug)}`,
    {
      headers: { "X-Customer-Token": customerToken }
    }
  );
  if (response.status === 404 || response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Active order lookup failed (${response.status})`);
  }
  const data = await safeJson(response);
  return data.active_order ?? null;
}

export async function createOrder(payload: {
  customerName: string;
  customerEmail: string;
  deliveryMode: string;
  deliveryTarget: string;
  items: CartLine[];
  checkoutType: "guest" | "remembered";
  customerToken?: string | null;
  tipAmountPennies?: number;
}) {
  const response = await fetch(`${getApiBase()}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue_slug: VENUE.slug,
      customer_name: payload.customerName,
      customer_email: payload.customerEmail,
      delivery_mode: payload.deliveryMode,
      delivery_target: payload.deliveryTarget,
      items: payload.items,
      checkout_type: payload.checkoutType,
      customer_token: payload.customerToken ?? undefined,
      tip_amount_pennies: Math.max(0, payload.tipAmountPennies ?? 0)
    })
  });
  if (!response.ok) {
    throw new Error(`Checkout failed (${response.status})`);
  }
  return safeJson(response);
}

export async function fetchOrderStatus(orderId: number): Promise<OrderStatusResponse> {
  const response = await fetch(`${getApiBase()}/api/order-status/${orderId}`);
  if (!response.ok) {
    throw new Error(`Order lookup failed (${response.status})`);
  }
  return safeJson(response);
}

export async function submitTip(orderId: number, tipAmountPennies: number) {
  const response = await fetch(`${getApiBase()}/api/orders/${orderId}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tip_amount_pennies: tipAmountPennies })
  });
  if (!response.ok) {
    throw new Error(`Tip failed (${response.status})`);
  }
  return safeJson(response);
}

export async function joinMailingList(payload: { name: string; email: string }) {
  const response = await fetch(`${getApiBase()}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      venue_slug: VENUE.slug
    })
  });
  if (!response.ok) {
    throw new Error(`Mailing list signup failed (${response.status})`);
  }
  return safeJson(response);
}
