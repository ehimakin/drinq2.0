import { VENUES } from "./data/venues.js?v=20260314c";

const app = document.getElementById("app");
const STAFF_SESSION_KEY = "drinq_staff_session";
const REORDER_ROUND_KEY_PREFIX = "drinq_reorder_round_";
const CUSTOMER_PROFILE_KEY_PREFIX = "drinq_customer_profile_";
const ACTIVE_ORDER_KEY_PREFIX = "drinq_active_order_";
const DELIVERY_MODE_PREF_KEY_PREFIX = "drinq_delivery_mode_";
const PAGE_POLL_INTERVAL_MS = 5000;
// DEV ONLY: local staff PIN flow is enabled for prototype testing.
// Replace with proper auth before production.

const ROLE_PERMISSIONS = {
  customer: { runner: false, venue: false },
  runner: { runner: true, venue: false },
  venue: { runner: false, venue: true },
  admin: { runner: true, venue: true }
};
let pagePollHandle = null;
let pagePollInFlight = false;

function getVenueSlug() {
  const querySlug = new URLSearchParams(window.location.search).get("venue");
  if (querySlug) return querySlug;

  const hash = window.location.hash || "";
  const hashVenueMatch = hash.match(/#\/v\/([^/?]+)/i);
  if (hashVenueMatch) return hashVenueMatch[1];

  return "brentford-fc";
}

function getApiBase() {
  const queryApi = new URLSearchParams(window.location.search).get("api");
  if (queryApi) return queryApi;
  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:8000`;
}

function getRole() {
  const queryRole = new URLSearchParams(window.location.search).get("role");
  if (queryRole && queryRole in ROLE_PERMISSIONS) return queryRole;
  return "customer";
}

function getRoute() {
  const hash = window.location.hash || "";
  if (!hash || hash === "#/" || hash === "#") return { name: "menu" };

  const orderMatch = hash.match(/^#\/order-status\/(\d+)$/i);
  if (orderMatch) return { name: "order-status", orderId: Number(orderMatch[1]) };
  if (hash === "#/checkout") return { name: "checkout" };
  if (hash === "#/runner") return { name: "runner" };
  if (hash === "#/venue") return { name: "venue" };

  return { name: "menu" };
}

function getStaffSession() {
  try {
    const raw = localStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.token || !parsed.role || !parsed.venue_slug) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setStaffSession(session) {
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
}

function clearStaffSession() {
  localStorage.removeItem(STAFF_SESSION_KEY);
}

function getAuthHeader(venueSlug, requestedRole) {
  const session = getStaffSession();
  if (!session) return null;
  if (session.venue_slug !== venueSlug) return null;
  if (!(session.role === requestedRole || session.role === "admin")) return null;
  return `Bearer ${session.token}`;
}

async function loginStaff(apiBase, venueSlug, role) {
  const pin = window.prompt(`Enter staff PIN for ${venueSlug} (${role})`);
  if (!pin) return false;
  const response = await fetch(`${apiBase}/api/staff/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue_slug: venueSlug,
      pin: pin.trim(),
      role
    })
  });
  if (!response.ok) {
    throw new Error(`Staff auth failed (${response.status})`);
  }
  const data = await response.json();
  setStaffSession(data);
  return true;
}

function cartKey(venueSlug) {
  return `drinq_cart_${venueSlug}`;
}

function reorderRoundKey(venueSlug) {
  return `${REORDER_ROUND_KEY_PREFIX}${venueSlug}`;
}

function customerProfileKey(venueSlug) {
  return `${CUSTOMER_PROFILE_KEY_PREFIX}${venueSlug}`;
}

function activeOrderKey(venueSlug) {
  return `${ACTIVE_ORDER_KEY_PREFIX}${venueSlug}`;
}

function deliveryModePreferenceKey(venueSlug) {
  return `${DELIVERY_MODE_PREF_KEY_PREFIX}${venueSlug}`;
}

