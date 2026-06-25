const USERS = {
  MASTER: { password: "MASTER0022", role: "MASTER" },
  VENDEDOR: { password: "0022", role: "VENDEDOR" },
};

const UPDATE_WORKFLOW_URL =
  "https://github.com/limpmixpitanga/CatalogoOnlineLimpMixV2/actions/workflows/sync-products.yml";

const STORAGE = {
  cart: "limpmix-v2-cart",
  view: "limpmix-v2-view",
  cache: "limpmix-v2-products-cache",
  session: "limpmix-v2-session",
};

const state = {
  products: [],
  filtered: [],
  categories: [],
  cart: new Map(),
  role: null,
  category: "",
  view: localStorage.getItem(STORAGE.view) || "medium",
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const number = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

const els = {
  syncState: document.querySelector("#syncState"),
  updateProducts: document.querySelector("#updateProducts"),
  loginToggle: document.querySelector("#loginToggle"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  loginUser: document.querySelector("#loginUser"),
  loginPass: document.querySelector("#loginPass"),
  loginFeedback: document.querySelector("#loginFeedback"),
  logoutButton: document.querySelector("#logoutButton"),
  masterStats: document.querySelector("#masterStats"),
  visibleProducts: document.querySelector("#visibleProducts"),
  visibleStock: document.querySelector("#visibleStock"),
  searchInput: document.querySelector("#searchInput"),
  sortBy: document.querySelector("#sortBy"),
  categoryList: document.querySelector("#categoryList"),
  clearCategory: document.querySelector("#clearCategory"),
  activeCategory: document.querySelector("#activeCategory"),
  resultCount: document.querySelector("#resultCount"),
  productGrid: document.querySelector("#productGrid"),
  emptyState: document.querySelector("#emptyState"),
  productTemplate: document.querySelector("#productTemplate"),
  viewButtons: document.querySelectorAll("[data-view]"),
  quotePanel: document.querySelector("#quotePanel"),
  quoteToggle: document.querySelector("#quoteToggle"),
  quoteCount: document.querySelector("#quoteCount"),
  quoteItems: document.querySelector("#quoteItems"),
  quoteTotalRow: document.querySelector("#quoteTotalRow"),
  quoteTotal: document.querySelector("#quoteTotal"),
  sendWhatsApp: document.querySelector("#sendWhatsApp"),
  clearQuote: document.querySelector("#clearQuote"),
};

init();

async function init() {
  bindEvents();
  restoreSession();
  restoreCart();
  applyView(state.view);
  await loadProducts();
  buildCategories();
  applyFilters();
  renderQuote();
  renderAuth();
}

function bindEvents() {
  els.loginToggle.addEventListener("click", () => {
    els.loginPanel.hidden = !els.loginPanel.hidden;
  });
  els.loginForm.addEventListener("submit", handleLogin);
  els.logoutButton.addEventListener("click", logout);
  els.updateProducts.addEventListener("click", () => {
    window.open(UPDATE_WORKFLOW_URL, "_blank", "noopener");
  });
  els.searchInput.addEventListener("input", applyFilters);
  els.sortBy.addEventListener("change", applyFilters);
  els.clearCategory.addEventListener("click", () => {
    state.category = "";
    applyFilters();
  });
  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => applyView(button.dataset.view));
  });
  els.quoteToggle.addEventListener("click", () => {
    els.quotePanel.classList.toggle("minimized");
  });
  els.clearQuote.addEventListener("click", () => {
    state.cart.clear();
    persistCart();
    renderQuote();
  });
  els.sendWhatsApp.addEventListener("click", sendWhatsApp);
}

