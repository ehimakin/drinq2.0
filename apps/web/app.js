import { VENUES } from "./data/venues.js?v=20260314c";

const app = document.getElementById("app");
const STAFF_SESSION_KEY = "drinq_staff_session";
const REORDER_ROUND_KEY_PREFIX = "drinq_reorder_round_";
const CUSTOMER_PROFILE_KEY_PREFIX = "drinq_customer_profile_";
const ACTIVE_ORDER_KEY_PREFIX = "drinq_active_order_";
const DELIVERY_MODE_PREF_KEY_PREFIX = "drinq_delivery_mode_";
const PENDING_TIP_KEY_PREFIX = "drinq_pending_tip_";
const MENU_CATEGORY_FILTER_KEY_PREFIX = "drinq_menu_category_filter_";
const VENDOR_DISPLAY_NAME_KEY_PREFIX = "drinq_vendor_display_name_";
const PAGE_POLL_INTERVAL_MS = 5000;
const TIP_OPTIONS_PENNIES = [100, 200, 300, 500];
// DEV ONLY: local staff PIN flow is enabled for prototype testing.
// Replace with proper auth before production.

const ROLE_PERMISSIONS = {
  customer: { runner: false, venue: false, vendor: false },
  runner: { runner: true, venue: false, vendor: false },
  vendor: { runner: false, venue: false, vendor: true },
  venue: { runner: false, venue: true, vendor: false },
  admin: { runner: true, venue: true, vendor: true }
};
const VENDOR_ROLE_BINDINGS = {
  "brentford-fc": "50pints"
};
let pagePollHandle = null;
let pagePollInFlight = false;
const BUG_ALERT_MODAL_ID = "bugAlertModal";
const BUG_ALERT_DEDUPE_WINDOW_MS = 4000;
let lastBugAlertFingerprint = "";
let lastBugAlertAt = 0;

function isRunnerPortalPath() {
  const pathname = window.location.pathname || "/";
  return /^\/runner\/?$/.test(pathname);
}

function isVendorPortalPath() {
  const pathname = window.location.pathname || "/";
  return /^\/vendor\/?$/.test(pathname);
}

function buildAppEntryUrl(pathname, params = {}) {
  const url = new URL(window.location.href);
  url.pathname = pathname;
  url.hash = "";
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function getVenueSlug() {
  const searchParams = new URLSearchParams(window.location.search);
  const querySlug = searchParams.get("venue");
  if (querySlug) return querySlug;

  const staffSession = getStaffSession();
  if (isVendorPortalPath() && staffSession?.role === "vendor" && staffSession?.venue_slug) {
    return String(staffSession.venue_slug);
  }
  if ((isRunnerPortalPath() || searchParams.get("role") === "runner") && staffSession?.role === "runner" && staffSession?.venue_slug) {
    return String(staffSession.venue_slug);
  }

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
  if (isRunnerPortalPath()) return "runner";
  if (isVendorPortalPath()) return "vendor";
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
  if (hash === "#/runner-stream") return { name: "runner-stream" };
  if (hash === "#/runner") return { name: "runner" };
  if (hash === "#/stream") return { name: "stream" };
  if (hash === "#/vendor") return { name: "vendor" };
  if (hash === "#/venue") return { name: "venue" };

  return { name: "menu" };
}

function getStaffSession() {
  try {
    const raw = sessionStorage.getItem(STAFF_SESSION_KEY) || localStorage.getItem(STAFF_SESSION_KEY);
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
  sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem(STAFF_SESSION_KEY);
  if (session?.role === "vendor" && session?.venue_slug && session?.vendor_name) {
    localStorage.setItem(`${VENDOR_DISPLAY_NAME_KEY_PREFIX}${session.venue_slug}`, String(session.vendor_name));
  }
}

function clearStaffSession() {
  sessionStorage.removeItem(STAFF_SESSION_KEY);
  localStorage.removeItem(STAFF_SESSION_KEY);
}

function handleStaffLogout() {
  clearStaffSession();
  if (getRoute().name === "menu") {
    requestRender("logout");
    return;
  }
  setRoute("/");
}

function makeHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isStaffSessionError(error) {
  return Boolean(error && typeof error === "object" && (error.status === 401 || error.status === 403));
}

function getVendorSlugForRole(venueSlug, role) {
  if (role !== "vendor") return "";
  const session = getStaffSession();
  if (session?.venue_slug === venueSlug && session?.vendor_slug) {
    return String(session.vendor_slug);
  }
  return "";
}

function getVendorDisplayName(venueSlug) {
  const session = getStaffSession();
  if (session?.venue_slug === venueSlug && session?.vendor_name) {
    return String(session.vendor_name);
  }
  const persistedVendorName = localStorage.getItem(`${VENDOR_DISPLAY_NAME_KEY_PREFIX}${venueSlug}`);
  if (persistedVendorName) {
    return persistedVendorName;
  }
  const configuredVendorSlug = VENDOR_ROLE_BINDINGS[venueSlug];
  if (configuredVendorSlug) {
    return configuredVendorSlug.replaceAll("-", " ");
  }
  return "Vendor";
}

function getAuthHeader(venueSlug, requestedRole) {
  const session = getStaffSession();
  if (!session) return null;
  if (session.venue_slug !== venueSlug) return null;
  if (!(session.role === requestedRole || session.role === "admin")) return null;
  return `Bearer ${session.token}`;
}

function sessionMatchesRole(session, venueSlug, role) {
  if (!session) return false;
  if (session.venue_slug !== venueSlug) return false;
  if (role === "customer") return false;
  return session.role === role || session.role === "admin";
}

function renderStaffSessionButton(venueSlug, role, permissions, variant = "ghost") {
  if (!(permissions.runner || permissions.venue || permissions.vendor)) return "";
  const session = getStaffSession();
  const buttonClass = variant === "solid" ? "inline-btn" : "inline-btn ghost";
  const isLoggedInForRole = sessionMatchesRole(session, venueSlug, role);
  return isLoggedInForRole
    ? `<button class="${buttonClass}" id="staffLogoutBtn">Logout</button>`
    : `<button class="${buttonClass}" id="staffLoginBtn">Staff Login</button>`;
}

async function loginStaff(apiBase, venueSlug, role) {
  const promptTarget = role === "vendor" ? getVendorDisplayName(venueSlug) : `${venueSlug} (${role})`;
  const pin = window.prompt(`Enter staff PIN for ${promptTarget}`);
  if (!pin) return false;
  const vendorSlug = getVendorSlugForRole(venueSlug, role);
  const response = await fetch(`${apiBase}/api/staff/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue_slug: venueSlug,
      pin: pin.trim(),
      role,
      vendor_slug: vendorSlug || null
    })
  });
  if (!response.ok) {
    throw new Error(`Staff auth failed (${response.status})`);
  }
  const data = await response.json();
  setStaffSession(data);
  return true;
}

async function loginRunnerWithAccessCode(apiBase, accessCode) {
  const response = await fetch(`${apiBase}/api/runner/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: String(accessCode || "").trim() })
  });
  if (!response.ok) {
    throw new Error(`Runner access failed (${response.status})`);
  }
  const data = await response.json();
  setStaffSession(data);
  return data;
}