function readCart(venueSlug) {
  try {
    const raw = localStorage.getItem(cartKey(venueSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeCart(venueSlug, items) {
  localStorage.setItem(cartKey(venueSlug), JSON.stringify(items));
}

function clearCart(venueSlug) {
  localStorage.removeItem(cartKey(venueSlug));
}

function readReorderRound(venueSlug) {
  try {
    const raw = sessionStorage.getItem(reorderRoundKey(venueSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeReorderRound(venueSlug, items) {
  sessionStorage.setItem(reorderRoundKey(venueSlug), JSON.stringify(items));
}

function clearReorderRound(venueSlug) {
  sessionStorage.removeItem(reorderRoundKey(venueSlug));
}

function readCustomerProfile(venueSlug) {
  try {
    const raw = localStorage.getItem(customerProfileKey(venueSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      customerId: Number(parsed.customerId || 0) || null,
      token: String(parsed.token || ""),
      name: String(parsed.name || ""),
      email: String(parsed.email || ""),
      deliveryMode: String(parsed.deliveryMode || ""),
      deliveryTarget: String(parsed.deliveryTarget || ""),
      checkoutType: String(parsed.checkoutType || "remembered")
    };
  } catch {
    return null;
  }
}

function writeCustomerProfile(venueSlug, profile) {
  localStorage.setItem(customerProfileKey(venueSlug), JSON.stringify(profile));
}

function clearCustomerProfile(venueSlug) {
  localStorage.removeItem(customerProfileKey(venueSlug));
}

function readActiveOrderId(venueSlug) {
  const raw = localStorage.getItem(activeOrderKey(venueSlug));
  const orderId = Number(raw || 0);
  return orderId > 0 ? orderId : null;
}

function writeActiveOrderId(venueSlug, orderId) {
  localStorage.setItem(activeOrderKey(venueSlug), String(orderId));
}

function clearActiveOrderId(venueSlug) {
  localStorage.removeItem(activeOrderKey(venueSlug));
}

function readPreferredDeliveryMode(venueSlug) {
  const raw = localStorage.getItem(deliveryModePreferenceKey(venueSlug));
  if (raw) return String(raw);
  const savedProfile = readCustomerProfile(venueSlug);
  if (savedProfile?.deliveryMode) return savedProfile.deliveryMode;
  return "";
}

function writePreferredDeliveryMode(venueSlug, deliveryMode) {
  localStorage.setItem(deliveryModePreferenceKey(venueSlug), deliveryMode);
}

function stopPagePoll() {
  if (pagePollHandle) {
    window.clearInterval(pagePollHandle);
    pagePollHandle = null;
  }
  pagePollInFlight = false;
}

function startPagePoll(callback, intervalMs = PAGE_POLL_INTERVAL_MS) {
  stopPagePoll();
  pagePollHandle = window.setInterval(async () => {
    if (pagePollInFlight) return;
    pagePollInFlight = true;
    try {
      await callback();
    } finally {
      pagePollInFlight = false;
    }
  }, intervalMs);
}

async function hydrateCustomerProfile(apiBase, venueSlug) {
  const localProfile = readCustomerProfile(venueSlug);
  if (!localProfile?.token) return localProfile;

  try {
    const response = await fetch(
      `${apiBase}/api/customers/profile?venue_slug=${encodeURIComponent(venueSlug)}`,
      {
        headers: { "X-Customer-Token": localProfile.token },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 404) {
        clearCustomerProfile(venueSlug);
        return null;
      }
      return localProfile;
    }

    const remoteProfile = await response.json();
    const mergedProfile = {
      customerId: Number(remoteProfile.customer_id || 0) || null,
      token: String(remoteProfile.customer_token || localProfile.token || ""),
      name: String(remoteProfile.name || ""),
      email: String(remoteProfile.email || ""),
      deliveryMode: String(remoteProfile.delivery_mode || ""),
      deliveryTarget: String(remoteProfile.delivery_target || ""),
      checkoutType: "remembered"
    };
    writeCustomerProfile(venueSlug, mergedProfile);
    return mergedProfile;
  } catch {
    return localProfile;
  }
}

async function fetchOrderStatus(apiBase, orderId) {
  const response = await fetch(`${apiBase}/api/order-status/${orderId}?t=${Date.now()}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Not found (${response.status})`);
  }
  return response.json();
}

function isActiveCustomerOrderStatus(status) {
  return ["received", "accepted", "ready", "ready_for_collection", "assigned", "loaded", "en_route", "arrived"].includes(
    String(status || "").toLowerCase()
  );
}

function isClickAndCollectOrder(order) {
  return String(order?.delivery_mode || "").trim().toLowerCase() === "click & collect";
}

async function resolveActiveCustomerOrder(apiBase, venueSlug) {
  const savedProfile = readCustomerProfile(venueSlug);
  if (savedProfile?.token) {
    try {
      const response = await fetch(
        `${apiBase}/api/customers/active-order?venue_slug=${encodeURIComponent(venueSlug)}`,
        {
          headers: { "X-Customer-Token": savedProfile.token },
          cache: "no-store"
        }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.active_order?.order_id) {
          writeActiveOrderId(venueSlug, data.active_order.order_id);
          return data.active_order;
        }
      }
    } catch {
      // Fall back to locally remembered active order id if profile lookup is temporarily unavailable.
    }
  }

  const activeOrderId = readActiveOrderId(venueSlug);
  if (!activeOrderId) return null;

  try {
    const order = await fetchOrderStatus(apiBase, activeOrderId);
    if (isActiveCustomerOrderStatus(order.status)) {
      return order;
    }
    clearActiveOrderId(venueSlug);
    return null;
  } catch {
    clearActiveOrderId(venueSlug);
    return null;
  }
}

async function fetchRunnerActiveOrder(apiBase, venueSlug, authHeader) {
  const response = await fetch(
    `${apiBase}/api/runners/active-order?venue_slug=${encodeURIComponent(venueSlug)}`,
    {
      headers: { Authorization: authHeader },
      cache: "no-store"
    }
  );
  if (!response.ok) {
    throw new Error(`Could not fetch runner state (${response.status})`);
  }
  const data = await response.json();
  return data.active_order || null;
}

function describePaymentStatus(paymentStatus) {
  const status = String(paymentStatus || "").toLowerCase();
  if (status === "captured") {
    return { label: "Paid", copy: "Payment confirmed for this order." };
  }
  if (status === "failed") {
    return { label: "Payment Failed", copy: "Payment could not be confirmed." };
  }
  if (status === "refunded") {
    return { label: "Refunded", copy: "Payment has been refunded." };
  }
  return { label: "Payment Pending", copy: "Payment is still being processed." };
}

function describeCustomerOrderState(orderData) {
  const status = String(orderData.status || "").toLowerCase();
  const collectOrder = isClickAndCollectOrder(orderData);

  if (status === "received") {
    return { chip: "ORDER RECEIVED", copy: "Your order is with the venue team and waiting to be accepted." };
  }
  if (status === "accepted") {
    return {
      chip: collectOrder ? "PREPARING ORDER" : "ORDER ACCEPTED",
      copy: collectOrder
        ? "Your order has been accepted and is now being prepared for collection."
        : "Your order has been accepted and is being prepared for delivery."
    };
  }
  if (status === "ready_for_collection") {
    return { chip: "READY FOR COLLECTION", copy: "Head to the collection lane and share your pickup code with staff." };
  }
  if (status === "ready") {
    return { chip: "READY TO DISPATCH", copy: "Your order is ready and will be assigned for delivery shortly." };
  }
  if (status === "assigned") {
    return { chip: "RUNNER ASSIGNED", copy: "A runner has been assigned and will pick up your order now." };
  }
  if (status === "loaded") {
    return { chip: "READY WITH RUNNER", copy: "Your order is with the runner and about to leave." };
  }
  if (status === "en_route") {
    return { chip: "ON THE WAY", copy: "Your order is on the way to you now." };
  }
  if (status === "arrived") {
    return { chip: "ARRIVING NOW", copy: "Your runner is arriving with the order now." };
  }
  if (status === "collected") {
    return { chip: "COLLECTION COMPLETE", copy: "Collected successfully." };
  }
  if (status === "fulfilled") {
    return { chip: "ORDER COMPLETE", copy: "Delivered successfully." };
  }
  if (status === "uncollected") {
    return { chip: "ORDER CLOSED", copy: "This order was marked uncollected by the venue." };
  }
  if (status === "rejected") {
    return { chip: "ORDER DECLINED", copy: "The venue declined this order." };
  }
  if (status === "cancelled") {
    return { chip: "ORDER CANCELLED", copy: "This order has been cancelled." };
  }
  if (status === "failed") {
    return { chip: "ORDER FAILED", copy: "There was a fulfilment issue with this order." };
  }
  return { chip: "ORDER STATUS", copy: `Status: ${String(orderData.status || "Unknown")}` };
}

function bindOrderStatusActionButtons({ venueSlug, orderData, role, apiBase }) {
  document.getElementById("refreshStatusBtn")?.addEventListener("click", () => {
    renderOrderStatus(venueSlug, orderData.order_id, apiBase, role);
  });
  document.getElementById("backToMenuBtn")?.addEventListener("click", () => setRoute("/"));
  document.getElementById("tipRunnerBtn")?.addEventListener("click", () => {
    alert("Thanks. Tip flow placeholder for prototype.");
  });
  document.getElementById("reorderBtn")?.addEventListener("click", () => {
    const reordered = (orderData.items || []).map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price_text: item.price_text,
      price_pennies: parsePriceToPennies(item.price_text),
      quantity: Number(item.quantity) || 1
    }));
    clearCart(venueSlug);
    writeReorderRound(venueSlug, reordered);
    setRoute("/");
  });
}

function updateOrderStatusDom({ venueSlug, orderData, role, apiBase }) {
  if (isActiveCustomerOrderStatus(orderData.status)) {
    writeActiveOrderId(venueSlug, orderData.order_id);
  } else {
    clearActiveOrderId(venueSlug);
  }

  const status = String(orderData.status || "").toLowerCase();
  const isCustomerView = role === "customer";
  const isFulfilled = status === "fulfilled";
  const isCollected = status === "collected";
  const isCollectionReady = status === "ready_for_collection";
  const isCollectOrder = isClickAndCollectOrder(orderData);
  const isTerminal = ["fulfilled", "collected", "uncollected", "rejected", "cancelled", "failed"].includes(status);
  const payment = describePaymentStatus(orderData.payment_status);
  const customerState = describeCustomerOrderState(orderData);
  const brandChip = document.getElementById("orderStatusChip");
  const title = document.getElementById("orderStatusTitle");
  const heroCopy = document.getElementById("orderStatusHeroCopy");
  const statusSummary = document.getElementById("orderStatusSummary");
  const completion = document.getElementById("orderCompletion");
  const delivery = document.getElementById("orderDelivery");
  const items = document.getElementById("orderItems");
  const actions = document.getElementById("orderActions");

  if (!brandChip || !title || !heroCopy || !statusSummary || !completion || !delivery || !items || !actions) {
    return;
  }

  brandChip.textContent = isCustomerView ? customerState.chip : "ORDER STATUS";
  title.textContent = `Order #${orderData.order_id}`;
  heroCopy.innerHTML = isCustomerView
    ? `${escapeHtml(customerState.copy)}<br /><span class="api-note"><strong>${escapeHtml(payment.label)}</strong> · ${escapeHtml(orderData.eta_text)}</span>`
    : `Status: <strong>${escapeHtml(orderData.status)}</strong> · ETA: ${escapeHtml(orderData.eta_text)}`;
  statusSummary.innerHTML = `
    <section class="form-card order-status-spotlight">
      <p class="order-status-spotlight-label">${escapeHtml(isCustomerView ? customerState.chip : "ORDER STATUS")}</p>
      <h2>${escapeHtml(isCustomerView ? customerState.copy : `Order is currently ${orderData.status}.`)}</h2>
      <p class="order-status-spotlight-meta">
        <strong>${escapeHtml(payment.label)}</strong>
        <span aria-hidden="true">•</span>
        <span>${escapeHtml(orderData.eta_text)}</span>
      </p>
    </section>
  `;

  if (isCustomerView && (isFulfilled || isCollected)) {
    completion.innerHTML = `
      <section class="form-card completion-card">
        <h2>${isCollected ? "Order Collected" : "It's been delivered!"}</h2>
        <p>${isCollected ? "Your click and collect order has been handed over." : "Your order is complete."}</p>
        ${isCollected ? "" : `<button class="inline-btn" id="tipRunnerBtn">Tip Runner</button>`}
        <button class="inline-btn ghost" id="reorderBtn">Order Again</button>
      </section>
    `;
  } else if (isCustomerView && isCollectionReady) {
    completion.innerHTML = `
      <section class="form-card completion-card">
        <h2>Ready For Collection</h2>
        <p>Head to the dedicated collection lane and share this code with staff:</p>
        <p><strong>${escapeHtml(orderData.pickup_code || "Pending code")}</strong></p>
        <p>Orders not collected within 12 minutes of being ready may be discarded.</p>
        <p class="api-note">${escapeHtml(payment.copy)}</p>
      </section>
    `;
  } else if (isTerminal) {
    completion.innerHTML = isCustomerView
      ? `
        <section class="form-card completion-card">
          <h2>${isFulfilled ? "Order Complete" : isCollected ? "Collection Complete" : "Order Closed"}</h2>
          <p>${isFulfilled ? "Delivered successfully." : isCollected ? "Collected successfully." : `This order has now ${escapeHtml(status)}.`}</p>
          <button class="inline-btn ghost" id="reorderBtn">${isFulfilled || isCollected ? "Order Again" : "Start New Order"}</button>
        </section>
      `
      : `
        <section class="form-card">
          <h2>Order Update</h2>
          <p>Order status is <strong>${escapeHtml(status)}</strong>.</p>
        </section>
      `;
  } else {
    completion.innerHTML = "";
  }

  delivery.innerHTML = `
    <section class="form-card">
      <h2>${isCollectOrder ? "Collection" : "Delivery"}</h2>
      <p><strong>Mode:</strong> ${escapeHtml(orderData.delivery_mode)}</p>
      <p><strong>Target:</strong> ${escapeHtml(orderData.delivery_target)}</p>
      <p><strong>Payment:</strong> ${escapeHtml(payment.label)}</p>
      ${
        orderData.paid_at
          ? `<p><strong>Paid At:</strong> ${escapeHtml(new Date(orderData.paid_at).toLocaleString())}</p>`
          : `<p>${escapeHtml(payment.copy)}</p>`
      }
      <p><strong>Customer:</strong> ${escapeHtml(orderData.customer_name)} (${escapeHtml(orderData.customer_email)})</p>
    </section>
  `;

  items.innerHTML = `
    <section class="form-card">
      <h2>Items</h2>
      <ul class="summary-list">
        ${(orderData.items || [])
          .map((item) => `<li>${escapeHtml(item.item_name)} x${item.quantity}<span>${escapeHtml(item.price_text)}</span></li>`)
          .join("")}
      </ul>
    </section>
  `;

  actions.innerHTML = `
    <section class="form-card">
      <button class="inline-btn" id="refreshStatusBtn">Refresh Status</button>
      <button class="inline-btn ghost" id="backToMenuBtn">Back To Menu</button>
    </section>
  `;

  bindOrderStatusActionButtons({ venueSlug, orderData, role, apiBase });
}

function renderRunnerOrdersDom(container, { activeOrder, orders }) {
  if (activeOrder) {
    container.innerHTML = `
      <article class="form-card">
        <h2>Active Order #${activeOrder.order_id} · ${escapeHtml(activeOrder.status)}</h2>
        <p><strong>Customer:</strong> ${escapeHtml(activeOrder.customer_name)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(activeOrder.delivery_mode)} · <strong>ETA:</strong> ${escapeHtml(activeOrder.eta_text)}</p>
        <p><strong>Target:</strong> ${escapeHtml(activeOrder.delivery_target)}</p>
        <p class="api-note">Runner is locked to this order until it reaches a terminal state.</p>
        ${runnerActionButtons(activeOrder)}
      </article>
    `;
    return;
  }

  if (!orders || orders.length === 0) {
    container.innerHTML = `<section class="form-card"><p>No runner-ready orders available.</p></section>`;
    return;
  }

  container.innerHTML = orders
    .map(
      (order) => `
      <article class="form-card">
        <h2>Order #${order.order_id} · ${escapeHtml(order.status)}</h2>
        <p><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(order.delivery_mode)} · <strong>ETA:</strong> ${escapeHtml(order.eta_text)}</p>
        <p><strong>Target:</strong> ${escapeHtml(order.delivery_target)}</p>
        ${runnerActionButtons(order)}
      </article>
    `
    )
    .join("");
}

function bindRunnerStatusButtons(container, { venueSlug, apiBase, authHeader }) {
  const statusButtons = container.querySelectorAll(".status-btn");
  statusButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-order-id");
      const status = btn.getAttribute("data-status");
      if (!orderId || !status) return;
      btn.disabled = true;
      try {
        await postOrderStatus(apiBase, orderId, status, authHeader);
        renderRunnerDashboard(venueSlug, apiBase, authHeader);
      } catch (error) {
        alert(`Could not update status: ${error.message}`);
        btn.disabled = false;
      }
    });
  });
}