async function loadProducts() {
  try {
    const response = await fetch("data/products.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    localStorage.setItem(STORAGE.cache, JSON.stringify(payload));
    loadPayload(payload);
  } catch (error) {
    const cached = localStorage.getItem(STORAGE.cache);
    if (!cached) {
      state.products = [];
      els.syncState.textContent = "Nao foi possivel carregar produtos";
      console.error(error);
      return;
    }
    loadPayload(JSON.parse(cached), true);
  }
}

function loadPayload(payload, fromCache = false) {
  const sourceProducts = Array.isArray(payload.products) ? payload.products : [];
  state.products = sourceProducts.filter((product) => safeStock(product.stock) > 0);
  const when = payload.updatedAt
    ? new Date(payload.updatedAt).toLocaleString("pt-BR")
    : "sem data";
  els.syncState.textContent = fromCache
    ? `Cache local: ${when}`
    : `Atualizado: ${when}`;
}

function buildCategories() {
  const categories = new Set();
  for (const product of state.products) {
    const category = product.category || "Sem categoria";
    categories.add(category);
  }
  state.categories = [...categories].sort((a, b) => a.localeCompare(b, "pt-BR"));
  renderCategories();
}

function renderCategories() {
  els.categoryList.replaceChildren();
  for (const category of state.categories) {
    const count = state.products.filter((item) => item.category === category).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = category === state.category ? "active" : "";
    button.innerHTML = `<span></span><strong>${count}</strong>`;
    button.querySelector("span").textContent = category;
    button.addEventListener("click", () => {
      state.category = category;
      applyFilters();
    });
    els.categoryList.appendChild(button);
  }
}

function applyFilters() {
  const terms = normalize(els.searchInput.value).split(" ").filter(Boolean);

  state.filtered = state.products.filter((product) => {
    const haystack = normalize(
      [
        product.name,
        product.code,
        product.barcode,
        product.category,
        product.description,
      ].join(" ")
    );
    const matchesTerms = terms.every((term) => haystack.includes(term));
    const matchesCategory = !state.category || product.category === state.category;
    return matchesTerms && matchesCategory;
  });

  sortProducts(state.filtered, els.sortBy.value);
  renderCategories();
  renderProducts();
  renderStats();
}

function sortProducts(products, mode) {
  const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");
  products.sort((a, b) => {
    if (mode === "code") return String(a.code).localeCompare(String(b.code));
    if (mode === "stockDesc") return safeStock(b.stock) - safeStock(a.stock) || byName(a, b);
    if (mode === "priceAsc") return safePrice(a.price) - safePrice(b.price) || byName(a, b);
    if (mode === "priceDesc") return safePrice(b.price) - safePrice(a.price) || byName(a, b);
    return byName(a, b);
  });
}

function renderProducts() {
  els.productGrid.replaceChildren();
  els.emptyState.hidden = state.filtered.length > 0;
  els.resultCount.textContent = `${state.filtered.length} produtos`;
  els.activeCategory.textContent = state.category || "Todas as categorias";

  const fragment = document.createDocumentFragment();
  for (const product of state.filtered) {
    const card = els.productTemplate.content.firstElementChild.cloneNode(true);
    const image = card.querySelector("[data-photo]");
    const fallback = card.querySelector("[data-fallback]");

    image.alt = product.name;
    fallback.textContent = initials(product.name);
    if (product.imageUrl) {
      image.src = product.imageUrl;
      image.addEventListener("error", () => {
        image.removeAttribute("src");
        card.classList.add("no-photo");
      });
    } else {
      card.classList.add("no-photo");
    }

    card.querySelector("[data-code]").textContent = product.code
      ? `SKU ${product.code}`
      : "SKU nao informado";
    card.querySelector("[data-name]").textContent = product.name;
    card.querySelector("[data-category]").textContent =
      product.category || "Sem categoria";
    card.querySelector("[data-barcode]").textContent =
      product.barcode || "Nao informado";
    card.querySelector("[data-stock]").textContent = number.format(safeStock(product.stock));
    card.querySelector("[data-price]").textContent = canSeePrices()
      ? money.format(safePrice(product.price))
      : "Valor restrito";
    card.querySelector("[data-add]").addEventListener("click", () => {
      addToQuote(product.id);
    });
    fragment.appendChild(card);
  }
  els.productGrid.appendChild(fragment);
}

function renderStats() {
  const totalStock = state.filtered.reduce((sum, item) => sum + safeStock(item.stock), 0);
  els.visibleProducts.textContent = state.filtered.length;
  els.visibleStock.textContent = number.format(totalStock);
  els.masterStats.hidden = state.role !== "MASTER";
}

function addToQuote(productId) {
  const id = String(productId);
  const product = state.products.find((item) => String(item.id) === id);
  if (!product) return;
  const nextQty = (state.cart.get(id) || 0) + 1;
  state.cart.set(id, Math.min(nextQty, Math.floor(safeStock(product.stock))));
  persistCart();
  renderQuote();
  els.quotePanel.classList.add("minimized");
}

function renderQuote() {
  els.quoteItems.replaceChildren();
  const entries = cartEntries();
  const itemCount = entries.reduce((sum, item) => sum + item.qty, 0);
  const total = entries.reduce(
    (sum, item) => sum + safePrice(item.product.price) * item.qty,
    0
  );

  els.quoteCount.textContent = `${itemCount} ${itemCount === 1 ? "item" : "itens"}`;
  els.quoteTotal.textContent = money.format(total);
  els.quoteTotalRow.hidden = state.role !== "MASTER";

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Nenhum produto no orcamento.";
    els.quoteItems.appendChild(empty);
    return;
  }

  for (const { product, qty } of entries) {
    const row = document.createElement("div");
    row.className = "quote-row";
    row.innerHTML = `
      <strong></strong>
      <small></small>
      <div class="qty-controls">
        <button type="button" data-dec>-</button>
        <span>${qty}</span>
        <button type="button" data-inc>+</button>
        <button class="remove" type="button" data-remove>Remover</button>
      </div>
    `;
    row.querySelector("strong").textContent = product.name;
    row.querySelector("small").textContent = canSeePrices()
      ? `${money.format(safePrice(product.price))} cada`
      : "Valor restrito";
    row.querySelector("[data-dec]").addEventListener("click", () => setQty(product.id, qty - 1));
    row.querySelector("[data-inc]").addEventListener("click", () => setQty(product.id, qty + 1));
    row.querySelector("[data-remove]").addEventListener("click", () => setQty(product.id, 0));
    els.quoteItems.appendChild(row);
  }
}

