import { VENUES } from "./data/venues.js";

const app = document.getElementById("app");
const STAFF_SESSION_KEY = "drinq_staff_session";
// DEV ONLY: local staff PIN flow is enabled for prototype testing.
// Replace with proper auth before production.

const ROLE_PERMISSIONS = {
  customer: { runner: false, venue: false },
  runner: { runner: true, venue: false },
  venue: { runner: false, venue: true },
  admin: { runner: true, venue: true }
};

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
  return "http://localhost:8000";
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

function renderVenueMenu(venueSlug, venue, role, apiBase) {
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.customer;
  const runnerAuth = getAuthHeader(venueSlug, "runner");
  const venueAuth = getAuthHeader(venueSlug, "venue");
  const canRunner = permissions.runner && Boolean(runnerAuth);
  const canVenue = permissions.venue && Boolean(venueAuth);
  const cart = readCart(venueSlug);
  const count = itemCount(cart);
  const total = formatPennies(totalPennies(cart));

  app.innerHTML = `
    <section class="hero">
      <span class="brand-chip">${venue.tag}</span>
      <h1 class="venue-title">${venue.name}</h1>
      <p class="venue-copy">${venue.subtitle}</p>
      <div class="modes">
        ${venue.fulfillmentModes
          .map(
            (m) => `
          <article class="mode">
            <h4>${m.label} - ${m.fee}</h4>
            <p><b>${m.eta}</b><br />${m.detail}</p>
          </article>`
          )
          .join("")}
      </div>
    </section>

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
          <button class="add-btn" data-add-id="${item.id}">Add To Cart</button>
        </article>`
        )
        .join("")}
    </section>

    <section class="cart-mini">
      Cart: <strong>${count} item${count === 1 ? "" : "s"}</strong> · ${total}
      <button class="inline-btn" id="goCheckoutBtn" ${count === 0 ? "disabled" : ""}>Go To Checkout</button>
      ${canVenue ? `<button class="inline-btn ghost" id="goVenueBtn">Venue Ops</button>` : ""}
      ${canRunner ? `<button class="inline-btn ghost" id="goRunnerBtn">Runner Dashboard</button>` : ""}
      ${permissions.runner || permissions.venue ? `<button class="inline-btn ghost" id="staffLoginBtn">Staff Login</button>` : ""}
      ${permissions.runner || permissions.venue ? `<button class="inline-btn ghost" id="staffLogoutBtn">Logout</button>` : ""}
      <button class="inline-btn ghost" id="clearCartBtn" ${count === 0 ? "disabled" : ""}>Clear</button>
    </section>
  `;

  const addButtons = document.querySelectorAll("[data-add-id]");
  addButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = btn.getAttribute("data-add-id");
      const menuItem = venue.menuItems.find((x) => x.id === itemId);
      if (!menuItem) return;
      addItemToCart(venueSlug, menuItem);
      renderVenueMenu(venueSlug, venue, role, apiBase);
    });
  });

  const goCheckoutBtn = document.getElementById("goCheckoutBtn");
  if (goCheckoutBtn) {
    goCheckoutBtn.addEventListener("click", () => setRoute("/checkout"));
  }

  const clearCartBtn = document.getElementById("clearCartBtn");
  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      clearCart(venueSlug);
      renderVenueMenu(venueSlug, venue, role, apiBase);
    });
  }

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

function renderCheckout(venueSlug, venue, apiBase) {
  const cart = readCart(venueSlug);
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
      <form id="checkoutForm">
        <label>Name</label>
        <input name="name" required placeholder="Your name" />

        <label>Email</label>
        <input name="email" required type="email" placeholder="name@email.com" />

        <label>Delivery Mode</label>
        <select name="deliveryMode" required>
          ${venue.fulfillmentModes.map((m) => `<option value="${m.label}">${m.label} (${m.eta}, ${m.fee})</option>`).join("")}
        </select>

        <label>Seat / Pickup Point</label>
        <input name="deliveryTarget" required placeholder="E.g. Block N220, Row 6, Seat 121" />

        <label class="checkbox">
          <input type="checkbox" name="mailingList" checked />
          Add me to venue updates (mailing list)
        </label>

        <button class="add-btn" type="submit">Pay & Place Order</button>
        <button class="inline-btn ghost" type="button" id="backMenuBtn">Back To Menu</button>
      </form>
      <p class="api-note">API: ${escapeHtml(apiBase)}</p>
      <p id="checkoutMsg" class="status-msg"></p>
    </section>
  `;

  document.getElementById("backMenuBtn")?.addEventListener("click", () => setRoute("/"));

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
    const mailingList = Boolean(formData.get("mailingList"));

    try {
      if (mailingList) {
        await fetch(`${apiBase}/api/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            venue_slug: venueSlug
          })
        });
      }

      const orderRes = await fetch(`${apiBase}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          }))
        })
      });

      if (!orderRes.ok) {
        throw new Error(`Order failed (${orderRes.status})`);
      }

      const orderData = await orderRes.json();
      clearCart(venueSlug);
      setRoute(`/order-status/${orderData.order_id}`);
    } catch (error) {
      message.textContent = `Error: ${error.message}`;
      message.className = "status-msg error";
    }
  });
}