function renderVenueOrdersDom(container, orders, venueSlug) {
  if (!orders || orders.length === 0) {
    container.innerHTML = `<section class="form-card"><p>No orders yet for ${escapeHtml(venueSlug)}.</p></section>`;
    return;
  }

  container.innerHTML = orders
    .map(
      (order) => `
      <article class="form-card">
        <h2>Order #${order.order_id} · ${escapeHtml(order.status)}</h2>
        <p><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(order.delivery_mode)} · <strong>ETA:</strong> ${escapeHtml(order.eta_text)}</p>
        <p><strong>Target:</strong> ${escapeHtml(order.delivery_target)}</p>
        ${
          isClickAndCollectOrder(order)
            ? `
              <p><strong>Pickup Code:</strong> ${escapeHtml(order.pickup_code || "Pending")}</p>
              ${venueCollectButtons(order)}
            `
            : venueStatusButtons(order.order_id, order.status)
        }
      </article>
    `
    )
    .join("");
}

function bindVenueActionButtons(container, { venueSlug, apiBase, authHeader }) {
  const actionButtons = container.querySelectorAll(".venue-action-btn");
  actionButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-order-id");
      const action = btn.getAttribute("data-action");
      if (!orderId || !action) return;
      btn.disabled = true;
      try {
        const endpoint = `${apiBase}/api/orders/${orderId}/${action}`;
        const headers = { Authorization: authHeader };
        const options = { method: "POST", headers };
        if (action === "collect") {
          const expectedCode = btn.getAttribute("data-pickup-code") || "";
          const enteredCode = window.prompt("Enter the customer pickup code to complete collection.", expectedCode);
          if (!enteredCode || !enteredCode.trim()) {
            btn.disabled = false;
            return;
          }
          headers["Content-Type"] = "application/json";
          options.body = JSON.stringify({ pickup_code: enteredCode.trim() });
        }
        const update = await fetch(endpoint, options);
        if (!update.ok) {
          throw new Error(`Action failed (${update.status})`);
        }
        await renderVenueDashboard(venueSlug, apiBase, authHeader);
      } catch (error) {
        alert(`Could not perform venue action: ${error.message}`);
        btn.disabled = false;
      }
    });
  });
}