async function loginVendorWithPin(apiBase, venueSlug, pin) {
  const vendorSlug = getVendorSlugForRole(venueSlug, "vendor");
  const response = await fetch(`${apiBase}/api/staff/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue_slug: venueSlug,
      pin: String(pin || "").trim(),
      role: "vendor",
      vendor_slug: vendorSlug || null
    })
  });
  if (!response.ok) {
    throw new Error(`Vendor auth failed (${response.status})`);
  }
  const data = await response.json();
  setStaffSession(data);
  return data;
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

function pendingTipKey(venueSlug) {
  return `${PENDING_TIP_KEY_PREFIX}${venueSlug}`;
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
    const preferredDeliveryMode = String(parsed.preferredDeliveryMode || "");
    const preferredDeliveryTarget = String(parsed.preferredDeliveryTarget || "");
    const lastDeliveryMode = String(parsed.lastDeliveryMode || parsed.deliveryMode || "");
    const lastDeliveryTarget = String(parsed.lastDeliveryTarget || parsed.deliveryTarget || "");
    return {
      customerId: Number(parsed.customerId || 0) || null,
      token: String(parsed.token || ""),
      name: String(parsed.name || ""),
      email: String(parsed.email || ""),
      deliveryMode: String(parsed.deliveryMode || preferredDeliveryMode || lastDeliveryMode),
      deliveryTarget: String(parsed.deliveryTarget || preferredDeliveryTarget || lastDeliveryTarget),
      preferredDeliveryMode,
      preferredDeliveryTarget,
      lastDeliveryMode,
      lastDeliveryTarget,
      checkoutType: String(parsed.checkoutType || "remembered"),
      accountLevel: String(parsed.accountLevel || "profile")
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
  const sessionValue = sessionStorage.getItem(deliveryModePreferenceKey(venueSlug));
  if (sessionValue) return String(sessionValue);
  const savedProfile = readCustomerProfile(venueSlug);
  if (savedProfile?.preferredDeliveryMode) return savedProfile.preferredDeliveryMode;
  if (savedProfile?.lastDeliveryMode) return savedProfile.lastDeliveryMode;
  const legacyValue = localStorage.getItem(deliveryModePreferenceKey(venueSlug));
  if (legacyValue) return String(legacyValue);
  return "";
}

function writePreferredDeliveryMode(venueSlug, deliveryMode) {
  sessionStorage.setItem(deliveryModePreferenceKey(venueSlug), deliveryMode);
  localStorage.removeItem(deliveryModePreferenceKey(venueSlug));
}

function readPendingTipAmount(venueSlug) {
  const raw = sessionStorage.getItem(pendingTipKey(venueSlug));
  const amount = Number(raw || 0);
  return amount > 0 ? amount : 0;
}

function writePendingTipAmount(venueSlug, tipAmountPennies) {
  const normalized = Math.max(0, Number(tipAmountPennies || 0));
  if (normalized === 0) {
    sessionStorage.removeItem(pendingTipKey(venueSlug));
    return;
  }
  sessionStorage.setItem(pendingTipKey(venueSlug), String(normalized));
}

function clearPendingTipAmount(venueSlug) {
  sessionStorage.removeItem(pendingTipKey(venueSlug));
}

function menuCategoryFilterKey(venueSlug) {
  return `${MENU_CATEGORY_FILTER_KEY_PREFIX}${venueSlug}`;
}

function readMenuCategoryFilter(venueSlug) {
  return sessionStorage.getItem(menuCategoryFilterKey(venueSlug)) || "All";
}

function writeMenuCategoryFilter(venueSlug, category) {
  sessionStorage.setItem(menuCategoryFilterKey(venueSlug), String(category || "All"));
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
      preferredDeliveryMode: String(remoteProfile.preferred_delivery_mode || ""),
      preferredDeliveryTarget: String(remoteProfile.preferred_delivery_target || ""),
      lastDeliveryMode: String(remoteProfile.last_delivery_mode || remoteProfile.delivery_mode || ""),
      lastDeliveryTarget: String(remoteProfile.last_delivery_target || remoteProfile.delivery_target || ""),
      checkoutType: "remembered",
      accountLevel: String(remoteProfile.account_level || "profile")
    };
    writeCustomerProfile(venueSlug, mergedProfile);
    return mergedProfile;
  } catch {
    return localProfile;
  }
}

async function lookupCustomerAccount(apiBase, venueSlug, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return null;

  const response = await fetch(
    `${apiBase}/api/customers/lookup?venue_slug=${encodeURIComponent(venueSlug)}&email=${encodeURIComponent(normalizedEmail)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(`Customer lookup failed (${response.status})`);
  }
  return response.json();
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

function shouldOfferTipForOrder(orderData, role) {
  if (role !== "customer") return false;
  if (!orderData || Boolean(orderData.has_tip)) return false;
  const status = String(orderData.status || "").toLowerCase();
  return !["rejected", "cancelled", "failed", "uncollected"].includes(status);
}

function closeTipModal() {
  document.getElementById("tipModal")?.remove();
}

function openTipModal({
  title,
  subtitle,
  initialAmountPennies = 0,
  confirmLabel = "Save Tip",
  allowClear = false,
  onConfirm
}) {
  closeTipModal();
  const initialSelected = TIP_OPTIONS_PENNIES.includes(initialAmountPennies) ? initialAmountPennies : TIP_OPTIONS_PENNIES[1];
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="tip-modal-backdrop" id="tipModal">
        <div class="tip-modal" role="dialog" aria-modal="true" aria-labelledby="tipModalTitle">
          <h2 id="tipModalTitle">${escapeHtml(title)}</h2>
          <p class="tip-modal-copy">${escapeHtml(subtitle)}</p>
          <div class="tip-options" id="tipOptions">
            ${TIP_OPTIONS_PENNIES.map((amount) => `
              <button class="tip-option-btn${amount === initialSelected ? " is-selected" : ""}" type="button" data-tip-option="${amount}">
                ${escapeHtml(formatPennies(amount))}
              </button>
            `).join("")}
          </div>
          <div class="tip-modal-actions">
            ${allowClear ? `<button class="inline-btn ghost" type="button" id="clearTipBtn">No Tip</button>` : ""}
            <button class="inline-btn ghost" type="button" id="cancelTipBtn">Cancel</button>
            <button class="inline-btn" type="button" id="confirmTipBtn">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `
  );
  let selectedAmount = initialSelected;
  document.querySelectorAll("[data-tip-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextAmount = Number(button.getAttribute("data-tip-option") || 0);
      if (!nextAmount) return;
      selectedAmount = nextAmount;
      document.querySelectorAll("[data-tip-option]").forEach((other) => other.classList.remove("is-selected"));
      button.classList.add("is-selected");
    });
  });
  document.getElementById("cancelTipBtn")?.addEventListener("click", closeTipModal);
  document.getElementById("clearTipBtn")?.addEventListener("click", async () => {
    await onConfirm(0);
    closeTipModal();
  });
  document.getElementById("confirmTipBtn")?.addEventListener("click", async () => {
    await onConfirm(selectedAmount);
    closeTipModal();
  });
  document.getElementById("tipModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "tipModal") closeTipModal();
  });
}

async function submitTipForOrder(apiBase, orderId, tipAmountPennies) {
  const response = await fetch(`${apiBase}/api/orders/${orderId}/tip`, {
    method: "POST",
    body: JSON.stringify({ tip_amount_pennies: tipAmountPennies })
  });
  if (!response.ok) {
    throw new Error(`Tip failed (${response.status})`);
  }
  return response.json();
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
  document.querySelectorAll("[data-tip-action='open']").forEach((button) => {
    button.addEventListener("click", () => {
      openTipModal({
        title: "Add Tip",
        subtitle: "Add a tip to this order.",
        confirmLabel: "Add Tip",
        onConfirm: async (tipAmountPennies) => {
          await submitTipForOrder(apiBase, orderData.order_id, tipAmountPennies);
          await renderOrderStatus(venueSlug, orderData.order_id, apiBase, role);
        }
      });
    });
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
  const leadIncident = Array.isArray(orderData.open_incidents) ? orderData.open_incidents[0] : null;
  const canTip = shouldOfferTipForOrder(orderData, role);
  const showCompletionTipButton = canTip && (isFulfilled || isCollected);
  const showActionTipButton = canTip && !showCompletionTipButton;
  const finalTotal = formatPennies(orderItemsTotalPennies(orderData.items) + Number(orderData.tip_amount_pennies || 0));
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
  title.textContent = getOrderTitle(orderData);
  heroCopy.innerHTML = isCustomerView
    ? `${escapeHtml(customerState.copy)}<br /><span class="api-note"><strong>${escapeHtml(payment.label)}</strong> · ${escapeHtml(orderData.eta_text)} · ${escapeHtml(
        getOrderReference(orderData)
      )}</span>`
    : `Status: <strong>${escapeHtml(orderData.status)}</strong> · ETA: ${escapeHtml(orderData.eta_text)} · ${escapeHtml(getOrderReference(orderData))}`;
  statusSummary.innerHTML = `
    <section class="form-card order-status-spotlight">
      <p class="order-status-spotlight-label">${escapeHtml(isCustomerView ? customerState.chip : "ORDER STATUS")}</p>
      <h2>${escapeHtml(isCustomerView ? customerState.copy : `Order is currently ${orderData.status}.`)}</h2>
      <p class="order-status-spotlight-meta">
        <strong>${escapeHtml(payment.label)}</strong>
        <span aria-hidden="true">•</span>
        <span>${escapeHtml(orderData.eta_text)}</span>
        ${
          orderData.has_tip
            ? `<span aria-hidden="true">•</span><span>Tip added ${escapeHtml(formatPennies(orderData.tip_amount_pennies || 0))}</span>`
            : ""
        }
        <span aria-hidden="true">•</span><span>Final total ${escapeHtml(finalTotal)}</span>
      </p>
      ${
        leadIncident
          ? `<p class="api-note"><strong>Attention:</strong> ${escapeHtml(leadIncident.summary || "The venue is reviewing a fulfilment issue.")}</p>`
          : ""
      }
    </section>
  `;

  if (isCustomerView && (isFulfilled || isCollected)) {
    completion.innerHTML = `
      <section class="form-card completion-card">
        <h2>${isCollected ? "Order Collected" : "It's been delivered!"}</h2>
        <p>${isCollected ? "Your click and collect order has been handed over." : "Your order is complete."}</p>
        ${showCompletionTipButton ? `<button class="inline-btn" data-tip-action="open">Tip Order</button>` : ""}
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
      <p><strong>Tip:</strong> ${orderData.has_tip ? escapeHtml(formatPennies(orderData.tip_amount_pennies || 0)) : "Not added"}</p>
      <p><strong>Final Total:</strong> ${escapeHtml(finalTotal)}</p>
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
      ${showActionTipButton ? `<button class="inline-btn" data-tip-action="open">Tip Order</button>` : ""}
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
        <h2>${escapeHtml(getOrderTitle(activeOrder))} · ${escapeHtml(activeOrder.status)}</h2>
        <p class="api-note">${escapeHtml(getOrderReference(activeOrder))}</p>
        <p><strong>Customer:</strong> ${escapeHtml(activeOrder.customer_name)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(activeOrder.delivery_mode)} · <strong>ETA:</strong> ${escapeHtml(activeOrder.eta_text)}</p>
        <p><strong>Target:</strong> ${escapeHtml(activeOrder.delivery_target)}</p>
        ${renderOrderAttention(activeOrder)}
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
        <h2>${escapeHtml(getOrderTitle(order))} · ${escapeHtml(order.status)}</h2>
        <p class="api-note">${escapeHtml(getOrderReference(order))}</p>
        <p><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(order.delivery_mode)} · <strong>ETA:</strong> ${escapeHtml(order.eta_text)}</p>
        <p><strong>Target:</strong> ${escapeHtml(order.delivery_target)}</p>
        ${renderOrderAttention(order)}
        ${runnerActionButtons(order)}
      </article>
    `
    )
    .join("");
}

function bindRunnerStatusButtons(container, { venueSlug, apiBase, authHeader }) {
  const statusButtons = container.querySelectorAll(".status-btn");
  statusButtons.forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const orderId = btn.getAttribute("data-order-id");
      const status = btn.getAttribute("data-status");
      if (!orderId || !status) return;
      btn.disabled = true;
      try {
        await postOrderStatus(apiBase, orderId, status, authHeader);
        renderRunnerStream(venueSlug, apiBase, authHeader);
      } catch (error) {
        alert(`Could not update status: ${error.message}`);
        btn.disabled = false;
      }
    });
  });
}

function renderOrderItemsSummary(items) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    return `<p class="api-note">Items unavailable for this order.</p>`;
  }
  return `
    <div class="order-items-summary">
      <p><strong>Items:</strong></p>
      <ul class="summary-list">
        ${safeItems
          .map(
            (item) =>
              `<li>${escapeHtml(item.item_name || "Unknown item")} x${escapeHtml(String(item.quantity || 0))}<span>${escapeHtml(
                item.price_text || ""
              )}</span></li>`
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderOrderAttention(order) {
  const incidents = Array.isArray(order.open_incidents) ? order.open_incidents : [];
  if (!incidents.length) {
    return "";
  }
  return `
    <section class="form-card">
      <p><strong>Attention Required</strong></p>
      <ul class="summary-list">
        ${incidents
          .map(
            (incident) => `
              <li>
                <span>${escapeHtml(String(incident.summary || "Operational issue"))}</span>
                <span>${escapeHtml(String(incident.severity || "warning").toUpperCase())}</span>
              </li>
            `
          )
          .join("")}
      </ul>
      ${incidents[0]?.detail ? `<p class="api-note">${escapeHtml(incidents[0].detail)}</p>` : ""}
    </section>
  `;
}

function renderVenueOrdersDom(container, orders, venueSlug, isAdmin = false) {
  if (!orders || orders.length === 0) {
    container.innerHTML = `<section class="form-card"><p>No orders yet for ${escapeHtml(venueSlug)}.</p></section>`;
    return;
  }

  container.innerHTML = orders
    .map(
      (order) => `
      <article class="form-card">
        <h2>${escapeHtml(getOrderTitle(order))} · ${escapeHtml(order.status)}</h2>
        <p class="api-note">${escapeHtml(getOrderReference(order))}</p>
        ${renderOrderItemsSummary(order.items)}
        <p><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(order.delivery_mode)} · <strong>ETA:</strong> ${escapeHtml(order.eta_text)}</p>
        <p><strong>Target:</strong> ${escapeHtml(order.delivery_target)}</p>
        <p><strong>Payment:</strong> ${escapeHtml(order.payment_status || "pending")}</p>
        ${order.failure_reason ? `<p><strong>Failure:</strong> ${escapeHtml(order.failure_reason)}</p>` : ""}
        ${order.refund_reason ? `<p><strong>Refund:</strong> ${escapeHtml(order.refund_reason)}</p>` : ""}
        ${renderOrderAttention(order)}
        ${
          isClickAndCollectOrder(order)
            ? `
              <p><strong>Pickup Code:</strong> ${escapeHtml(order.pickup_code || "Pending")}</p>
              ${venueCollectButtons(order, isAdmin)}
            `
            : venueStatusButtons(order, isAdmin)
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
        if (action === "fail" || action === "refund" || action === "attention") {
          const reasonPrompt =
            action === "fail"
              ? "Reason for order failure?"
              : action === "refund"
                ? "Reason for refund?"
                : "What issue should be flagged on this order?";
          const enteredReason = window.prompt(reasonPrompt, "");
          if (action === "attention" && !enteredReason?.trim()) {
            btn.disabled = false;
            return;
          }
          headers["Content-Type"] = "application/json";
          options.body = JSON.stringify({ reason: enteredReason?.trim() || null });
        }
        const update = await fetch(endpoint, options);
        if (!update.ok) {
          throw new Error(`Action failed (${update.status})`);
        }
        await renderVendorStream(venueSlug, apiBase, authHeader);
      } catch (error) {
        alert(`Could not perform venue action: ${error.message}`);
        btn.disabled = false;
      }
    });
  });
}

function renderAdminMenuManager(container, items) {
  container.innerHTML = `
    <section class="form-card">
      <h2>Menu Admin</h2>
      <p class="api-note">Edit item names, prices, availability, and fulfilment modes from the web prototype.</p>
      <button class="inline-btn" id="adminAddMenuItemBtn">Add Menu Item</button>
      <div class="admin-menu-list">
        ${items
          .map(
            (item) => `
            <article class="item admin-menu-item">
              <h3>${escapeHtml(item.item_name)}</h3>
              <div class="item-meta">
                <span>${escapeHtml(item.category)}</span>
                <span class="price">${escapeHtml(item.price_text)}</span>
              </div>
              <p class="api-note">${escapeHtml(item.available_modes.join(", "))}</p>
              <p class="api-note">${item.is_active ? "Active" : "Hidden from customer menu"}</p>
              <div class="runner-actions">
                <button class="inline-btn admin-menu-edit-btn" data-menu-item-id="${escapeHtml(item.item_id)}">Edit</button>
                <button class="inline-btn ghost admin-menu-toggle-btn" data-menu-item-id="${escapeHtml(item.item_id)}" data-next-active="${item.is_active ? "false" : "true"}">
                  ${item.is_active ? "Hide" : "Enable"}
                </button>
                <button class="inline-btn ghost admin-menu-delete-btn" data-menu-item-id="${escapeHtml(item.item_id)}">Delete</button>
              </div>
            </article>
          `
          )
          .join("")}
      </div>
    </section>
  `;
}

function promptForMenuItem(initial = null) {
  const itemId = initial?.item_id || window.prompt("Item id (slug style, e.g. bf-ipa)", "");
  if (!itemId || !itemId.trim()) return null;
  const itemName = window.prompt("Item name", initial?.item_name || "");
  if (!itemName || !itemName.trim()) return null;
  const category = window.prompt("Category", initial?.category || "Beer");
  if (!category || !category.trim()) return null;
  const priceText = window.prompt("Price text", initial?.price_text || "PS0.00");
  if (!priceText || !priceText.trim()) return null;
  const modeValue = window.prompt(
    "Available modes (comma separated)",
    (initial?.available_modes || ["Seat Delivery", "Nearest Point", "Click & Collect"]).join(", ")
  );
  const availableModes = String(modeValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (availableModes.length === 0) return null;
  return {
    item_id: itemId.trim(),
    item_name: itemName.trim(),
    category: category.trim(),
    price_text: priceText.trim(),
    available_modes: availableModes,
    is_active: initial?.is_active ?? true
  };
}

function bindAdminMenuButtons(container, { venueSlug, apiBase, authHeader, getItems, onUpdated }) {
  document.getElementById("adminAddMenuItemBtn")?.addEventListener("click", async () => {
    const nextItem = promptForMenuItem();
    if (!nextItem) return;
    try {
      await saveMenuItem(apiBase, authHeader, venueSlug, nextItem, true);
      await onUpdated();
    } catch (error) {
      alert(`Could not create menu item: ${error.message}`);
    }
  });

  container.querySelectorAll(".admin-menu-edit-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.getAttribute("data-menu-item-id");
      const existing = getItems().find((item) => item.item_id === itemId);
      if (!existing) return;
      const nextItem = promptForMenuItem(existing);
      if (!nextItem) return;
      try {
        await saveMenuItem(apiBase, authHeader, venueSlug, { ...existing, ...nextItem }, false);
        await onUpdated();
      } catch (error) {
        alert(`Could not update menu item: ${error.message}`);
      }
    });
  });

  container.querySelectorAll(".admin-menu-toggle-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.getAttribute("data-menu-item-id");
      const nextActive = button.getAttribute("data-next-active") === "true";
      const existing = getItems().find((item) => item.item_id === itemId);
      if (!existing) return;
      try {
        await saveMenuItem(apiBase, authHeader, venueSlug, { ...existing, is_active: nextActive }, false);
        await onUpdated();
      } catch (error) {
        alert(`Could not update menu availability: ${error.message}`);
      }
    });
  });

  container.querySelectorAll(".admin-menu-delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.getAttribute("data-menu-item-id");
      if (!itemId) return;
      const confirmed = window.confirm(`Delete menu item "${itemId}"? This removes it from the venue menu.`);
      if (!confirmed) return;
      try {
        await deleteMenuItem(apiBase, authHeader, venueSlug, itemId);
        await onUpdated();
      } catch (error) {
        alert(`Could not delete menu item: ${error.message}`);
      }
    });
  });
}

function itemCount(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function getDisplayOrderNumber(order) {
  const raw = Number(order?.display_order_number || order?.order_id || 0);
  return raw > 0 ? String(raw).padStart(3, "0") : "000";
}

function getOrderTitle(order) {
  return `Order ${getDisplayOrderNumber(order)}`;
}

function getOrderReference(order) {
  const parts = [];
  if (order?.business_day) parts.push(order.business_day);
  if (order?.order_id) parts.push(`Ref #${order.order_id}`);
  return parts.join(" · ");
}

function normalizeMenuItem(item) {
  return {
    id: item.id || item.item_id,
    item_id: item.item_id || item.id,
    name: item.name || item.item_name,
    item_name: item.item_name || item.name,
    vendor_name: item.vendor_name || "",
    vendor_slug: item.vendor_slug || "",
    category: item.category,
    price: item.price || item.price_text,
    price_text: item.price_text || item.price,
    options: item.options || item.available_modes || [],
    available_modes: item.available_modes || item.options || [],
    is_active: item.is_active ?? true
  };
}

async function fetchMenuItems(apiBase, venueSlug, { includeInactive = false, authHeader = null } = {}) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  const response = await fetch(
    `${apiBase}/api/menu?venue_slug=${encodeURIComponent(venueSlug)}${includeInactive ? "&include_inactive=true" : ""}`,
    {
      headers,
      cache: "no-store"
    }
  );
  if (!response.ok) {
    throw makeHttpError(`Could not fetch menu (${response.status})`, response.status);
  }
  const data = await response.json();
  return (data.items || []).map(normalizeMenuItem);
}

async function saveMenuItem(apiBase, authHeader, venueSlug, item, isNew = false) {
  const endpoint = isNew ? `${apiBase}/api/menu/items` : `${apiBase}/api/menu/items/${encodeURIComponent(item.item_id)}`;
  const response = await fetch(endpoint, {
    method: isNew ? "POST" : "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      venue_slug: venueSlug,
      item_id: item.item_id,
      item_name: item.item_name,
      category: item.category,
      price_text: item.price_text,
      available_modes: item.available_modes,
      is_active: Boolean(item.is_active)
    })
  });
  if (!response.ok) {
    throw new Error(`Could not save menu item (${response.status})`);
  }
  return normalizeMenuItem(await response.json());
}

async function deleteMenuItem(apiBase, authHeader, venueSlug, itemId) {
  const response = await fetch(
    `${apiBase}/api/menu/items/${encodeURIComponent(itemId)}?venue_slug=${encodeURIComponent(venueSlug)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: authHeader
      }
    }
  );
  if (!response.ok) {
    throw new Error(`Could not delete menu item (${response.status})`);
  }
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

function orderItemsTotalPennies(items) {
  return (items || []).reduce((sum, item) => sum + parsePriceToPennies(item.price_text) * Number(item.quantity || 0), 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeBugError(error) {
  if (error instanceof Error) {
    return {
      message: error.message || "Unexpected error",
      stack: error.stack || "",
      status: Number(error.status || 0) || null
    };
  }
  if (typeof error === "string") {
    return { message: error, stack: "", status: null };
  }
  if (error && typeof error === "object") {
    const message = typeof error.message === "string" && error.message.trim() ? error.message.trim() : "Unexpected error";
    return {
      message,
      stack: typeof error.stack === "string" ? error.stack : "",
      status: Number(error.status || 0) || null
    };
  }
  return { message: "Unexpected error", stack: "", status: null };
}

function shouldOfferDiagnosticReport(error) {
  const normalized = normalizeBugError(error);
  return !normalized.status || normalized.status >= 500;
}

function closeBugAlert() {
  document.getElementById(BUG_ALERT_MODAL_ID)?.remove();
}

async function submitBugReport({
  title,
  message,
  description = "",
  source = "ui",
  error = null
}) {
  const normalized = normalizeBugError(error);
  const payload = {
    title,
    message,
    description: String(description || "").trim() || null,
    source,
    role: getRole(),
    venue_slug: getVenueSlug(),
    route_name: getRoute().name,
    page_url: window.location.href,
    user_agent: window.navigator?.userAgent || "",
    stack: normalized.stack || null,
    context_json: {
      status: normalized.status,
      pathname: window.location.pathname || "",
      hash: window.location.hash || "",
      search: window.location.search || ""
    }
  };
  const response = await fetch(`${getApiBase()}/api/bug-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  });
  if (!response.ok) {
    throw new Error(`Bug report failed (${response.status})`);
  }
  return response.json();
}

function showAppAlert({
  title = "That action didn't complete.",
  message = "Please try again.",
  error = null,
  source = "ui",
  reportable = true
}) {
  const normalized = normalizeBugError(error);
  const resolvedMessage = String(message || normalized.message || "Please try again.").trim();
  const fingerprint = `${title}|${resolvedMessage}|${source}`;
  const now = Date.now();
  if (fingerprint === lastBugAlertFingerprint && now - lastBugAlertAt < BUG_ALERT_DEDUPE_WINDOW_MS) {
    return;
  }
  lastBugAlertFingerprint = fingerprint;
  lastBugAlertAt = now;
  closeBugAlert();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="bug-alert-backdrop" id="${BUG_ALERT_MODAL_ID}">
        <div class="bug-alert-modal" role="dialog" aria-modal="true" aria-labelledby="bugAlertTitle">
          <p class="bug-alert-kicker">System Alert</p>
          <h2 id="bugAlertTitle">${escapeHtml(title)}</h2>
          <p class="bug-alert-copy">${escapeHtml(resolvedMessage)}</p>
          ${
            reportable
              ? `
                <label for="bugAlertDescription">What were you trying to do? Optional.</label>
                <textarea id="bugAlertDescription" rows="4" placeholder="Add a short description to help reproduce the issue."></textarea>
                <p class="api-note" id="bugAlertStatus">You can send a bug report with the current page context.</p>
              `
              : `<p class="api-note">You can close this message and try again.</p>`
          }
          ${
            normalized.stack
              ? `
                <details class="bug-alert-details">
                  <summary>Technical details</summary>
                  <pre>${escapeHtml(normalized.stack)}</pre>
                </details>
              `
              : ""
          }
          <div class="bug-alert-actions">
            ${reportable ? `<button class="inline-btn ghost" type="button" id="bugAlertReportBtn">Send Report</button>` : ""}
            <button class="inline-btn" type="button" id="bugAlertDismissBtn">Try Again</button>
          </div>
        </div>
      </div>
    `
  );
  document.getElementById("bugAlertDismissBtn")?.addEventListener("click", closeBugAlert);
  document.getElementById(BUG_ALERT_MODAL_ID)?.addEventListener("click", (event) => {
    if (event.target?.id === BUG_ALERT_MODAL_ID) {
      closeBugAlert();
    }
  });
  document.getElementById("bugAlertReportBtn")?.addEventListener("click", async () => {
    const reportBtn = document.getElementById("bugAlertReportBtn");
    const status = document.getElementById("bugAlertStatus");
    const description = document.getElementById("bugAlertDescription")?.value || "";
    if (!reportBtn || !status) return;
    reportBtn.disabled = true;
    status.textContent = "Sending report...";
    try {
      const result = await submitBugReport({
        title,
        message: resolvedMessage,
        description,
        source,
        error
      });
      status.textContent = `Report sent. Reference #${result.report_id}.`;
    } catch (reportError) {
      status.textContent = `Could not send report: ${normalizeBugError(reportError).message}`;
      reportBtn.disabled = false;
    }
  });
}