function setQty(productId, qty) {
  const id = String(productId);
  const product = state.products.find((item) => String(item.id) === id);
  if (!product || qty <= 0) state.cart.delete(id);
  else state.cart.set(id, Math.min(qty, Math.floor(safeStock(product.stock))));
  persistCart();
  renderQuote();
}

function sendWhatsApp() {
  const entries = cartEntries();
  if (entries.length === 0) return;

  const lines = entries.map(({ product, qty }) => {
    const parts = [
      `${qty}x ${product.name}`,
      product.code ? `SKU ${product.code}` : "",
      product.barcode ? `EAN ${product.barcode}` : "",
      canSeePrices() ? money.format(safePrice(product.price)) : "",
    ].filter(Boolean);
    return `- ${parts.join(" | ")}`;
  });

  const total = entries.reduce(
    (sum, item) => sum + safePrice(item.product.price) * item.qty,
    0
  );
  const message = [
    "Ola, gostaria de fazer um orcamento:",
    "",
    ...lines,
    state.role === "MASTER" ? "" : null,
    state.role === "MASTER" ? `Total: ${money.format(total)}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

function handleLogin(event) {
  event.preventDefault();
  const user = normalize(els.loginUser.value).toUpperCase();
  const password = els.loginPass.value.trim();
  const match = USERS[user];

  if (!match || match.password !== password) {
    els.loginFeedback.textContent = "Usuario ou senha invalidos.";
    return;
  }

  state.role = match.role;
  sessionStorage.setItem(STORAGE.session, state.role);
  els.loginPass.value = "";
  els.loginFeedback.textContent = `Acesso ${state.role}`;
  renderAuth();
  renderProducts();
  renderQuote();
  renderStats();
}

function logout() {
  state.role = null;
  sessionStorage.removeItem(STORAGE.session);
  els.loginFeedback.textContent = "";
  renderAuth();
  renderProducts();
  renderQuote();
  renderStats();
}

function renderAuth() {
  const logged = Boolean(state.role);
  els.loginToggle.textContent = logged ? state.role : "Entrar";
  els.logoutButton.hidden = !logged;
  els.updateProducts.hidden = state.role !== "MASTER";
  els.loginForm.querySelector(".primary-button").hidden = logged;
  els.loginUser.disabled = logged;
  els.loginPass.disabled = logged;
}

function restoreSession() {
  const role = sessionStorage.getItem(STORAGE.session);
  if (role === "MASTER" || role === "VENDEDOR") state.role = role;
}

function canSeePrices() {
  return state.role === "MASTER" || state.role === "VENDEDOR";
}

function cartEntries() {
  return [...state.cart.entries()]
    .map(([id, qty]) => ({
      product: state.products.find((item) => String(item.id) === id),
      qty,
    }))
    .filter((entry) => entry.product && entry.qty > 0);
}

function applyView(view) {
  state.view = view;
  localStorage.setItem(STORAGE.view, view);
  els.productGrid.className = `product-grid view-${view}`;
  els.viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function persistCart() {
  localStorage.setItem(STORAGE.cart, JSON.stringify([...state.cart]));
}

function restoreCart() {
  try {
    state.cart = new Map(JSON.parse(localStorage.getItem(STORAGE.cart)) || []);
  } catch {
    state.cart = new Map();
  }
}

function safePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? price : 0;
}

function safeStock(value) {
  const stock = Number(value);
  return Number.isFinite(stock) ? stock : 0;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function initials(name) {
  return String(name || "LM")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