async function renderOrderStatus(venueSlug, orderId, apiBase) {
  app.innerHTML = `
    <section class="hero">
      <span class="brand-chip">ORDER STATUS</span>
      <h1 class="venue-title">Order #${orderId}</h1>
      <p class="venue-copy">Fetching latest status...</p>
    </section>
  `;

  try {
    const res = await fetch(`${apiBase}/api/order-status/${orderId}`);
    if (!res.ok) {
      throw new Error(`Not found (${res.status})`);
    }
    const data = await res.json();
    const isFulfilled = data.status === "fulfilled";
    app.innerHTML = `
      <section class="hero">
        <span class="brand-chip">ORDER STATUS</span>
        <h1 class="venue-title">Order #${data.order_id}</h1>
        <p class="venue-copy">Status: <strong>${escapeHtml(data.status)}</strong> · ETA: ${escapeHtml(data.eta_text)}</p>
      </section>

      ${
        isFulfilled
          ? `
      <section class="form-card completion-card">
        <h2>Order Complete</h2>
        <p>Your order has been fulfilled. Enjoy your drink.</p>
        <button class="inline-btn" id="tipRunnerBtn">Tip Runner</button>
        <button class="inline-btn ghost" id="reorderBtn">Reorder</button>
      </section>
      `
          : ""
      }

      <section class="form-card">
        <h2>Delivery</h2>
        <p><strong>Mode:</strong> ${escapeHtml(data.delivery_mode)}</p>
        <p><strong>Target:</strong> ${escapeHtml(data.delivery_target)}</p>
        <p><strong>Customer:</strong> ${escapeHtml(data.customer_name)} (${escapeHtml(data.customer_email)})</p>
      </section>

      <section class="form-card">
        <h2>Items</h2>
        <ul class="summary-list">
          ${data.items
            .map((item) => `<li>${escapeHtml(item.item_name)} x${item.quantity}<span>${escapeHtml(item.price_text)}</span></li>`)
            .join("")}
        </ul>
      </section>

      <section class="form-card">
        <button class="inline-btn" id="refreshStatusBtn">Refresh Status</button>
        <button class="inline-btn ghost" id="backToMenuBtn">Back To Menu</button>
      </section>
    `;

    document.getElementById("refreshStatusBtn")?.addEventListener("click", () => {
      renderOrderStatus(venueSlug, orderId, apiBase);
    });
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => setRoute("/"));
    document.getElementById("tipRunnerBtn")?.addEventListener("click", () => {
      alert("Thanks. Tip flow placeholder for prototype.");
    });
    document.getElementById("reorderBtn")?.addEventListener("click", () => {
      const reordered = (data.items || []).map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name,
        price_text: item.price_text,
        price_pennies: parsePriceToPennies(item.price_text),
        quantity: Number(item.quantity) || 1
      }));
      writeCart(venueSlug, reordered);
      setRoute("/checkout");
    });
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