function handleUnexpectedError(error, source = "unexpected") {
  const normalized = normalizeBugError(error);
  console.error(error);
  showAppAlert({
    title: "Oops, that wasn't meant to happen.",
    message: normalized.message || "Something unexpected happened.",
    error,
    source,
    reportable: true
  });
}

function requestRender(source = "render") {
  Promise.resolve(render()).catch((error) => {
    handleUnexpectedError(error, source);
  });
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
      ${renderStaffSessionButton(venueSlug, role, ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer, "solid")}
      <button class="inline-btn" id="forbiddenBackBtn">Back To Menu</button>
    </section>
  `;
  document.getElementById("staffLoginBtn")?.addEventListener("click", async () => {
    try {
      const ok = await loginStaff(apiBase, venueSlug, role);
      if (ok) {
        requestRender("forbidden-login");
      }
    } catch (error) {
      alert(`Staff login failed: ${error.message}`);
    }
  });
  document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
    handleStaffLogout();
  });
  document.getElementById("forbiddenBackBtn")?.addEventListener("click", () => setRoute("/"));
}

function renderRunnerAccessPage(apiBase, errorMessage = "") {
  const session = getStaffSession();
  const connectedVenueName = session?.role === "runner" ? session.venue_name || session.venue_slug || "Connected venue" : "";
  app.innerHTML = `
    <section class="hero venue-hero venue-hero-compact">
      <div class="hero-copy">
        <span class="brand-chip">RUNNER ACCESS</span>
        <h1 class="venue-title">Runner Stream Access</h1>
        <p class="venue-copy">Enter your venue access code to connect this device to the pooled runner stream.</p>
      </div>
    </section>
    <section class="form-card">
      <h2>Venue Access Code</h2>
      <p class="api-note">Use the venue-issued runner code for the site you are working at. Dev code for Brentford: <strong>8888</strong>.</p>
      ${errorMessage ? `<p class="unknown">${escapeHtml(errorMessage)}</p>` : ""}
      <form id="runnerAccessForm">
        <label for="runnerAccessCodeInput">Access Code</label>
        <input id="runnerAccessCodeInput" name="accessCode" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter code" required />
        <div class="runner-actions">
          <button class="inline-btn" type="submit">Connect To Stream</button>
          ${
            session?.role === "runner"
              ? `<button class="inline-btn ghost" type="button" id="resumeRunnerSessionBtn">Resume ${escapeHtml(String(connectedVenueName))}</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;

  document.getElementById("runnerAccessForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accessCode = String(form.get("accessCode") || "").trim();
    if (!accessCode) return;
    try {
      await loginRunnerWithAccessCode(apiBase, accessCode);
      setRoute("/runner-stream");
    } catch (error) {
      renderRunnerAccessPage(apiBase, `Could not connect runner device: ${error.message}`);
    }
  });

  document.getElementById("resumeRunnerSessionBtn")?.addEventListener("click", () => {
    setRoute("/runner-stream");
  });
}

function renderVendorAccessPage(apiBase, errorMessage = "") {
  const session = getStaffSession();
  const venueSlug = session?.role === "vendor" ? String(session.venue_slug || "") : getVenueSlug();
  app.innerHTML = `
    <section class="hero venue-hero access-hero">
      <div class="hero-copy">
        <span class="brand-chip">VENDOR ACCESS</span>
        <h1 class="venue-title">Vendor Login</h1>
        <p class="venue-copy">Sign in to load your vendor menu and manage items for the current vendor account.</p>
      </div>
      <div class="venue-hero-badge">DRQ</div>
    </section>
    <section class="form-card">
      <h2>Vendor Access</h2>
      <p class="api-note">Current prototype scope is single-venue bound. Venue-specific vendor access selection will be added in a later pass.</p>
      ${errorMessage ? `<p class="unknown">${escapeHtml(errorMessage)}</p>` : ""}
      <form id="vendorAccessForm">
        <label for="vendorAccessPinInput">Staff PIN</label>
        <input id="vendorAccessPinInput" name="pin" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter PIN" required />
        <div class="runner-actions">
          <button class="inline-btn" type="submit">Open Vendor Menu</button>
          ${
            session?.role === "vendor" && venueSlug
              ? `<button class="inline-btn ghost" type="button" id="resumeVendorMenuBtn">Resume Vendor Menu</button>`
              : ""
          }
        </div>
      </form>
    </section>
  `;

  document.getElementById("vendorAccessForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pin = String(form.get("pin") || "").trim();
    if (!pin) return;
    try {
      const vendorSession = await loginVendorWithPin(apiBase, venueSlug, pin);
      window.location.assign(
        buildAppEntryUrl("/menu/", {
          role: "vendor",
          venue: vendorSession.venue_slug,
          api: apiBase
        })
      );
    } catch (error) {
      renderVendorAccessPage(apiBase, `Could not connect vendor account: ${error.message}`);
    }
  });

  document.getElementById("resumeVendorMenuBtn")?.addEventListener("click", () => {
    window.location.assign(
      buildAppEntryUrl("/menu/", {
        role: "vendor",
        venue: venueSlug,
        api: apiBase
      })
    );
  });
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
    headingTitle = venue.name,
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
          <h1 class="venue-hero-toolbar-title">${escapeHtml(headingTitle)}</h1>
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

function getStreamRouteForRole(role, permissions) {
  if (role === "runner") return "/runner-stream";
  if (permissions.vendor) return "/stream";
  if (permissions.runner) return "/runner-stream";
  return "";
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
      vendor_slug: menuItem.vendor_slug || "",
      vendor_name: menuItem.vendor_name || "",
      price_text: menuItem.price,
      price_pennies: parsePriceToPennies(menuItem.price),
      quantity: 1
    });
  }
  writeCart(venueSlug, cart);
}

function bindCartSectionButtons({
  venueSlug,
  venue,
  role,
  permissions,
  apiBase,
  hasLockedOrder = false,
  activeOrder = null,
  reorderRound = [],
  onChanged
}) {
  const canVendor = permissions.vendor || role === "admin";
  const canVenue = permissions.venue || role === "admin";
  const canRunner = permissions.runner || role === "admin";
  const rerender = typeof onChanged === "function" ? onChanged : () => renderVenueMenu(venueSlug, venue, role, apiBase);

  const goCheckoutBtn = document.getElementById("goCheckoutBtn");
  if (goCheckoutBtn) {
    goCheckoutBtn.addEventListener("click", () => {
      if (hasLockedOrder && activeOrder?.order_id) {
        setRoute(`/order-status/${activeOrder.order_id}`);
        return;
      }
      setRoute("/checkout");
    });
  }

  const clearCartBtn = document.getElementById("clearCartBtn");
  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      if (hasLockedOrder) return;
      clearCart(venueSlug);
      rerender();
    });
  }

  document.getElementById("reorderRoundBtn")?.addEventListener("click", () => {
    if (hasLockedOrder) return;
    writeCart(venueSlug, reorderRound);
    clearReorderRound(venueSlug);
    rerender();
  });

  if (canRunner) {
    document.getElementById("goRunnerDashboardBtn")?.addEventListener("click", () => setRoute("/runner"));
  }
  if (canVendor) {
    document.getElementById("goVendorOpsBtn")?.addEventListener("click", () => setRoute("/vendor"));
  }
  if (canVenue) {
    document.getElementById("goVenueOpsBtn")?.addEventListener("click", () => setRoute("/venue"));
  }
  document.getElementById("staffLoginBtn")?.addEventListener("click", async () => {
    try {
      const desiredRole = role === "admin" ? "admin" : permissions.vendor ? "vendor" : permissions.venue ? "venue" : "runner";
      const ok = await loginStaff(apiBase, venueSlug, desiredRole);
      if (ok) requestRender("hero-login");
    } catch (error) {
      alert(`Staff login failed: ${error.message}`);
    }
  });
  document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
    handleStaffLogout();
  });
}

async function renderVenueMenu(venueSlug, venue, role, apiBase) {
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer;
  const isCustomerRole = role === "customer";
  const isVendorRole = role === "vendor";
  const isVenueRole = role === "venue";
  const activeOrder = role === "customer" ? await resolveActiveCustomerOrder(apiBase, venueSlug) : null;
  const vendorAuth = getAuthHeader(venueSlug, "vendor");
  let menuItems = venue.menuItems.map(normalizeMenuItem);
  try {
    menuItems = isVendorRole && vendorAuth
      ? await fetchMenuItems(apiBase, venueSlug, { includeInactive: true, authHeader: vendorAuth })
      : await fetchMenuItems(apiBase, venueSlug);
  } catch {
    // Fall back to static venue data if the menu API is temporarily unavailable.
  }
  const hasLockedOrder = Boolean(activeOrder?.order_id);
  const runnerAuth = getAuthHeader(venueSlug, "runner");
  const venueAuth = getAuthHeader(venueSlug, "venue");
  const canRunner = permissions.runner && Boolean(runnerAuth);
  const canVendor = permissions.vendor && Boolean(vendorAuth);
  const canVenue = permissions.venue && Boolean(venueAuth);
  const streamRoute = getStreamRouteForRole(role, permissions);
  const vendorDisplayName = isVendorRole ? getVendorDisplayName(venueSlug) : "";
  const toolbarButtons = [{ label: "Menu", action: "route", target: "/", active: true }];
  if (streamRoute) {
    toolbarButtons.push({ label: "Stream", action: "route", target: streamRoute });
  }
  const cart = readCart(venueSlug);
  const reorderRound = readReorderRound(venueSlug);
  const count = itemCount(cart);
  const total = formatPennies(totalPennies(cart));
  const firstCartItem = cart[0] || null;
  const matchedCartVendorItem = firstCartItem
    ? menuItems.find((item) => item.id === firstCartItem.item_id || item.item_id === firstCartItem.item_id)
    : null;
  const cartVendorSlug = String(firstCartItem?.vendor_slug || matchedCartVendorItem?.vendor_slug || "");
  const cartVendorName = String(firstCartItem?.vendor_name || matchedCartVendorItem?.vendor_name || "");
  const preferredDeliveryMode =
    readPreferredDeliveryMode(venueSlug) || venue.fulfillmentModes[0]?.label || "";
  const categoryOptions = ["All", ...new Set(menuItems.map((item) => String(item.category || "").trim()).filter(Boolean))];
  const selectedCategory = categoryOptions.includes(readMenuCategoryFilter(venueSlug))
    ? readMenuCategoryFilter(venueSlug)
    : "All";
  const visibleMenuItems =
    selectedCategory === "All" ? menuItems : menuItems.filter((item) => String(item.category || "").trim() === selectedCategory);

  if (isVenueRole) {
    app.innerHTML = `
      ${renderVenueHero(venue, { toolbarButtons: [{ label: "Venue", action: "route", target: "/", active: true }] })}
      <section class="form-card">
        <h2>Venue Role</h2>
        <p>This role does not use the shared customer/vendor menu surface.</p>
        <p class="api-note">Use venue-level operations for parent venue management, or vendor surfaces for seller menus and live order handling.</p>
      </section>
      <section class="cart-mini" id="cartSection">
        ${canVenue ? `<button class="inline-btn ghost" id="goVenueOpsBtn">Venue Ops</button>` : ""}
        ${renderStaffSessionButton(venueSlug, role, permissions)}
      </section>
    `;
    bindHeroToolbarButtons();
    if (canVenue) {
      document.getElementById("goVenueOpsBtn")?.addEventListener("click", () => setRoute("/venue"));
    }
    document.getElementById("staffLoginBtn")?.addEventListener("click", async () => {
      try {
        const ok = await loginStaff(apiBase, venueSlug, role === "admin" ? "admin" : "venue");
        if (ok) requestRender("venue-role-login");
      } catch (error) {
        alert(`Staff login failed: ${error.message}`);
      }
    });
    document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
      handleStaffLogout();
    });
    return;
  }

  app.innerHTML = `
    ${renderVenueHero(venue, { toolbarButtons, headingTitle: isVendorRole ? vendorDisplayName : venue.name })}
    ${
      hasLockedOrder
        ? `
      <div class="active-order-banner">
        <strong>Active order in progress</strong><br />
        You can browse the menu, but ordering is locked until ${escapeHtml(getOrderTitle(activeOrder))} is complete.
        <br /><br />
        <button class="inline-btn" id="resumeActiveOrderBtn">Resume Active Order</button>
      </div>
    `
        : ""
    }
    <section class="category-slug-shell">
      <div class="category-slug" id="categorySlug">
        <div class="category-slug-track">
          ${categoryOptions
            .map(
              (category) => `
            <button
              class="category-chip${selectedCategory === category ? " is-active" : ""}"
              type="button"
              data-menu-category="${escapeHtml(category)}"
            >
              ${escapeHtml(category)}
            </button>`
            )
            .join("")}
        </div>
      </div>
    </section>
    ${
      isCustomerRole
        ? `
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
    `
        : ""
    }
    <section class="menu-grid">
      ${visibleMenuItems
        .map((item) => {
          const isLockedToAnotherVendor =
            isCustomerRole && Boolean(cartVendorSlug) && Boolean(item.vendor_slug) && cartVendorSlug !== item.vendor_slug;
          return `
        <article class="item${isLockedToAnotherVendor ? " item-vendor-locked" : ""}" data-item-id="${item.id}">
          <h3>${item.name}</h3>
          <div class="item-meta">
            <span>${item.category}</span>
            <span class="price">${item.price}</span>
          </div>
          ${
            item.vendor_name
              ? `<p class="api-note">Sold by ${escapeHtml(item.vendor_name)}</p>`
              : ""
          }
	          <ul class="option-list">
	            ${item.options.map((opt) => `<li>${modeLine(opt, venue)}</li>`).join("")}
	          </ul>
	          ${
              isCustomerRole
                ? `
              <button class="add-btn" data-add-id="${item.id}" ${hasLockedOrder || isLockedToAnotherVendor ? "disabled" : ""}>
              ${hasLockedOrder ? "Ordering Locked" : "Add To Cart"}
            </button>`
                : canVendor && isVendorRole
                  ? `
              <div class="runner-actions">
                <button class="inline-btn ghost vendor-menu-edit-btn" data-menu-item-id="${escapeHtml(item.item_id)}">Edit</button>
                <button class="inline-btn ghost vendor-menu-delete-btn" data-menu-item-id="${escapeHtml(item.item_id)}">Delete</button>
              </div>
            `
                  : `<div class="api-note">Vendor login required to edit or delete menu items.</div>`
            }
	        </article>`;
        })
	        .join("")}
      ${
        canVendor && isVendorRole
          ? `
        <article class="item add-item-card" id="vendorAddItemCard" role="button" tabindex="0" aria-label="Add menu item">
          <div class="add-item-plus" aria-hidden="true">+</div>
          <h3>Add Menu Item</h3>
          <p class="api-note">Create a new item in this vendor menu.</p>
        </article>
      `
          : ""
      }
    </section>

    <section class="cart-mini" id="cartSection">
      ${
        isCustomerRole
          ? `
      Cart: <strong>${count} item${count === 1 ? "" : "s"}</strong> · ${total}
      ${
        reorderRound.length > 0
          ? `<button class="inline-btn ghost" id="reorderRoundBtn">Reorder Round</button>`
          : ""
      }
      <button class="inline-btn" id="goCheckoutBtn" ${count === 0 || hasLockedOrder ? "disabled" : ""}>
        ${hasLockedOrder ? "Order In Progress" : "Go To Checkout"}
      </button>
      <button class="inline-btn ghost" id="clearCartBtn" ${count === 0 || hasLockedOrder ? "disabled" : ""}>Clear</button>
      `
          : `
      Staff role active. Checkout actions are hidden on this view.
      `
      }
      ${canVendor ? `<button class="inline-btn ghost" id="goVendorOpsBtn">Vendor Ops</button>` : ""}
      ${canVenue ? `<button class="inline-btn ghost" id="goVenueOpsBtn">Venue Ops</button>` : ""}
      ${
        canRunner
          ? `
      <button class="inline-btn ghost" id="goRunnerDashboardBtn">Runner Dashboard</button>
      `
          : ""
      }
      ${renderStaffSessionButton(venueSlug, role, permissions)}
    </section>
  `;
  bindHeroToolbarButtons();
  document.querySelectorAll("[data-menu-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextCategory = button.getAttribute("data-menu-category");
      if (!nextCategory) return;
      writeMenuCategoryFilter(venueSlug, nextCategory);
      renderVenueMenu(venueSlug, venue, role, apiBase);
    });
  });

  if (isCustomerRole) {
    const modeCards = document.querySelectorAll("[data-delivery-mode]");
    modeCards.forEach((card) => {
      card.addEventListener("click", () => {
        const selectedMode = card.getAttribute("data-delivery-mode");
        if (!selectedMode) return;
        writePreferredDeliveryMode(venueSlug, selectedMode);
        renderVenueMenu(venueSlug, venue, role, apiBase);
      });
    });
  }

  if (canVendor && isVendorRole) {
    document.getElementById("vendorAddItemCard")?.addEventListener("click", async () => {
      const nextItem = promptForMenuItem();
      if (!nextItem) return;
      try {
        await saveMenuItem(apiBase, vendorAuth, venueSlug, nextItem, true);
        await renderVenueMenu(venueSlug, venue, role, apiBase);
      } catch (error) {
        alert(`Could not create menu item: ${error.message}`);
      }
    });
    document.getElementById("vendorAddItemCard")?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const nextItem = promptForMenuItem();
      if (!nextItem) return;
      try {
        await saveMenuItem(apiBase, vendorAuth, venueSlug, nextItem, true);
        await renderVenueMenu(venueSlug, venue, role, apiBase);
      } catch (error) {
        alert(`Could not create menu item: ${error.message}`);
      }
    });
    document.querySelectorAll(".vendor-menu-edit-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const itemId = button.getAttribute("data-menu-item-id");
        const existing = menuItems.find((item) => item.item_id === itemId);
        if (!existing) return;
        const nextItem = promptForMenuItem(existing);
        if (!nextItem) return;
        try {
          await saveMenuItem(apiBase, vendorAuth, venueSlug, { ...existing, ...nextItem }, false);
          await renderVenueMenu(venueSlug, venue, role, apiBase);
        } catch (error) {
          alert(`Could not update menu item: ${error.message}`);
        }
      });
    });

    document.querySelectorAll(".vendor-menu-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const itemId = button.getAttribute("data-menu-item-id");
        if (!itemId) return;
        const confirmed = window.confirm(`Delete menu item "${itemId}"?`);
        if (!confirmed) return;
        try {
          await deleteMenuItem(apiBase, vendorAuth, venueSlug, itemId);
          await renderVenueMenu(venueSlug, venue, role, apiBase);
        } catch (error) {
          alert(`Could not delete menu item: ${error.message}`);
        }
      });
    });
  }

  if (isCustomerRole) {
    const addButtons = document.querySelectorAll("[data-add-id]");
    addButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (hasLockedOrder) return;
        const itemId = btn.getAttribute("data-add-id");
        const menuItem = menuItems.find((x) => x.id === itemId);
        if (!menuItem) return;
        addItemToCart(venueSlug, menuItem);
        renderVenueMenu(venueSlug, venue, role, apiBase);
      });
    });
  }

  document.getElementById("resumeActiveOrderBtn")?.addEventListener("click", () => {
    if (!activeOrder?.order_id) return;
    setRoute(`/order-status/${activeOrder.order_id}`);
  });
  bindCartSectionButtons({
    venueSlug,
    venue,
    role,
    permissions,
    apiBase,
    hasLockedOrder,
    activeOrder,
    reorderRound,
    onChanged: () => renderVenueMenu(venueSlug, venue, role, apiBase)
  });
}

async function renderCheckout(venueSlug, venue, apiBase) {
  const cart = readCart(venueSlug);
  const savedProfile = await hydrateCustomerProfile(apiBase, venueSlug);
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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
  const isMemberProfile = String(savedProfile?.accountLevel || "") === "member";
  const showSaveDetailsRow = !hasRememberedProfile;
  const showForgetDetailsRow = hasRememberedProfile && !isMemberProfile;
  const defaultCheckoutType = "remembered";
  const menuSelectedDeliveryMode = readPreferredDeliveryMode(venueSlug);
  const pendingTipAmount = readPendingTipAmount(venueSlug);
  const finalCheckoutTotal = formatPennies(totalPennies(cart) + pendingTipAmount);
  const profileDeliveryMode =
    savedProfile?.preferredDeliveryMode || savedProfile?.lastDeliveryMode || savedProfile?.deliveryMode || "";
  const profileDeliveryTarget =
    savedProfile?.preferredDeliveryTarget || savedProfile?.lastDeliveryTarget || savedProfile?.deliveryTarget || "";
  const preferredDeliveryMode =
    menuSelectedDeliveryMode || profileDeliveryMode || venue.fulfillmentModes[0]?.label || "";
  const defaultDeliveryTarget =
    (menuSelectedDeliveryMode && menuSelectedDeliveryMode !== profileDeliveryMode
      ? ""
      : profileDeliveryTarget) ||
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
      <p class="summary-total" id="checkoutTotalLine">Final Total: <strong>${finalCheckoutTotal}</strong></p>
      <div class="tip-summary-card">
        <div>
          <strong>Tip</strong>
          <p class="api-note" id="checkoutTipSummary">
            ${pendingTipAmount > 0 ? `Tip to be added: ${escapeHtml(formatPennies(pendingTipAmount))}` : "No tip added yet."}
          </p>
        </div>
        <button class="inline-btn ghost" type="button" id="checkoutTipBtn">${pendingTipAmount > 0 ? "Edit Tip" : "Add Tip"}</button>
      </div>
    </section>

    <section class="form-card">
      <h2>
        ${
          hasRememberedProfile
            ? `Hi ${escapeHtml(savedProfile?.name || "there")}! You've enabled faster checkout`
            : "Contact + Delivery"
        }
      </h2>
      <p class="api-note checkout-recognition-note">
        Delivery
      </p>
      <div id="accountRecognition"></div>
      <form id="checkoutForm">
        <input type="hidden" name="checkoutType" value="${defaultCheckoutType}" />
        ${
          showSaveDetailsRow
            ? `
        <div class="choice-note checkout-save-toggle" aria-label="Save details for faster checkout">
          <span class="checkout-save-toggle-label">Save details for faster checkout</span>
          <span class="checkout-save-toggle-switch" aria-hidden="true">
            <span class="checkout-save-toggle-thumb"></span>
          </span>
        </div>
        `
            : showForgetDetailsRow
              ? `
        <div class="choice-note checkout-save-toggle" aria-label="Forget saved checkout details">
          <button class="inline-btn ghost" type="button" id="forgetDetailsBtn">Forget Details</button>
        </div>
        `
              : ""
        }
        <div id="nameFieldGroup">
          <label>Name</label>
          <input name="name" required placeholder="Your name" value="${escapeHtml(savedProfile?.name || "")}" />
        </div>

        <div id="emailFieldGroup">
          <label>Email</label>
          <input name="email" required type="email" placeholder="name@email.com" value="${escapeHtml(savedProfile?.email || "")}" />
        </div>

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

        <button class="add-btn" type="submit">Pay & Place Order</button>
        <button class="inline-btn ghost" type="button" id="backMenuBtn">Back To Menu</button>
      </form>
      <p class="api-note">API: ${escapeHtml(apiBase)}</p>
      <p id="checkoutMsg" class="status-msg"></p>
    </section>
  `;

  document.getElementById("backMenuBtn")?.addEventListener("click", () => setRoute("/"));
  document.getElementById("checkoutTipBtn")?.addEventListener("click", () => {
    openTipModal({
      title: "Add Tip",
      subtitle: "Choose a tip amount for this order.",
      initialAmountPennies: pendingTipAmount,
      confirmLabel: "Save Tip",
      allowClear: true,
      onConfirm: async (tipAmountPennies) => {
        writePendingTipAmount(venueSlug, tipAmountPennies);
        const summary = document.getElementById("checkoutTipSummary");
        const button = document.getElementById("checkoutTipBtn");
        if (summary) {
          summary.textContent = tipAmountPennies > 0 ? `Tip to be added: ${formatPennies(tipAmountPennies)}` : "No tip added yet.";
        }
        const totalLine = document.getElementById("checkoutTotalLine");
        if (totalLine) {
          totalLine.innerHTML = `Final Total: <strong>${escapeHtml(formatPennies(totalPennies(cart) + tipAmountPennies))}</strong>`;
        }
        if (button) {
          button.textContent = tipAmountPennies > 0 ? "Edit Tip" : "Add Tip";
        }
      }
    });
  });
  document.getElementById("forgetDetailsBtn")?.addEventListener("click", () => {
    clearCustomerProfile(venueSlug);
    renderCheckout(venueSlug, venue, apiBase);
  });

  const checkoutTypeInput = document.querySelector('input[name="checkoutType"]');
  const nameFieldGroup = document.getElementById("nameFieldGroup");
  const emailFieldGroup = document.getElementById("emailFieldGroup");
  const nameInput = document.querySelector('input[name="name"]');
  const emailInput = document.querySelector('input[name="email"]');
  const accountRecognition = document.getElementById("accountRecognition");

  const setCheckoutFieldVisibility = (lookupState) => {
    const isRememberedReturnCustomer = hasRememberedProfile;
    const isMember = String(lookupState?.account_level || savedProfile?.accountLevel || "") === "member";
    const shouldHideIdentityFields = isRememberedReturnCustomer || isMember;
    nameFieldGroup?.classList.toggle("checkout-field-hidden", shouldHideIdentityFields);
    emailFieldGroup?.classList.toggle("checkout-field-hidden", shouldHideIdentityFields);
    if (!shouldHideIdentityFields) return;
    if (nameInput && lookupState?.name) {
      nameInput.value = String(lookupState.name);
    }
    if (emailInput && lookupState?.email) {
      emailInput.value = String(lookupState.email);
    }
  };
  setCheckoutFieldVisibility(savedProfile ? { account_level: savedProfile.accountLevel, name: savedProfile.name, email: savedProfile.email } : null);

  const renderAccountRecognition = (state) => {
    if (!accountRecognition) return;
    if (!state) {
      accountRecognition.innerHTML = "";
      setCheckoutFieldVisibility(null);
      return;
    }
    if (!state.exists) {
      accountRecognition.innerHTML = "";
      setCheckoutFieldVisibility(null);
      return;
    }
    if (String(state.account_level || "profile") === "member") {
      accountRecognition.innerHTML = "";
      setCheckoutFieldVisibility(state);
      return;
    }
    setCheckoutFieldVisibility(state);
    accountRecognition.innerHTML = `
      <div class="choice-note account-recognition-card">
        <strong>Finish sign up for member privileges</strong>
        <p class="api-note">Login email: <strong>${escapeHtml(String(state.email || emailInput?.value || ""))}</strong></p>
        <label>Password</label>
        <input type="password" id="memberPasswordInput" placeholder="Create a password" minlength="8" />
        <label>Confirm Password</label>
        <input type="password" id="memberPasswordConfirmInput" placeholder="Confirm password" minlength="8" />
        <button class="inline-btn" type="button" id="makeAccountBtn">Set Password</button>
        <p class="api-note" id="accountUpgradeMsg"></p>
      </div>
    `;
    document.getElementById("makeAccountBtn")?.addEventListener("click", () => {
      const password = String(document.getElementById("memberPasswordInput")?.value || "");
      const confirmPassword = String(document.getElementById("memberPasswordConfirmInput")?.value || "");
      const upgradeMsg = document.getElementById("accountUpgradeMsg");
      if (password.length < 8) {
        if (upgradeMsg) upgradeMsg.textContent = "Password must be at least 8 characters.";
        return;
      }
      if (password !== confirmPassword) {
        if (upgradeMsg) upgradeMsg.textContent = "Passwords do not match.";
        return;
      }
      if (upgradeMsg) {
        upgradeMsg.textContent = "Saving member password...";
      }
      fetch(`${apiBase}/api/customers/upgrade-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_slug: venueSlug,
          email: String(emailInput?.value || "").trim(),
          password
        })
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Upgrade failed (${response.status})`);
          }
          return response.json();
        })
        .then((profile) => {
          writeCustomerProfile(venueSlug, {
            customerId: Number(profile.customer_id || savedProfile?.customerId || 0) || null,
            token: String(profile.customer_token || savedProfile?.token || ""),
            name: String(savedProfile?.name || ""),
            email: String(profile.email || emailInput?.value || ""),
            deliveryMode: String(profile.delivery_mode || savedProfile?.deliveryMode || preferredDeliveryMode || ""),
            deliveryTarget: String(profile.delivery_target || savedProfile?.deliveryTarget || defaultDeliveryTarget || ""),
            preferredDeliveryMode: String(profile.preferred_delivery_mode || savedProfile?.preferredDeliveryMode || ""),
            preferredDeliveryTarget: String(profile.preferred_delivery_target || savedProfile?.preferredDeliveryTarget || ""),
            lastDeliveryMode: String(profile.last_delivery_mode || savedProfile?.lastDeliveryMode || preferredDeliveryMode || ""),
            lastDeliveryTarget: String(profile.last_delivery_target || savedProfile?.lastDeliveryTarget || defaultDeliveryTarget || ""),
            checkoutType: "remembered",
            accountLevel: String(profile.account_level || "member")
          });
          renderAccountRecognition({ exists: true, account_level: "member" });
        })
        .catch((error) => {
          if (upgradeMsg) upgradeMsg.textContent = error.message;
        });
    });
  };

  let latestLookupEmail = "";
  const runAccountRecognition = async () => {
    const nextEmail = String(emailInput?.value || "").trim().toLowerCase();
    if (!nextEmail || !nextEmail.includes("@")) {
      latestLookupEmail = "";
      renderAccountRecognition(null);
      return;
    }
    latestLookupEmail = nextEmail;
    try {
      const result = await lookupCustomerAccount(apiBase, venueSlug, nextEmail);
      if (latestLookupEmail !== nextEmail) return;
      renderAccountRecognition(result);
    } catch {
      if (latestLookupEmail !== nextEmail) return;
      renderAccountRecognition(null);
    }
  };

  emailInput?.addEventListener("blur", runAccountRecognition);
  emailInput?.addEventListener("change", runAccountRecognition);
  emailInput?.addEventListener("input", () => {
    if (!accountRecognition) return;
    if (String(emailInput.value || "").trim().toLowerCase() !== latestLookupEmail) {
      accountRecognition.innerHTML = "";
      setCheckoutFieldVisibility(null);
    }
  });
  if (savedProfile?.email) {
    void runAccountRecognition();
  }

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

    try {
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
          customer_token: savedProfile?.token || null,
          tip_amount_pennies: readPendingTipAmount(venueSlug)
        })
      });

      if (!orderRes.ok) {
        throw new Error(`Order failed (${orderRes.status})`);
      }

      const orderData = await orderRes.json();
      if (orderData.customer_profile) {
        writeCustomerProfile(venueSlug, {
          customerId: Number(orderData.customer_profile.customer_id || 0) || null,
          token: String(orderData.customer_profile.customer_token || ""),
          name,
          email,
          deliveryMode: String(orderData.customer_profile.delivery_mode || deliveryMode),
          deliveryTarget: String(orderData.customer_profile.delivery_target || deliveryTarget),
          preferredDeliveryMode: String(orderData.customer_profile.preferred_delivery_mode || ""),
          preferredDeliveryTarget: String(orderData.customer_profile.preferred_delivery_target || ""),
          lastDeliveryMode: String(orderData.customer_profile.last_delivery_mode || deliveryMode),
          lastDeliveryTarget: String(orderData.customer_profile.last_delivery_target || deliveryTarget),
          checkoutType,
          accountLevel: String(orderData.customer_profile.account_level || "profile")
        });
      }
      writePreferredDeliveryMode(venueSlug, deliveryMode);
      writeActiveOrderId(venueSlug, orderData.order_id);
      clearPendingTipAmount(venueSlug);
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
    showAppAlert({
      title: shouldOfferDiagnosticReport(error) ? "Oops, that wasn't meant to happen." : "Could not load that order.",
      message: normalizeBugError(error).message,
      error,
      source: "order-status-load",
      reportable: shouldOfferDiagnosticReport(error)
    });
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
    loaded: { status: "en_route", label: "En Route" },
    en_route: { status: "arrived", label: "Arrived" },
    arrived: { status: "fulfilled", label: "Fulfilled" }
  };
  const nextAction =
    status === "assigned" && !order.assigned_runner_token
      ? { status: "assigned", label: "Take Over" }
      : nextActionByStatus[status] || (status === "assigned" ? { status: "loaded", label: "Loaded" } : null);

  if (!nextAction) {
    return `<div class="runner-actions"><span class="api-note">No runner action available for ${escapeHtml(status)}.</span></div>`;
  }

  const showCancel = Boolean(order.assigned_runner_token) && ["assigned", "loaded", "en_route", "arrived"].includes(status);
  return `
    <div class="runner-actions">
      <button class="inline-btn status-btn" type="button" data-order-id="${order.order_id}" data-status="${nextAction.status}">${nextAction.label}</button>
      ${showCancel ? `<button class="inline-btn ghost status-btn" type="button" data-order-id="${order.order_id}" data-status="cancelled">Cancel</button>` : ""}
    </div>
  `;
}

function venueStatusButtons(order, isAdmin) {
  const orderId = order.order_id;
  const status = order.status;
  const normalizedStatus = String(status || "").toLowerCase();
  const canAccept = normalizedStatus === "received";
  const canReject = normalizedStatus === "received";
  const canReady = normalizedStatus === "accepted";
  const canFail = ["accepted", "ready", "assigned", "loaded", "en_route", "arrived"].includes(normalizedStatus);
  const canFlagAttention = !["fulfilled", "collected", "uncollected", "rejected", "cancelled", "failed"].includes(normalizedStatus);
  const canResolveAttention = Boolean(order.attention_required);
  const canReleaseRunner = normalizedStatus === "assigned" && Boolean(order.assigned_runner_token);
  const canRefund = isAdmin && String(order.payment_status || "").toLowerCase() === "captured";
  return `
    <div class="runner-actions">
      <button class="inline-btn venue-action-btn" data-action="accept" data-order-id="${orderId}" ${canAccept ? "" : "disabled"}>Accept</button>
      <button class="inline-btn ghost venue-action-btn" data-action="reject" data-order-id="${orderId}" ${canReject ? "" : "disabled"}>Reject</button>
      <button class="inline-btn venue-action-btn" data-action="ready" data-order-id="${orderId}" ${canReady ? "" : "disabled"}>Mark Ready</button>
      <button class="inline-btn ghost venue-action-btn" data-action="fail" data-order-id="${orderId}" ${canFail ? "" : "disabled"}>Fail Order</button>
      <button class="inline-btn ghost venue-action-btn" data-action="attention" data-order-id="${orderId}" ${canFlagAttention ? "" : "disabled"}>Flag Issue</button>
      <button class="inline-btn ghost venue-action-btn" data-action="resolve-attention" data-order-id="${orderId}" ${canResolveAttention ? "" : "disabled"}>Resolve Alert</button>
      <button class="inline-btn ghost venue-action-btn" data-action="release-runner" data-order-id="${orderId}" ${canReleaseRunner ? "" : "disabled"}>Release Runner</button>
      ${canRefund ? `<button class="inline-btn ghost venue-action-btn" data-action="refund" data-order-id="${orderId}">Refund</button>` : ""}
    </div>
  `;
}

function venueCollectButtons(order, isAdmin) {
  const status = String(order.status || "").toLowerCase();
  const canAccept = status === "received";
  const canReject = status === "received";
  const canReady = status === "accepted";
  const canCollect = status === "ready_for_collection";
  const canMarkUncollected = status === "ready_for_collection";
  const canFail = ["accepted", "ready_for_collection"].includes(status);
  const canFlagAttention = !["collected", "uncollected", "rejected", "cancelled", "failed"].includes(status);
  const canResolveAttention = Boolean(order.attention_required);
  const canRefund = isAdmin && String(order.payment_status || "").toLowerCase() === "captured";
  return `
    <div class="runner-actions">
      <button class="inline-btn venue-action-btn" data-action="accept" data-order-id="${order.order_id}" ${canAccept ? "" : "disabled"}>Accept</button>
      <button class="inline-btn ghost venue-action-btn" data-action="reject" data-order-id="${order.order_id}" ${canReject ? "" : "disabled"}>Reject</button>
      <button class="inline-btn venue-action-btn" data-action="ready" data-order-id="${order.order_id}" ${canReady ? "" : "disabled"}>Ready For Collection</button>
      <button class="inline-btn venue-action-btn" data-action="collect" data-order-id="${order.order_id}" data-pickup-code="${escapeHtml(order.pickup_code || "")}" ${canCollect ? "" : "disabled"}>Verify Collected</button>
      <button class="inline-btn ghost venue-action-btn" data-action="uncollected" data-order-id="${order.order_id}" ${canMarkUncollected ? "" : "disabled"}>Mark Uncollected</button>
      <button class="inline-btn ghost venue-action-btn" data-action="fail" data-order-id="${order.order_id}" ${canFail ? "" : "disabled"}>Fail Order</button>
      <button class="inline-btn ghost venue-action-btn" data-action="attention" data-order-id="${order.order_id}" ${canFlagAttention ? "" : "disabled"}>Flag Issue</button>
      <button class="inline-btn ghost venue-action-btn" data-action="resolve-attention" data-order-id="${order.order_id}" ${canResolveAttention ? "" : "disabled"}>Resolve Alert</button>
      ${canRefund ? `<button class="inline-btn ghost venue-action-btn" data-action="refund" data-order-id="${order.order_id}">Refund</button>` : ""}
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