function itemCount(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function parsePriceToPennies(priceText) {
  const clean = String(priceText).replace(/[^\d.]/g, "");
  const asNumber = Number(clean || "0");
  return Math.round(asNumber * 100);
}

function formatPennies(pennies) {
  return `PS${(pennies / 100).toFixed(2)}`;
}

function totalPennies(items) {
  return items.reduce((sum, item) => sum + item.price_pennies * item.quantity, 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setRoute(path) {
  window.location.hash = path;
}

function renderUnknown(slug) {
  app.innerHTML = `
    <section class="unknown">
      Unknown venue slug: <strong>${escapeHtml(slug)}</strong><br />
      Try: <code>?venue=brentford-fc</code>
    </section>
  `;
}

function renderForbidden(role, routeName, venueSlug, apiBase) {
  app.innerHTML = `
    <section class="unknown">
      Access denied for role <strong>${escapeHtml(role)}</strong> to route <code>${escapeHtml(routeName)}</code>.<br />
      Use a role URL such as <code>?role=runner</code> or <code>?role=venue</code> for staff access.
      <br /><br />
      <strong>DEV ONLY:</strong> default PIN for local testing is <code>8888</code>. Remove before production.
      <br /><br />
      <button class="inline-btn" id="staffLoginBtn">Staff Login</button>
      <button class="inline-btn ghost" id="staffLogoutBtn">Logout</button>
      <button class="inline-btn" id="forbiddenBackBtn">Back To Menu</button>
    </section>
  `;
  document.getElementById("staffLoginBtn")?.addEventListener("click", async () => {
    try {
      const ok = await loginStaff(apiBase, venueSlug, role);
      if (ok) {
        render();
      }
    } catch (error) {
      alert(`Staff login failed: ${error.message}`);
    }
  });
  document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
    clearStaffSession();
    render();
  });
  document.getElementById("forbiddenBackBtn")?.addEventListener("click", () => setRoute("/"));
}

function modeLine(modeName, venue) {
  const mode = venue.fulfillmentModes.find((m) => m.label === modeName);
  if (!mode) return "";
  return `${mode.label}: <b>${mode.eta}</b>, ${mode.fee}`;
}

function renderVenueHero(venue, options = {}) {
  const {
    compact = false,
    contextChip = venue.tag,
    title = compact ? venue.name : venue.branding?.heroTitle || venue.name,
    copy = compact ? venue.branding?.staffCopy || venue.subtitle : venue.branding?.heroCopy || venue.subtitle,
    toolbarButtons = []
  } = options;
  const branding = venue.branding || {};
  const heroClass = compact ? "hero venue-hero venue-hero-compact" : "hero venue-hero";
  const mark = branding.mark || venue.name.slice(0, 3).toUpperCase();
  const logo = branding.logo || "";
  const accent = branding.accent || "#355c3f";
  const accentSoft = branding.accentSoft || "#dce9d8";
  const glow = branding.glow || "rgba(53, 92, 63, 0.12)";

  return `
    <section
      class="${heroClass}"
      style="--venue-accent:${escapeHtml(accent)};--venue-accent-soft:${escapeHtml(accentSoft)};--venue-glow:${escapeHtml(glow)};"
    >
      <div class="venue-hero-media" aria-hidden="true"></div>
      ${
        logo
          ? `
            <div class="drinq-wordmark">
              <img class="venue-hero-logo" src="${escapeHtml(logo)}" alt="Drinq" />
            </div>
          `
          : ""
      }
      <div class="venue-hero-toolbar">
        <div class="venue-hero-toolbar-heading">
          <h1 class="venue-hero-toolbar-title">${escapeHtml(venue.name)}</h1>
          <span class="venue-hero-toolbar-verified" aria-label="${escapeHtml(contextChip)}">
            <span class="venue-hero-toolbar-tick" aria-hidden="true">✓</span>
            <span>${escapeHtml(contextChip)}</span>
          </span>
        </div>
        ${
          toolbarButtons.length > 0
            ? `
              <div class="venue-hero-toolbar-nav" role="navigation" aria-label="Venue sections">
                ${toolbarButtons
                  .map((button) => {
                    const disabled = button.disabled ? "disabled" : "";
                    return `<button class="venue-hero-nav-btn${button.active ? " is-active" : ""}" data-hero-nav="${escapeHtml(
                      button.action
                    )}" data-hero-target="${escapeHtml(button.target || "")}" ${disabled}>${escapeHtml(button.label)}</button>`;
                  })
                  .join("")}
              </div>
            `
            : `<p class="venue-hero-toolbar-copy">${escapeHtml(copy || title)}</p>`
        }
      </div>
      <div class="venue-hero-badge">${escapeHtml(mark)}</div>
    </section>
  `;
}

function bindHeroToolbarButtons() {
  const buttons = document.querySelectorAll("[data-hero-nav]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.hasAttribute("disabled")) return;
      const action = button.getAttribute("data-hero-nav");
      const target = button.getAttribute("data-hero-target") || "";
      if (action === "route" && target) {
        setRoute(target);
        return;
      }
      if (action === "scroll" && target) {
        document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function addItemToCart(venueSlug, menuItem) {
  const cart = readCart(venueSlug);
  const existing = cart.find((x) => x.item_id === menuItem.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      item_id: menuItem.id,
      item_name: menuItem.name,
      price_text: menuItem.price,
      price_pennies: parsePriceToPennies(menuItem.price),
      quantity: 1
    });
  }
  writeCart(venueSlug, cart);
}

async function renderVenueMenu(venueSlug, venue, role, apiBase) {
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer;
  const activeOrder = role === "customer" ? await resolveActiveCustomerOrder(apiBase, venueSlug) : null;
  const hasLockedOrder = Boolean(activeOrder?.order_id);
  const toolbarButtons = [
    { label: "Menu", action: "route", target: "/", active: true },
    { label: "Deals", action: "scroll", target: "#modesSection" },
    {
      label: "Tracker",
      action: activeOrder?.order_id ? "route" : "scroll",
      target: activeOrder?.order_id ? `/order-status/${activeOrder.order_id}` : "#cartSection"
    }
  ];
  const runnerAuth = getAuthHeader(venueSlug, "runner");
  const venueAuth = getAuthHeader(venueSlug, "venue");
  const canRunner = permissions.runner && Boolean(runnerAuth);
  const canVenue = permissions.venue && Boolean(venueAuth);
  const cart = readCart(venueSlug);
  const reorderRound = readReorderRound(venueSlug);
  const count = itemCount(cart);
  const total = formatPennies(totalPennies(cart));
  const preferredDeliveryMode =
    readPreferredDeliveryMode(venueSlug) || venue.fulfillmentModes[0]?.label || "";

  app.innerHTML = `
    ${renderVenueHero(venue, { toolbarButtons })}
    ${
      hasLockedOrder
        ? `
      <div class="active-order-banner">
        <strong>Active order in progress</strong><br />
        You can browse the menu, but ordering is locked until Order #${escapeHtml(activeOrder.order_id)} is complete.
        <br /><br />
        <button class="inline-btn" id="resumeActiveOrderBtn">Resume Active Order</button>
      </div>
    `
        : ""
    }
    <div class="modes" id="modesSection">
      ${venue.fulfillmentModes
        .map(
          (m) => `
        <article class="mode${preferredDeliveryMode === m.label ? " mode-selected" : ""}" data-delivery-mode="${escapeHtml(m.label)}">
          <h4>${m.label} - ${m.fee}</h4>
          <p><b>${m.eta}</b><br />${m.detail}</p>
        </article>`
        )
        .join("")}
    </div>
    <section class="menu-grid">
      ${venue.menuItems
        .map(
          (item) => `
        <article class="item" data-item-id="${item.id}">
          <h3>${item.name}</h3>
          <div class="item-meta">
            <span>${item.category}</span>
            <span class="price">${item.price}</span>
          </div>
	          <ul class="option-list">
	            ${item.options.map((opt) => `<li>${modeLine(opt, venue)}</li>`).join("")}
	          </ul>
	          <button class="add-btn" data-add-id="${item.id}" ${hasLockedOrder ? "disabled" : ""}>
              ${hasLockedOrder ? "Ordering Locked" : "Add To Cart"}
            </button>
	        </article>`
	        )
	        .join("")}
    </section>

    <section class="cart-mini" id="cartSection">
      Cart: <strong>${count} item${count === 1 ? "" : "s"}</strong> · ${total}
      ${
        reorderRound.length > 0
          ? `<button class="inline-btn ghost" id="reorderRoundBtn">Reorder Round</button>`
          : ""
      }
      <button class="inline-btn" id="goCheckoutBtn" ${count === 0 || hasLockedOrder ? "disabled" : ""}>
        ${hasLockedOrder ? "Order In Progress" : "Go To Checkout"}
      </button>
      ${canVenue ? `<button class="inline-btn ghost" id="goVenueBtn">Venue Ops</button>` : ""}
      ${canRunner ? `<button class="inline-btn ghost" id="goRunnerBtn">Runner Dashboard</button>` : ""}
      ${permissions.runner || permissions.venue ? `<button class="inline-btn ghost" id="staffLoginBtn">Staff Login</button>` : ""}
      ${permissions.runner || permissions.venue ? `<button class="inline-btn ghost" id="staffLogoutBtn">Logout</button>` : ""}
      <button class="inline-btn ghost" id="clearCartBtn" ${count === 0 || hasLockedOrder ? "disabled" : ""}>Clear</button>
    </section>
  `;
  bindHeroToolbarButtons();

  const modeCards = document.querySelectorAll("[data-delivery-mode]");
  modeCards.forEach((card) => {
    card.addEventListener("click", () => {
      const selectedMode = card.getAttribute("data-delivery-mode");
      if (!selectedMode) return;
      writePreferredDeliveryMode(venueSlug, selectedMode);
      renderVenueMenu(venueSlug, venue, role, apiBase);
    });
  });

  const addButtons = document.querySelectorAll("[data-add-id]");
  addButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (hasLockedOrder) return;
      const itemId = btn.getAttribute("data-add-id");
      const menuItem = venue.menuItems.find((x) => x.id === itemId);
      if (!menuItem) return;
      addItemToCart(venueSlug, menuItem);
      renderVenueMenu(venueSlug, venue, role, apiBase);
    });
  });

  const goCheckoutBtn = document.getElementById("goCheckoutBtn");
  if (goCheckoutBtn) {
    goCheckoutBtn.addEventListener("click", () => {
        if (hasLockedOrder) {
          setRoute(`/order-status/${activeOrder.order_id}`);
          return;
        }
        setRoute("/checkout");
      });
  }

  document.getElementById("resumeActiveOrderBtn")?.addEventListener("click", () => {
    if (!activeOrder?.order_id) return;
    setRoute(`/order-status/${activeOrder.order_id}`);
  });

  const clearCartBtn = document.getElementById("clearCartBtn");
  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      if (hasLockedOrder) return;
      clearCart(venueSlug);
      renderVenueMenu(venueSlug, venue, role, apiBase);
    });
  }

  document.getElementById("reorderRoundBtn")?.addEventListener("click", () => {
    if (hasLockedOrder) return;
    writeCart(venueSlug, reorderRound);
    clearReorderRound(venueSlug);
    renderVenueMenu(venueSlug, venue, role, apiBase);
  });

  if (canRunner) {
    document.getElementById("goRunnerBtn")?.addEventListener("click", () => setRoute("/runner"));
  }
  if (canVenue) {
    document.getElementById("goVenueBtn")?.addEventListener("click", () => setRoute("/venue"));
  }
  document.getElementById("staffLoginBtn")?.addEventListener("click", async () => {
    try {
      const desiredRole = role === "admin" ? "admin" : permissions.venue ? "venue" : "runner";
      const ok = await loginStaff(apiBase, venueSlug, desiredRole);
      if (ok) render();
    } catch (error) {
      alert(`Staff login failed: ${error.message}`);
    }
  });
  document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
    clearStaffSession();
    render();
  });
}