function runnerStatusButtons(orderId) {
  return `
    <div class="runner-actions">
      <button class="inline-btn status-btn" data-order-id="${orderId}" data-status="assigned">Assign</button>
      <button class="inline-btn status-btn" data-order-id="${orderId}" data-status="loaded">Loaded</button>
      <button class="inline-btn status-btn" data-order-id="${orderId}" data-status="en_route">En Route</button>
      <button class="inline-btn status-btn" data-order-id="${orderId}" data-status="arrived">Arrived</button>
      <button class="inline-btn status-btn" data-order-id="${orderId}" data-status="fulfilled">Fulfilled</button>
      <button class="inline-btn ghost status-btn" data-order-id="${orderId}" data-status="cancelled">Cancel</button>
    </div>
  `;
}

function venueStatusButtons(orderId, status) {
  const canAccept = status === "received";
  const canReject = status === "received";
  const canReady = status === "accepted";
  return `
    <div class="runner-actions">
      <button class="inline-btn venue-action-btn" data-action="accept" data-order-id="${orderId}" ${canAccept ? "" : "disabled"}>Accept</button>
      <button class="inline-btn ghost venue-action-btn" data-action="reject" data-order-id="${orderId}" ${canReject ? "" : "disabled"}>Reject</button>
      <button class="inline-btn venue-action-btn" data-action="ready" data-order-id="${orderId}" ${canReady ? "" : "disabled"}>Mark Ready</button>
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
  app.innerHTML = `
    <section class="hero">
      <span class="brand-chip">RUNNER DASHBOARD</span>
      <h1 class="venue-title">Live Orders</h1>
      <p class="venue-copy">Venue: ${escapeHtml(venueSlug)} · API: ${escapeHtml(apiBase)}</p>
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
    const res = await fetch(`${apiBase}/api/orders?venue_slug=${encodeURIComponent(venueSlug)}&limit=50`, {
      headers: { Authorization: authHeader }
    });
    if (!res.ok) {
      throw new Error(`Could not fetch orders (${res.status})`);
    }
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
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
          ${runnerStatusButtons(order.order_id)}
          <a class="runner-link" href="#/order-status/${order.order_id}">Open order status page</a>
        </article>
      `
      )
      .join("");

    const statusButtons = document.querySelectorAll(".status-btn");
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
  } catch (error) {
    container.innerHTML = `<section class="unknown">Runner dashboard error: ${escapeHtml(error.message)}</section>`;
  }
}

async function renderVenueDashboard(venueSlug, apiBase, authHeader) {
  app.innerHTML = `
    <section class="hero">
      <span class="brand-chip">VENUE OPS</span>
      <h1 class="venue-title">Order Management</h1>
      <p class="venue-copy">Venue: ${escapeHtml(venueSlug)} · API: ${escapeHtml(apiBase)}</p>
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
    const res = await fetch(`${apiBase}/api/orders?venue_slug=${encodeURIComponent(venueSlug)}&limit=50`, {
      headers: { Authorization: authHeader }
    });
    if (!res.ok) {
      throw new Error(`Could not fetch orders (${res.status})`);
    }
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
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
          ${venueStatusButtons(order.order_id, order.status)}
          <a class="runner-link" href="#/order-status/${order.order_id}">Open order status page</a>
        </article>
      `
      )
      .join("");

    const actionButtons = document.querySelectorAll(".venue-action-btn");
    actionButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const orderId = btn.getAttribute("data-order-id");
        const action = btn.getAttribute("data-action");
        if (!orderId || !action) return;
        btn.disabled = true;
        try {
          const endpoint = `${apiBase}/api/orders/${orderId}/${action}`;
          const update = await fetch(endpoint, { method: "POST", headers: { Authorization: authHeader } });
          if (!update.ok) {
            throw new Error(`Action failed (${update.status})`);
          }
          renderVenueDashboard(venueSlug, apiBase);
        } catch (error) {
          alert(`Could not perform venue action: ${error.message}`);
          btn.disabled = false;
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<section class="unknown">Venue dashboard error: ${escapeHtml(error.message)}</section>`;
  }
}

async function render() {
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
    await renderOrderStatus(venueSlug, route.orderId, apiBase);
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

  renderVenueMenu(venueSlug, venue, role, apiBase);
}

window.addEventListener("hashchange", () => {
  render();
});

render();