async function renderRunnerStream(venueSlug, apiBase, authHeader) {
  stopPagePoll();
  const venue = VENUES[venueSlug];
  const role = getRole();
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer;
  const toolbarButtons =
    role === "runner"
      ? [
          { label: "Stream", action: "route", target: "/runner-stream", active: true },
          { label: "Runner Dashboard", action: "route", target: "/runner" }
        ]
      : [
          { label: "Menu", action: "route", target: "/" },
          { label: "Stream", action: "route", target: "/runner-stream", active: true }
        ];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      contextChip: "STREAM",
      toolbarButtons
    })}
    <section class="category-slug stream-action-row">
      <button class="category-chip stream-action-chip" type="button" id="runnerStreamRefreshBtn">Refresh</button>
    </section>
    <section class="menu-grid stream-grid" id="runnerOrders"></section>
    <section class="hero-tools">
      ${renderStaffSessionButton(venueSlug, role, permissions)}
    </section>
  `;
  bindHeroToolbarButtons();
  document.getElementById("staffLoginBtn")?.addEventListener("click", async () => {
    renderRunnerAccessPage(apiBase);
  });
  document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
    handleStaffLogout();
  });

  document.getElementById("runnerStreamRefreshBtn")?.addEventListener("click", () => {
    renderRunnerStream(venueSlug, apiBase, authHeader);
  });

  const container = document.getElementById("runnerOrders");
  container.innerHTML = `<section class="form-card"><p>Loading orders...</p></section>`;

  try {
    const loadRunnerStreamState = async () => {
      const activeOrder = await fetchRunnerActiveOrder(apiBase, venueSlug, authHeader);
      if (activeOrder) {
        return { activeOrder, orders: [] };
      }

      const res = await fetch(`${apiBase}/api/orders?venue_slug=${encodeURIComponent(venueSlug)}&limit=50`, {
        headers: { Authorization: authHeader },
        cache: "no-store"
      });
      if (!res.ok) {
        throw makeHttpError(`Could not fetch orders (${res.status})`, res.status);
      }
      const data = await res.json();
      const orders = (data.orders || []).filter((order) =>
        !isClickAndCollectOrder(order) &&
        (String(order.status || "").toLowerCase() === "ready" ||
          (String(order.status || "").toLowerCase() === "assigned" && !order.assigned_runner_token))
      );
      return { activeOrder: null, orders };
    };

    const state = await loadRunnerStreamState();
    let signature = JSON.stringify({
      activeOrderId: state.activeOrder?.order_id || null,
      activeOrderVersion: state.activeOrder?.version || null,
      orders: state.orders.map((order) => [order.order_id, order.version, order.status, order.assigned_runner_token || ""])
    });
    renderRunnerOrdersDom(container, state);
    bindRunnerStatusButtons(container, { venueSlug, apiBase, authHeader });

    startPagePoll(async () => {
      const nextState = await loadRunnerStreamState();
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
    if (isStaffSessionError(error)) {
      clearStaffSession();
      requestRender("runner-session-reset");
      return;
    }
    showAppAlert({
      title: shouldOfferDiagnosticReport(error) ? "Oops, that wasn't meant to happen." : "Could not refresh the runner stream.",
      message: normalizeBugError(error).message,
      error,
      source: "runner-stream",
      reportable: shouldOfferDiagnosticReport(error)
    });
    container.innerHTML = `<section class="unknown">Runner stream error: ${escapeHtml(error.message)}</section>`;
  }
}

async function renderVendorStream(venueSlug, apiBase, authHeader) {
  stopPagePoll();
  const venue = VENUES[venueSlug];
  const role = getRole();
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer;
  const canVendor = permissions.vendor || role === "admin";
  const canVenue = permissions.venue || role === "admin";
  const canRunner = permissions.runner || role === "admin";
  const currentStaffRole = getStaffSession()?.role || "";
  const canManageMenu = currentStaffRole === "vendor" || currentStaffRole === "admin";
  const vendorDisplayName = getVendorDisplayName(venueSlug);
  const toolbarButtons = [
    { label: "Menu", action: "route", target: "/" },
    { label: "Stream", action: "route", target: "/stream", active: true }
  ];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      headingTitle: vendorDisplayName,
      contextChip: "STREAM",
      toolbarButtons
    })}
    <section class="category-slug stream-action-row">
      <button class="category-chip stream-action-chip" type="button" id="streamRefreshBtn">Refresh</button>
    </section>
    <section class="menu-grid stream-grid" id="venueOrders"></section>
    <section class="cart-mini" id="cartSection">
      Staff role active. Checkout actions are hidden on this view.
      ${canVendor ? `<button class="inline-btn ghost" id="goVendorOpsBtn">Vendor Ops</button>` : ""}
      ${canVenue ? `<button class="inline-btn ghost" id="goVenueOpsBtn">Venue Ops</button>` : ""}
      ${canRunner ? `<button class="inline-btn ghost" id="goRunnerDashboardBtn">Runner Dashboard</button>` : ""}
      ${renderStaffSessionButton(venueSlug, role, permissions)}
    </section>
    ${canManageMenu ? `<section id="adminMenuManager"></section>` : ""}
  `;
  bindHeroToolbarButtons();
  bindCartSectionButtons({
    venueSlug,
    venue,
    role,
    permissions,
    apiBase,
    onChanged: () => renderVendorStream(venueSlug, apiBase, authHeader)
  });

  document.getElementById("streamRefreshBtn")?.addEventListener("click", () => {
    renderVendorStream(venueSlug, apiBase, authHeader);
  });

  const container = document.getElementById("venueOrders");
  const adminMenuContainer = document.getElementById("adminMenuManager");
  container.innerHTML = `<section class="form-card"><p>Loading venue orders...</p></section>`;
  if (adminMenuContainer) {
    adminMenuContainer.innerHTML = `<section class="form-card"><p>Loading menu admin...</p></section>`;
  }

  try {
    const loadVenueDashboardState = async () => {
      const [ordersRes, menuItems] = await Promise.all([
        fetch(`${apiBase}/api/orders?venue_slug=${encodeURIComponent(venueSlug)}&limit=50`, {
          headers: { Authorization: authHeader },
          cache: "no-store"
        }),
        canManageMenu ? fetchMenuItems(apiBase, venueSlug, { includeInactive: true, authHeader }) : Promise.resolve([])
      ]);
      if (!ordersRes.ok) {
        throw makeHttpError(`Could not fetch orders (${ordersRes.status})`, ordersRes.status);
      }
      const data = await ordersRes.json();
      return { orders: data.orders || [], menuItems };
    };

    let state = await loadVenueDashboardState();
    let signature = JSON.stringify(
      state.orders.map((order) => [
        order.order_id,
        order.version,
        order.status,
        order.assigned_runner_token || "",
        order.payment_status || ""
      ])
    );
    renderVenueOrdersDom(container, state.orders, venueSlug, currentStaffRole === "admin");
    bindVenueActionButtons(container, { venueSlug, apiBase, authHeader });
    if (canManageMenu && adminMenuContainer) {
      renderAdminMenuManager(adminMenuContainer, state.menuItems);
      bindAdminMenuButtons(adminMenuContainer, {
        venueSlug,
        apiBase,
        authHeader,
        getItems: () => state.menuItems,
        onUpdated: async () => {
          await renderVendorStream(venueSlug, apiBase, authHeader);
        }
      });
    }

    startPagePoll(async () => {
      const nextState = await loadVenueDashboardState();
      const nextSignature = JSON.stringify(
        nextState.orders.map((order) => [
          order.order_id,
          order.version,
          order.status,
          order.assigned_runner_token || "",
          order.payment_status || ""
        ])
      );
      if (nextSignature !== signature) {
        signature = nextSignature;
        state = nextState;
        renderVenueOrdersDom(container, nextState.orders, venueSlug, currentStaffRole === "admin");
        bindVenueActionButtons(container, { venueSlug, apiBase, authHeader });
        if (canManageMenu && adminMenuContainer) {
          renderAdminMenuManager(adminMenuContainer, nextState.menuItems);
          bindAdminMenuButtons(adminMenuContainer, {
            venueSlug,
            apiBase,
            authHeader,
            getItems: () => state.menuItems,
            onUpdated: async () => {
              await renderVendorStream(venueSlug, apiBase, authHeader);
            }
          });
        }
      }
    });
  } catch (error) {
    if (isStaffSessionError(error)) {
      clearStaffSession();
      requestRender("vendor-session-reset");
      return;
    }
    showAppAlert({
      title: shouldOfferDiagnosticReport(error) ? "Oops, that wasn't meant to happen." : "Could not refresh the venue stream.",
      message: normalizeBugError(error).message,
      error,
      source: "vendor-stream",
      reportable: shouldOfferDiagnosticReport(error)
    });
    container.innerHTML = `<section class="unknown">Venue dashboard error: ${escapeHtml(error.message)}</section>`;
    if (adminMenuContainer) {
      adminMenuContainer.innerHTML = "";
    }
  }
}