async function renderCheckout(venueSlug, venue, apiBase) {
  const cart = readCart(venueSlug);
  const savedProfile = await hydrateCustomerProfile(apiBase, venueSlug);
  if (cart.length === 0) {
    app.innerHTML = `
      <section class="hero">
        <h1 class="venue-title">Checkout</h1>
        <p class="venue-copy">Your cart is empty.</p>
        <button class="inline-btn" id="backToMenuBtn">Back To Menu</button>
      </section>
    `;
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => setRoute("/"));
    return;
  }

  const total = formatPennies(totalPennies(cart));
  const hasRememberedProfile = Boolean(savedProfile?.token);
  const defaultCheckoutType = hasRememberedProfile ? "remembered" : "guest";
  const menuSelectedDeliveryMode = readPreferredDeliveryMode(venueSlug);
  const preferredDeliveryMode =
    menuSelectedDeliveryMode || savedProfile?.deliveryMode || venue.fulfillmentModes[0]?.label || "";
  const defaultDeliveryTarget =
    (menuSelectedDeliveryMode && menuSelectedDeliveryMode !== savedProfile?.deliveryMode
      ? ""
      : savedProfile?.deliveryTarget) ||
    (preferredDeliveryMode === "Click & Collect"
      ? "Collection lane"
      : preferredDeliveryMode === "Nearest Point"
        ? "Nearest pickup point"
        : "");

  app.innerHTML = `
    <section class="hero">
      <span class="brand-chip">CHECKOUT</span>
      <h1 class="venue-title">${venue.name}</h1>
      <p class="venue-copy">Confirm delivery details and place your order.</p>
    </section>

    <section class="form-card">
      <h2>Order Summary</h2>
      <ul class="summary-list">
        ${cart
          .map(
            (item) =>
              `<li>${escapeHtml(item.item_name)} x${item.quantity}<span>${formatPennies(item.price_pennies * item.quantity)}</span></li>`
          )
          .join("")}
      </ul>
      <p class="summary-total">Total: <strong>${total}</strong></p>
    </section>

    <section class="form-card">
      <h2>Contact + Delivery</h2>
      <p class="api-note">
        ${
          hasRememberedProfile
            ? "Recognized customer profile loaded for faster checkout on this device."
            : "First order? Choose guest checkout or let Drinq remember your details for faster future orders."
        }
      </p>
      <form id="checkoutForm">
        <input type="hidden" name="checkoutType" value="${defaultCheckoutType}" />
        ${
          hasRememberedProfile
            ? `
          <div class="choice-note">
            <strong>Remembered customer</strong><br />
            Future orders on this device can prefill your delivery details automatically.
          </div>
        `
            : `
          <div class="checkout-choice-grid" id="checkoutChoiceGrid">
            <button class="choice-btn choice-btn-selected" type="button" data-checkout-type="guest">
              <strong>Checkout As Guest</strong><br />
              Place this order without saving a customer profile.
            </button>
            <button class="choice-btn" type="button" data-checkout-type="remembered">
              <strong>Faster Future Orders</strong><br />
              Save contact and delivery details silently for next time.
            </button>
          </div>
        `
        }
        <label>Name</label>
        <input name="name" required placeholder="Your name" value="${escapeHtml(savedProfile?.name || "")}" />

        <label>Email</label>
        <input name="email" required type="email" placeholder="name@email.com" value="${escapeHtml(savedProfile?.email || "")}" />

        <label>Delivery Mode</label>
        <select name="deliveryMode" required>
          ${venue.fulfillmentModes
            .map((m) => {
              const selected = preferredDeliveryMode === m.label ? "selected" : "";
              return `<option value="${m.label}" ${selected}>${m.label} (${m.eta}, ${m.fee})</option>`;
            })
            .join("")}
        </select>

        <label>Seat / Pickup Point</label>
        <input name="deliveryTarget" required placeholder="E.g. Block N220, Row 6, Seat 121" value="${escapeHtml(defaultDeliveryTarget)}" />

        <label class="checkbox">
          <input type="checkbox" name="mailingList" checked />
          Add me to venue updates (mailing list)
        </label>

        <button class="add-btn" type="submit">Pay & Place Order</button>
        <button class="inline-btn ghost" type="button" id="backMenuBtn">Back To Menu</button>
        <button class="inline-btn ghost" type="button" id="forgetDetailsBtn">Forget Saved Details</button>
      </form>
      <p class="api-note">API: ${escapeHtml(apiBase)}</p>
      <p id="checkoutMsg" class="status-msg"></p>
    </section>
  `;

  document.getElementById("backMenuBtn")?.addEventListener("click", () => setRoute("/"));
  document.getElementById("forgetDetailsBtn")?.addEventListener("click", () => {
    clearCustomerProfile(venueSlug);
    renderCheckout(venueSlug, venue, apiBase);
  });

  const checkoutTypeInput = document.querySelector('input[name="checkoutType"]');
  const choiceButtons = document.querySelectorAll("[data-checkout-type]");
  choiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const checkoutType = button.getAttribute("data-checkout-type");
      if (!checkoutTypeInput || !checkoutType) return;
      checkoutTypeInput.value = checkoutType;
      choiceButtons.forEach((other) => other.classList.remove("choice-btn-selected"));
      button.classList.add("choice-btn-selected");
    });
  });

  const form = document.getElementById("checkoutForm");
  const message = document.getElementById("checkoutMsg");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Submitting...";
    message.className = "status-msg";

    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const deliveryMode = String(formData.get("deliveryMode") || "").trim();
    const deliveryTarget = String(formData.get("deliveryTarget") || "").trim();
    const checkoutType = String(formData.get("checkoutType") || defaultCheckoutType).trim();
    const mailingList = Boolean(formData.get("mailingList"));

    try {
      if (checkoutType === "guest") {
        clearCustomerProfile(venueSlug);
      }

      if (mailingList) {
        try {
          const registerRes = await fetch(`${apiBase}/api/register`, {
            method: "POST",
            body: JSON.stringify({
              name,
              email,
              venue_slug: venueSlug
            })
          });
          void registerRes;
        } catch {}
      }

      const orderRes = await fetch(`${apiBase}/api/orders`, {
        method: "POST",
        body: JSON.stringify({
          venue_slug: venueSlug,
          customer_name: name,
          customer_email: email,
          delivery_mode: deliveryMode,
          delivery_target: deliveryTarget,
          items: cart.map((item) => ({
            item_id: item.item_id,
            item_name: item.item_name,
            price_text: item.price_text,
            quantity: item.quantity
          })),
          checkout_type: checkoutType,
          customer_token: savedProfile?.token || null
        })
      });

      if (!orderRes.ok) {
        throw new Error(`Order failed (${orderRes.status})`);
      }

      const orderData = await orderRes.json();
      if (checkoutType === "remembered" && orderData.customer_profile) {
        writeCustomerProfile(venueSlug, {
          customerId: Number(orderData.customer_profile.customer_id || 0) || null,
          token: String(orderData.customer_profile.customer_token || ""),
          name,
          email,
          deliveryMode,
          deliveryTarget,
          checkoutType
        });
      }
      writeActiveOrderId(venueSlug, orderData.order_id);
      clearCart(venueSlug);
      setRoute(`/order-status/${orderData.order_id}`);
    } catch (error) {
      message.textContent =
        error instanceof TypeError
          ? `Error: Could not reach the API at ${apiBase}. Check that the API server is running and reachable from this device.`
          : `Error: ${error.message}`;
      message.className = "status-msg error";
    }
  });
}

