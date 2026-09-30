const form = document.getElementById("recommend-form");
const output = document.getElementById("output");
const connectionStatus = document.getElementById("connection-status");
const connectButton = document.getElementById("connect-swiggy");
const addressPanel = document.getElementById("address-panel");
const addressSelect = document.getElementById("address");
const moreAddresses = document.getElementById("more-addresses");
const retryAddresses = document.getElementById("retry-addresses");
const recommendButton = form.querySelector('button[type="submit"]');
const placeOrderButton = document.getElementById("place-order");
const recommendationCard = document.getElementById("recommendation-card");
const paymentMethodSelect = document.getElementById("payment-method");
const recRestaurant = document.getElementById("rec-restaurant");
const recItems = document.getElementById("rec-items");
const recSubtotal = document.getElementById("rec-subtotal");
const recCoupon = document.getElementById("rec-coupon");
const recFinal = document.getElementById("rec-final");
const recExplanation = document.getElementById("rec-explanation");
let addressState = "idle";
let addressError = "";
let authenticated = false;
let mode;
let latestRecommendation = null;
recommendButton.disabled = true;
let addressPage = 0;

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      authenticated = false;
      recommendButton.disabled = true;
      connectButton.hidden = false;
      addressPanel.hidden = true;
      connectionStatus.textContent = "Your Swiggy session expired. Connect again.";
    }
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function updateRecommendButton() {
  recommendButton.disabled = !mode || (mode === "live" && (!authenticated || addressState !== "ready" || !addressSelect.value));
}

async function loadAddresses() {
  addressState = "loading";
  addressError = "";
  retryAddresses.hidden = true;
  moreAddresses.disabled = true;
  connectionStatus.textContent = "Swiggy connected. Loading saved delivery addresses…";
  updateRecommendButton();
  try {
    const data = await request(`/api/addresses?page=${addressPage + 1}`);
    addressPage = data.pagination.page;
    for (const address of data.addresses) {
      if (Array.from(addressSelect.options).some((option) => option.value === address.id)) continue;
      const option = document.createElement("option");
      option.value = address.id;
      option.textContent = `${address.addressTag || address.addressCategory || "Address"}: ${address.addressLine}`;
      addressSelect.append(option);
    }
    moreAddresses.hidden = !data.pagination.hasMore;
    addressPanel.hidden = false;
    addressState = addressSelect.options.length > 1 ? "ready" : "empty";
    connectionStatus.textContent = addressState === "ready"
      ? "Swiggy connected. Choose a delivery address."
      : "No saved addresses. Add one in the Swiggy app, then retry loading addresses.";
    retryAddresses.hidden = addressState !== "empty";
    output.textContent = addressState === "ready" ? "Choose a delivery address to get a recommendation." : connectionStatus.textContent;
  } catch (error) {
    addressState = "error";
    addressError = error.message;
    if (authenticated) connectionStatus.textContent = "Swiggy connected, but delivery addresses could not be loaded.";
    output.textContent = addressError;
    retryAddresses.hidden = !authenticated;
  } finally {
    moreAddresses.disabled = false;
    updateRecommendButton();
  }
}
addressSelect.addEventListener("change", updateRecommendButton);
retryAddresses.addEventListener("click", () => { void loadAddresses(); });

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    const { authorizeUrl } = await request("/api/mcp/auth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    window.location.assign(authorizeUrl);
  } catch (error) {
    output.textContent = error.message;
    connectButton.disabled = false;
  }
});
moreAddresses.addEventListener("click", async () => {
  moreAddresses.disabled = true;
  try { await loadAddresses(); } catch (error) { output.textContent = error.message; }
  finally { moreAddresses.disabled = false; }
});

async function init() {
  const status = await request("/api/mcp/status");
  mode = status.mode;
  authenticated = status.authenticated;
  if (mode === "mock") {
    connectionStatus.textContent = "Demo mode — sample restaurants and coupons. Set USE_MOCK_MCP=false and restart to connect Swiggy.";
    updateRecommendButton();
    return;
  }
  connectButton.hidden = status.authenticated;
  connectionStatus.textContent = status.authenticated ? "Swiggy connected. Choose a delivery address." : "Connect Swiggy to search live restaurants.";
  if (status.authenticated) await loadAddresses();
}
void init().catch((error) => { output.textContent = error.message; });

function renderRecommendation(data) {
  const rec = data?.recommendation;
  latestRecommendation = rec && rec.restaurant && rec.restaurant !== "No matching restaurant found" ? rec : null;
  if (!rec || !rec.restaurant) {
    recommendationCard.hidden = true;
    return;
  }

  recRestaurant.textContent = rec.restaurant;
  recItems.textContent = rec.items.length ? rec.items.join(", ") : "No item match";
  recSubtotal.textContent = `₹${Number(rec.subtotal ?? 0).toLocaleString("en-IN")}`;
  recCoupon.textContent = rec.coupon || "None";
  recFinal.textContent = `₹${Number(rec.finalPrice ?? 0).toLocaleString("en-IN")}`;
  recExplanation.textContent = rec.explanation || "Best available deal found.";
  recommendationCard.hidden = false;
  placeOrderButton.hidden = !latestRecommendation;
}

async function placeBestDealOrder() {
  if (!latestRecommendation || !addressSelect.value) {
    output.textContent = mode === "live" ? "Choose a saved delivery address before placing the order." : "Address selection is not required in demo mode.";
    return;
  }
  placeOrderButton.disabled = true;
  output.textContent = "Placing order…";
  try {
    const result = await request("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addressId: addressSelect.value,
        paymentMethod: paymentMethodSelect.value,
        restaurantName: latestRecommendation.restaurant,
        confirm: true,
      }),
    });
    output.textContent = JSON.stringify({ ok: true, order: result }, null, 2);
  } catch (error) {
    output.textContent = error.message;
  } finally {
    placeOrderButton.disabled = false;
  }
}

placeOrderButton.addEventListener("click", () => { void placeBestDealOrder(); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!mode) { output.textContent = "Wait for the connection check, or reload the page."; return; }
  if (mode === "live" && (!addressSelect.value || addressPanel.hidden)) {
    output.textContent = !authenticated ? "Connect Swiggy first."
      : addressState === "error" ? addressError
      : addressState === "loading" ? "Your delivery addresses are still loading."
      : "Choose a saved delivery address first.";
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  output.textContent = "Searching…";
  try {
    const data = await request("/api/recommend", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: document.getElementById("query").value,
        addressId: mode === "live" ? addressSelect.value : undefined,
        budget: Number(document.getElementById("budget").value),
        quantity: Number(document.getElementById("quantity").value),
        premium: document.getElementById("premium").value === "true",
        dislikes: document.getElementById("dislikes").value.split(",").map((v) => v.trim()).filter(Boolean),
        deliveryTimeWeight: 1,
      }),
    });
    renderRecommendation(data);
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) { output.textContent = error.message; }
  finally { updateRecommendButton(); }
});