function renderRunnerDashboardPlaceholder(venueSlug) {
  const venue = VENUES[venueSlug];
  const role = getRole();
  const toolbarButtons =
    role === "runner"
      ? [
          { label: "Stream", action: "route", target: "/runner-stream" },
          { label: "Runner Dashboard", action: "route", target: "/runner", active: true }
        ]
      : [
          { label: "Menu", action: "route", target: "/" },
          { label: "Runner Dashboard", action: "route", target: "/runner", active: true }
        ];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      compact: true,
      contextChip: "RUNNER DASHBOARD",
      toolbarButtons,
      title: "Runner Dashboard",
      copy: "Runner account settings, availability controls, and operational support will live here."
    })}
    <section class="form-card">
      <h2>Runner Dashboard</h2>
      <p>This endpoint is intentionally reserved for the future runner dashboard.</p>
      <p class="api-note">Planned scope: account changes, availability preferences, support settings, and runner-level controls.</p>
      <button class="inline-btn" id="runnerDashboardBackBtn">${role === "runner" ? "Back To Stream" : "Back To Menu"}</button>
    </section>
    ${role === "runner" ? `<section class="hero-tools">${renderStaffSessionButton(venueSlug, role, ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer)}</section>` : ""}
  `;
  bindHeroToolbarButtons();
  document.getElementById("runnerDashboardBackBtn")?.addEventListener("click", () => setRoute(role === "runner" ? "/runner-stream" : "/"));
  document.getElementById("staffLogoutBtn")?.addEventListener("click", () => {
    handleStaffLogout();
  });
}

function renderVendorOpsPlaceholder(venueSlug) {
  const venue = VENUES[venueSlug];
  const vendorDisplayName = getVendorDisplayName(venueSlug);
  const sections = [
    {
      id: "analytics",
      label: "Analytics",
      title: "Analytics",
      body: "Track order volume, vendor performance, and top-selling items from one place.",
      note: "This section will later surface daily trends, category performance, and operational conversion data."
    },
    {
      id: "account",
      label: "Account",
      title: "Account",
      body: "Manage vendor account details, business profile, and commercial settings.",
      note: "Planned scope: vendor name, payout identity, business metadata, and operator contacts."
    },
    {
      id: "refunds",
      label: "Refunds",
      title: "Refunds",
      body: "Review refund history, disputed orders, and refund controls that need seller attention.",
      note: "This will become the vendor-facing refund workspace, while admin retains higher-trust controls."
    },
    {
      id: "security",
      label: "Security",
      title: "Security",
      body: "Control staff access, session hygiene, and protection settings for the vendor account.",
      note: "Planned scope: password or PIN rotation, trusted users, and account security events."
    },
    {
      id: "vendor-support",
      label: "Vendor Support",
      title: "Vendor Support",
      body: "Open support workflows, platform guidance, and issue escalation for the vendor team.",
      note: "This section will house support requests, onboarding guidance, and recovery actions."
    }
  ];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      headingTitle: vendorDisplayName,
      compact: true,
      contextChip: "VENDOR OPS",
      title: "Vendor Operations",
      copy: "Vendor account settings, payment setup, withdrawals, and vendor management will live here."
    })}
    <section class="vendor-ops-shell">
      <nav class="vendor-ops-nav" aria-label="Vendor operations sections">
        ${sections
          .map(
            (section, index) => `
          <button
            class="vendor-ops-nav-btn${index === 0 ? " is-active" : ""}"
            type="button"
            data-vendor-ops-target="${escapeHtml(section.id)}"
          >
            ${escapeHtml(section.label)}
          </button>
        `
          )
          .join("")}
      </nav>
      <section class="vendor-ops-content">
        ${sections
          .map(
            (section, index) => `
          <article
            class="form-card vendor-ops-panel${index === 0 ? " is-active" : ""}"
            data-vendor-ops-panel="${escapeHtml(section.id)}"
          >
            <h2>${escapeHtml(section.title)}</h2>
            <p>${escapeHtml(section.body)}</p>
            <p class="api-note">${escapeHtml(section.note)}</p>
          </article>
        `
          )
          .join("")}
      </section>
    </section>
    <section class="hero-tools">
      <button class="inline-btn ghost" id="vendorOpsBackBtn">Back To Menu</button>
    </section>
  `;
  document.querySelectorAll("[data-vendor-ops-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-vendor-ops-target");
      if (!target) return;
      document.querySelectorAll("[data-vendor-ops-target]").forEach((other) => other.classList.remove("is-active"));
      document.querySelectorAll("[data-vendor-ops-panel]").forEach((panel) => panel.classList.remove("is-active"));
      button.classList.add("is-active");
      document.querySelector(`[data-vendor-ops-panel="${target}"]`)?.classList.add("is-active");
    });
  });
  document.getElementById("vendorOpsBackBtn")?.addEventListener("click", () => setRoute("/"));
}