async function renderOrderStatus(venueSlug, orderId, apiBase, role) {
  stopPagePoll();
  app.innerHTML = `
    <section class="hero">
      <span class="brand-chip" id="orderStatusChip">ORDER STATUS</span>
      <h1 class="venue-title" id="orderStatusTitle">Order #${orderId}</h1>
      <p class="venue-copy" id="orderStatusHeroCopy">Fetching latest status...</p>
    </section>
    <section id="orderStatusSummary"></section>
    <section id="orderCompletion"></section>
    <section id="orderDelivery"></section>
    <section id="orderItems"></section>
    <section id="orderActions"></section>
  `;

  try {
    const data = await fetchOrderStatus(apiBase, orderId);
    updateOrderStatusDom({ venueSlug, orderData: data, role, apiBase });
    if (isActiveCustomerOrderStatus(data.status)) {
      startPagePoll(async () => {
        const latest = await fetchOrderStatus(apiBase, orderId);
        if (String(latest.version || "") !== String(data.version || "") || latest.status !== data.status) {
          updateOrderStatusDom({ venueSlug, orderData: latest, role, apiBase });
          data.version = latest.version;
          data.status = latest.status;
          data.eta_text = latest.eta_text;
          data.items = latest.items;
          data.delivery_mode = latest.delivery_mode;
          data.delivery_target = latest.delivery_target;
          data.customer_name = latest.customer_name;
          data.customer_email = latest.customer_email;
        }
      });
    }
  } catch (error) {
    app.innerHTML = `
      <section class="unknown">
        Could not load order #${orderId}. ${escapeHtml(error.message)}<br />
        <button class="inline-btn" id="backToMenuBtn">Back To Menu</button>
      </section>
    `;
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => setRoute("/"));
  }
}

function runnerActionButtons(order) {
  const status = String(order.status || "").toLowerCase();
  const nextActionByStatus = {
    ready: { status: "assigned", label: "Assign" },
    assigned: { status: "loaded", label: "Loaded" },
    loaded: { status: "en_route", label: "En Route" },
    en_route: { status: "arrived", label: "Arrived" },
    arrived: { status: "fulfilled", label: "Fulfilled" }
  };
  const nextAction = nextActionByStatus[status];

  if (!nextAction) {
    return `<div class="runner-actions"><span class="api-note">No runner action available for ${escapeHtml(status)}.</span></div>`;
  }

  const showCancel = ["assigned", "loaded", "en_route", "arrived"].includes(status);
  return `
    <div class="runner-actions">
      <button class="inline-btn status-btn" data-order-id="${order.order_id}" data-status="${nextAction.status}">${nextAction.label}</button>
      ${showCancel ? `<button class="inline-btn ghost status-btn" data-order-id="${order.order_id}" data-status="cancelled">Cancel</button>` : ""}
    </div>
  `;
}

function venueStatusButtons(orderId, status) {
  const normalizedStatus = String(status || "").toLowerCase();
  const canAccept = normalizedStatus === "received";
  const canReject = normalizedStatus === "received";
  const canReady = normalizedStatus === "accepted";
  return `
    <div class="runner-actions">
      <button class="inline-btn venue-action-btn" data-action="accept" data-order-id="${orderId}" ${canAccept ? "" : "disabled"}>Accept</button>
      <button class="inline-btn ghost venue-action-btn" data-action="reject" data-order-id="${orderId}" ${canReject ? "" : "disabled"}>Reject</button>
      <button class="inline-btn venue-action-btn" data-action="ready" data-order-id="${orderId}" ${canReady ? "" : "disabled"}>Mark Ready</button>
    </div>
  `;
}

function venueCollectButtons(order) {
  const status = String(order.status || "").toLowerCase();
  const canAccept = status === "received";
  const canReject = status === "received";
  const canReady = status === "accepted";
  const canCollect = status === "ready_for_collection";
  const canMarkUncollected = status === "ready_for_collection";
  return `
    <div class="runner-actions">
      <button class="inline-btn venue-action-btn" data-action="accept" data-order-id="${order.order_id}" ${canAccept ? "" : "disabled"}>Accept</button>
      <button class="inline-btn ghost venue-action-btn" data-action="reject" data-order-id="${order.order_id}" ${canReject ? "" : "disabled"}>Reject</button>
      <button class="inline-btn venue-action-btn" data-action="ready" data-order-id="${order.order_id}" ${canReady ? "" : "disabled"}>Ready For Collection</button>
      <button class="inline-btn venue-action-btn" data-action="collect" data-order-id="${order.order_id}" data-pickup-code="${escapeHtml(order.pickup_code || "")}" ${canCollect ? "" : "disabled"}>Verify Collected</button>
      <button class="inline-btn ghost venue-action-btn" data-action="uncollected" data-order-id="${order.order_id}" ${canMarkUncollected ? "" : "disabled"}>Mark Uncollected</button>
    </div>
  `;
}