function renderVenueOpsPlaceholder(venueSlug) {
  const venue = VENUES[venueSlug];
  app.innerHTML = `
    ${renderVenueHero(venue, {
      compact: true,
      contextChip: "VENUE OPS",
      title: "Venue Operations",
      copy: "Account settings, payment setup, withdrawals, and venue management will live here."
    })}
    <section class="form-card">
      <h2>Venue Ops</h2>
      <p>This endpoint is intentionally reserved for the future venue operations dashboard.</p>
      <p class="api-note">Planned scope: account changes, payment settings, withdrawal controls, and venue management.</p>
      <button class="inline-btn" id="venueOpsBackBtn">Back To Menu</button>
    </section>
  `;
  document.getElementById("venueOpsBackBtn")?.addEventListener("click", () => setRoute("/"));
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

  if (isVendorPortalPath()) {
    if (getAuthHeader(venueSlug, "vendor")) {
      window.location.assign(
        buildAppEntryUrl("/menu/", {
          role: "vendor",
          venue: venueSlug,
          api: apiBase
        })
      );
    } else {
      renderVendorAccessPage(apiBase);
    }
    return;
  }

  if (role === "vendor" && route.name === "menu" && !getAuthHeader(venueSlug, "vendor")) {
    renderVendorAccessPage(apiBase);
    return;
  }

  if (role === "runner" && route.name === "menu") {
    if (getAuthHeader(venueSlug, "runner")) {
      setRoute("/runner-stream");
    } else {
      renderRunnerAccessPage(apiBase);
    }
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
    if (role === "runner" && !getAuthHeader(venueSlug, "runner")) {
      renderRunnerAccessPage(apiBase);
      return;
    }
    renderRunnerDashboardPlaceholder(venueSlug);
    return;
  }
  if (route.name === "runner-stream") {
    if (!permissions.runner) {
      renderForbidden(role, "runner-stream", venueSlug, apiBase);
      return;
    }
    let authHeader = getAuthHeader(venueSlug, "runner");
    if (!authHeader) {
      if (role === "runner") {
        renderRunnerAccessPage(apiBase);
        return;
      }
      try {
        const ok = await loginStaff(apiBase, venueSlug, role === "admin" ? "admin" : "runner");
        if (!ok) {
          renderForbidden(role, "runner-stream", venueSlug, apiBase);
          return;
        }
      } catch (error) {
        alert(`Staff login failed: ${error.message}`);
        renderForbidden(role, "runner-stream", venueSlug, apiBase);
        return;
      }
      authHeader = getAuthHeader(venueSlug, "runner");
    }
    await renderRunnerStream(venueSlug, apiBase, authHeader);
    return;
  }
  if (route.name === "venue") {
    if (!permissions.venue) {
      renderForbidden(role, "venue", venueSlug, apiBase);
      return;
    }
    renderVenueOpsPlaceholder(venueSlug);
    return;
  }
  if (route.name === "vendor") {
    if (!permissions.vendor) {
      renderForbidden(role, "vendor", venueSlug, apiBase);
      return;
    }
    renderVendorOpsPlaceholder(venueSlug);
    return;
  }
  if (route.name === "stream") {
    if (!permissions.vendor) {
      renderForbidden(role, "stream", venueSlug, apiBase);
      return;
    }
    let authHeader = getAuthHeader(venueSlug, "vendor");
    if (!authHeader) {
      try {
        const ok = await loginStaff(apiBase, venueSlug, role === "admin" ? "admin" : "vendor");
        if (!ok) {
          renderForbidden(role, "stream", venueSlug, apiBase);
          return;
        }
      } catch (error) {
        alert(`Staff login failed: ${error.message}`);
        renderForbidden(role, "stream", venueSlug, apiBase);
        return;
      }
      authHeader = getAuthHeader(venueSlug, "vendor");
    }
    await renderVendorStream(venueSlug, apiBase, authHeader);
    return;
  }

  await renderVenueMenu(venueSlug, venue, role, apiBase);
}

window.addEventListener("hashchange", () => {
  requestRender("hashchange");
});

window.addEventListener("error", (event) => {
  handleUnexpectedError(event.error || new Error(event.message || "Unexpected browser error"), "window-error");
});

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  handleUnexpectedError(event.reason, "unhandled-rejection");
});

window.alert = (message) => {
  showAppAlert({
    title: "That action didn't complete.",
    message: String(message || "Please try again."),
    source: "alert",
    reportable: true
  });
};

requestRender("startup");