async function postOrderStatus(apiBase, orderId, status, authHeader) {
  const update = await fetch(`${apiBase}/api/order-status/${orderId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ status })
  });
  if (!update.ok) {
    throw new Error(`Update failed (${update.status})`);
  }
}

async function renderRunnerDashboard(venueSlug, apiBase, authHeader) {
  stopPagePoll();
  const venue = VENUES[venueSlug];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      compact: true,
      contextChip: "RUNNER DASHBOARD",
      title: "Live Orders",
      copy: `Venue: ${venue.name} · API: ${apiBase}`
    })}
    <section class="hero-tools">
      <button class="inline-btn" id="runnerRefreshBtn">Refresh</button>
      <button class="inline-btn ghost" id="runnerBackBtn">Back To Menu</button>
    </section>
    <section id="runnerOrders"></section>
  `;

  document.getElementById("runnerRefreshBtn")?.addEventListener("click", () => {
    renderRunnerDashboard(venueSlug, apiBase, authHeader);
  });
  document.getElementById("runnerBackBtn")?.addEventListener("click", () => setRoute("/"));

  const container = document.getElementById("runnerOrders");
  container.innerHTML = `<section class="form-card"><p>Loading orders...</p></section>`;

  try {
    const loadRunnerDashboardState = async () => {
      const activeOrder = await fetchRunnerActiveOrder(apiBase, venueSlug, authHeader);
      if (activeOrder) {
        return { activeOrder, orders: [] };
      }

      const res = await fetch(`${apiBase}/api/orders?venue_slug=${encodeURIComponent(venueSlug)}&limit=50`, {
        headers: { Authorization: authHeader },
        cache: "no-store"
      });
      if (!res.ok) {
        throw new Error(`Could not fetch orders (${res.status})`);
      }
      const data = await res.json();
      const orders = (data.orders || []).filter((order) =>
        !isClickAndCollectOrder(order) && ["ready", "assigned"].includes(String(order.status || "").toLowerCase())
      );
      return { activeOrder: null, orders };
    };

    const state = await loadRunnerDashboardState();
    let signature = JSON.stringify({
      activeOrderId: state.activeOrder?.order_id || null,
      activeOrderVersion: state.activeOrder?.version || null,
      orders: state.orders.map((order) => [order.order_id, order.version, order.status, order.assigned_runner_token || ""])
    });
    renderRunnerOrdersDom(container, state);
    bindRunnerStatusButtons(container, { venueSlug, apiBase, authHeader });

    startPagePoll(async () => {
      const nextState = await loadRunnerDashboardState();
      const nextSignature = JSON.stringify({
        activeOrderId: nextState.activeOrder?.order_id || null,
        activeOrderVersion: nextState.activeOrder?.version || null,
        orders: nextState.orders.map((order) => [order.order_id, order.version, order.status, order.assigned_runner_token || ""])
      });
      if (nextSignature !== signature) {
        signature = nextSignature;
        renderRunnerOrdersDom(container, nextState);
        bindRunnerStatusButtons(container, { venueSlug, apiBase, authHeader });
      }
    });
  } catch (error) {
    container.innerHTML = `<section class="unknown">Runner dashboard error: ${escapeHtml(error.message)}</section>`;
  }
}

async function renderVenueDashboard(venueSlug, apiBase, authHeader) {
  stopPagePoll();
  const venue = VENUES[venueSlug];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      compact: true,
      contextChip: "VENUE OPS",
      title: "Order Management",
      copy: `Venue: ${venue.name} · API: ${apiBase}`
    })}
    <section class="hero-tools">
      <button class="inline-btn" id="venueRefreshBtn">Refresh</button>
      <button class="inline-btn ghost" id="venueBackBtn">Back To Menu</button>
    </section>
    <section id="venueOrders"></section>
  `;

  document.getElementById("venueRefreshBtn")?.addEventListener("click", () => {
    renderVenueDashboard(venueSlug, apiBase, authHeader);
  });
  document.getElementById("venueBackBtn")?.addEventListener("click", () => setRoute("/"));

  const container = document.getElementById("venueOrders");
  container.innerHTML = `<section class="form-card"><p>Loading venue orders...</p></section>`;

  try {
    const loadVenueDashboardState = async () => {
      const res = await fetch(`${apiBase}/api/orders?venue_slug=${encodeURIComponent(venueSlug)}&limit=50`, {
        headers: { Authorization: authHeader },
        cache: "no-store"
      });
      if (!res.ok) {
        throw new Error(`Could not fetch orders (${res.status})`);
      }
      const data = await res.json();
      return data.orders || [];
    };

    const orders = await loadVenueDashboardState();
    let signature = JSON.stringify(
      orders.map((order) => [
        order.order_id,
        order.version,
        order.status,
        order.assigned_runner_token || ""
      ])
    );
    renderVenueOrdersDom(container, orders, venueSlug);
    bindVenueActionButtons(container, { venueSlug, apiBase, authHeader });

    startPagePoll(async () => {
      const nextOrders = await loadVenueDashboardState();
      const nextSignature = JSON.stringify(
        nextOrders.map((order) => [
          order.order_id,
          order.version,
          order.status,
          order.assigned_runner_token || ""
        ])
      );
      if (nextSignature !== signature) {
        signature = nextSignature;
        renderVenueOrdersDom(container, nextOrders, venueSlug);
        bindVenueActionButtons(container, { venueSlug, apiBase, authHeader });
      }
    });
  } catch (error) {
    container.innerHTML = `<section class="unknown">Venue dashboard error: ${escapeHtml(error.message)}</section>`;
  }
}

async function render() {
  stopPagePoll();
  const venueSlug = getVenueSlug();
  const apiBase = getApiBase();
  const role = getRole();
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer;
  const route = getRoute();
  const venue = VENUES[venueSlug];

  if (!venue) {
    renderUnknown(venueSlug);
    return;
  }

  if (route.name === "checkout") {
    renderCheckout(venueSlug, venue, apiBase);
    return;
  }
  if (route.name === "order-status") {
    await renderOrderStatus(venueSlug, route.orderId, apiBase, role);
    return;
  }
  if (route.name === "runner") {
    if (!permissions.runner) {
      renderForbidden(role, "runner", venueSlug, apiBase);
      return;
    }
    let authHeader = getAuthHeader(venueSlug, "runner");
    if (!authHeader) {
      try {
        const ok = await loginStaff(apiBase, venueSlug, role === "admin" ? "admin" : "runner");
        if (!ok) {
          renderForbidden(role, "runner", venueSlug, apiBase);
          return;
        }
      } catch (error) {
        alert(`Staff login failed: ${error.message}`);
        renderForbidden(role, "runner", venueSlug, apiBase);
        return;
      }
      authHeader = getAuthHeader(venueSlug, "runner");
    }
    await renderRunnerDashboard(venueSlug, apiBase, authHeader);
    return;
  }
  if (route.name === "venue") {
    if (!permissions.venue) {
      renderForbidden(role, "venue", venueSlug, apiBase);
      return;
    }
    let authHeader = getAuthHeader(venueSlug, "venue");
    if (!authHeader) {
      try {
        const ok = await loginStaff(apiBase, venueSlug, role === "admin" ? "admin" : "venue");
        if (!ok) {
          renderForbidden(role, "venue", venueSlug, apiBase);
          return;
        }
      } catch (error) {
        alert(`Staff login failed: ${error.message}`);
        renderForbidden(role, "venue", venueSlug, apiBase);
        return;
      }
      authHeader = getAuthHeader(venueSlug, "venue");
    }
    await renderVenueDashboard(venueSlug, apiBase, authHeader);
    return;
  }

  await renderVenueMenu(venueSlug, venue, role, apiBase);
}

window.addEventListener("hashchange", () => {
  render();
});

render();
