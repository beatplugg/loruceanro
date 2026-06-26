// ── State ─────────────────────────────────────────────────────────────────────
let token    = localStorage.getItem("token") || null;
let userInfo = JSON.parse(localStorage.getItem("userInfo") || "null");
let cart     = JSON.parse(localStorage.getItem("cart") || "[]");

// ── JWT decode ────────────────────────────────────────────────────────────────
function parseJwt(t) {
  try {
    return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return {}; }
}

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
  async req(method, path, body = null, auth = false) {
    const headers = {};
    if (body && !(body instanceof URLSearchParams)) headers["Content-Type"] = "application/json";
    if (auth && token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(path, {
      method,
      headers,
      body: body instanceof URLSearchParams ? body : body ? JSON.stringify(body) : null,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(Array.isArray(err.detail) ? err.detail[0]?.msg : err.detail || "Помилка");
    }
    return res.status === 204 ? null : res.json();
  },
  get:    (p, a)    => api.req("GET",    p, null, a),
  post:   (p, b, a) => api.req("POST",   p, b, a),
  put:    (p, b, a) => api.req("PUT",    p, b, a),
  patch:  (p, b, a) => api.req("PATCH",  p, b, a),
  delete: (p, a)    => api.req("DELETE", p, null, a),

  async loginForm(email, password) {
    const res = await fetch("/api/users/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password }),
    });
    if (!res.ok) throw new Error("Невірний email або пароль");
    return res.json();
  },
};

// ── Auth ──────────────────────────────────────────────────────────────────────
async function doLogin(e) {
  e.preventDefault();
  const f = e.target;
  try {
    const data = await api.loginForm(f.email.value, f.password.value);
    await applyToken(data.access_token);
    navigate("catalog");
  } catch (err) { showAuthError(err.message); }
}

async function doRegister(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await api.post("/api/users/register", { name: f.name.value, email: f.email.value, password: f.password.value });
    const data = await api.loginForm(f.email.value, f.password.value);
    await applyToken(data.access_token);
    navigate("catalog");
  } catch (err) { showAuthError(err.message); }
}

async function applyToken(t) {
  token = t;
  localStorage.setItem("token", t);
  const me = await api.get("/api/users/me", true);
  userInfo = me;
  localStorage.setItem("userInfo", JSON.stringify(me));
  setAuthState(true);
}

function logout() {
  token = null; userInfo = null; cart = [];
  localStorage.removeItem("token");
  localStorage.removeItem("userInfo");
  saveCart();
  setAuthState(false);
  navigate("login");
}

function setAuthState(loggedIn) {
  const isAdmin = loggedIn && userInfo?.is_admin;
  document.querySelectorAll(".auth-only").forEach(el  => el.classList.toggle("hidden", !loggedIn));
  document.querySelectorAll(".auth-hide").forEach(el  => el.classList.toggle("hidden", loggedIn));
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin));
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function switchTab(tab) {
  document.getElementById("form-login").classList.toggle("hidden",    tab !== "login");
  document.getElementById("form-register").classList.toggle("hidden", tab !== "register");
  document.getElementById("tab-login").classList.toggle("active",     tab === "login");
  document.getElementById("tab-register").classList.toggle("active",  tab === "register");
  document.getElementById("auth-error").classList.add("hidden");
}

// ── Routing ───────────────────────────────────────────────────────────────────
const PAGES = ["login", "catalog", "orders", "profile", "admin"];

function navigate(page) {
  PAGES.forEach(p => document.getElementById(`page-${p}`).classList.add("hidden"));
  const guard = { orders: true, profile: true, admin: true };
  if (guard[page] && !token) { navigate("login"); return; }
  if (page === "admin" && !userInfo?.is_admin) { navigate("catalog"); return; }
  document.getElementById(`page-${page}`).classList.remove("hidden");
  if (page === "catalog") loadCatalog();
  if (page === "orders")  loadOrders();
  if (page === "profile") loadProfile();
  if (page === "admin")   loadAdmin();
}

window.addEventListener("hashchange", () => {
  const page = location.hash.replace("#", "") || "catalog";
  navigate(PAGES.includes(page) ? page : "catalog");
});

document.querySelectorAll("a[href^='#']").forEach(a => {
  a.addEventListener("click", e => {
    e.preventDefault();
    const page = a.getAttribute("href").replace("#", "");
    location.hash = page;
  });
});

// ── Catalog ───────────────────────────────────────────────────────────────────
let searchTimer;
let activeCatId = null;

async function loadCatalog() {
  await loadCategories();
  await loadProducts(null);
}

async function loadCategories() {
  const cats = await api.get("/api/catalog/categories");
  document.getElementById("categories").innerHTML = cats.map(c =>
    `<button onclick="loadProducts(${c.id})" class="chip" data-id="${c.id}">${c.name}</button>`
  ).join("");
}

async function loadProducts(categoryId) {
  activeCatId = categoryId;
  document.querySelectorAll(".chip").forEach(b => b.classList.remove("active"));
  const btn = categoryId
    ? document.querySelector(`.chip[data-id="${categoryId}"]`)
    : document.getElementById("cat-all");
  if (btn) btn.classList.add("active");

  const search = document.getElementById("search-input")?.value || "";
  let url = `/api/catalog/products?limit=100`;
  if (categoryId) url += `&category_id=${categoryId}`;
  if (search)     url += `&search=${encodeURIComponent(search)}`;

  const products = await api.get(url);
  renderProducts(products);
}

function renderProducts(products) {
  const grid = document.getElementById("products-grid");
  if (!products.length) {
    grid.innerHTML = `<p class="col-span-4 text-center text-gray-400 py-16">Нічого не знайдено</p>`;
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="product-card">
      <div class="h-44 bg-gray-100 overflow-hidden flex items-center justify-center">
        ${p.image_url
          ? `<img src="${p.image_url}" class="h-full w-full object-cover" loading="lazy" />`
          : `<span class="text-5xl">📦</span>`}
      </div>
      <div class="p-4 flex flex-col flex-1">
        <p class="text-xs text-gray-400 mb-1">${p.category?.name || ""}</p>
        <h3 class="font-semibold text-sm mb-2 flex-1 leading-snug">${p.name}</h3>
        <p class="text-indigo-600 font-bold text-base mb-1">${fmtPrice(p.price)}</p>
        <p class="text-xs text-gray-400 mb-3">${p.stock > 0 ? `В наявності: ${p.stock}` : "Немає в наявності"}</p>
        <button onclick='addToCart(${JSON.stringify(p)})'
          class="btn-primary w-full text-xs py-2 mt-auto" ${p.stock === 0 ? "disabled" : ""}>
          ${p.stock === 0 ? "Немає в наявності" : "До кошика"}
        </button>
      </div>
    </div>
  `).join("");
}

function searchProducts() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadProducts(activeCatId), 300);
}

// ── Cart ──────────────────────────────────────────────────────────────────────
function addToCart(product) {
  const item = cart.find(i => i.id === product.id);
  if (item) item.qty++;
  else cart.push({ id: product.id, name: product.name, price: Number(product.price), qty: 1 });
  saveCart();
  showToast(`«${product.name}» додано до кошика`);
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
  document.getElementById("cart-count").textContent = cart.reduce((s, i) => s + i.qty, 0);
}

function showCart() {
  document.getElementById("cart-modal").classList.remove("hidden");
  renderCart();
}

function renderCart() {
  const el    = document.getElementById("cart-items");
  const empty = document.getElementById("cart-empty");
  const total = document.getElementById("cart-total");
  const btn   = document.getElementById("cart-checkout-btn");

  if (!cart.length) {
    el.innerHTML = ""; empty.classList.remove("hidden");
    total.classList.add("hidden"); btn.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  el.innerHTML = cart.map((item, i) => `
    <div class="flex items-center justify-between py-2 border-b">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${item.name}</p>
        <p class="text-xs text-gray-400">${fmtPrice(item.price)} × ${item.qty}</p>
      </div>
      <div class="flex items-center gap-1 ml-3">
        <button onclick="changeQty(${i},-1)" class="w-6 h-6 border rounded text-sm">−</button>
        <span class="w-5 text-center text-sm">${item.qty}</span>
        <button onclick="changeQty(${i},1)"  class="w-6 h-6 border rounded text-sm">+</button>
        <button onclick="removeFromCart(${i})" class="text-red-400 ml-1 text-sm">✕</button>
      </div>
    </div>
  `).join("");
  const sum = cart.reduce((s, i) => s + i.price * i.qty, 0);
  total.textContent = `Разом: ${fmtPrice(sum)}`;
  total.classList.remove("hidden"); btn.classList.remove("hidden");
}

function changeQty(idx, d) {
  cart[idx].qty += d;
  if (cart[idx].qty < 1) cart.splice(idx, 1);
  saveCart(); renderCart();
}

function removeFromCart(idx) { cart.splice(idx, 1); saveCart(); renderCart(); }
function closeCart(e) { if (e.target === document.getElementById("cart-modal")) closeCartModal(); }
function closeCartModal() { document.getElementById("cart-modal").classList.add("hidden"); }

async function checkout() {
  if (!token) { closeCartModal(); navigate("login"); return; }
  try {
    const order = await api.post("/api/orders", { items: cart.map(i => ({ product_id: i.id, quantity: i.qty })) }, true);
    cart = []; saveCart(); closeCartModal();
    showToast(`Замовлення #${order.id} оформлено! ✓`);
    navigate("orders");
  } catch (err) { alert(`Помилка: ${err.message}`); }
}

// ── Orders ────────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  pending:   "Очікує",
  confirmed: "Підтверджено",
  shipped:   "Відправлено",
  delivered: "Доставлено",
  cancelled: "Скасовано",
};

async function loadOrders() {
  const orders = await api.get("/api/orders", true);
  renderOrdersList("orders-list", orders, true);
}

function renderOrdersList(containerId, orders, full = false) {
  const el = document.getElementById(containerId);
  if (!orders.length) { el.innerHTML = `<p class="text-gray-400 text-center py-10">Замовлень поки немає</p>`; return; }
  el.innerHTML = orders.slice(0, full ? 999 : 3).map(o => `
    <div class="bg-white rounded-xl shadow-sm p-5 mb-3">
      <div class="flex justify-between items-center mb-2">
        <span class="font-bold">Замовлення #${o.id}</span>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-400">${new Date(o.created_at).toLocaleDateString("uk")}</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium status-${o.status}">${STATUS_LABEL[o.status]}</span>
        </div>
      </div>
      <div class="text-xs text-gray-500 space-y-0.5 mb-2">
        ${o.items.map(i => `<div>· Товар #${i.product_id} × ${i.quantity} — ${fmtPrice(i.unit_price * i.quantity)}</div>`).join("")}
      </div>
      <div class="text-right font-bold text-indigo-600">${fmtPrice(o.total)}</div>
    </div>
  `).join("");
}

// ── Profile ───────────────────────────────────────────────────────────────────
async function loadProfile() {
  const me = await api.get("/api/users/me", true);
  userInfo = me;
  localStorage.setItem("userInfo", JSON.stringify(me));
  document.getElementById("profile-avatar").textContent = me.name[0].toUpperCase();
  document.getElementById("profile-name").textContent   = me.name;
  document.getElementById("profile-email").textContent  = me.email;
  document.getElementById("profile-name-input").value   = me.name;
  document.getElementById("profile-admin-badge").classList.toggle("hidden", !me.is_admin);
  const orders = await api.get("/api/orders", true);
  renderOrdersList("profile-orders", orders, false);
}

async function updateProfile(e) {
  e.preventDefault();
  const name = document.getElementById("profile-name-input").value.trim();
  if (!name) return;
  try {
    const me = await api.patch("/api/users/me", { name }, true);
    userInfo = me; localStorage.setItem("userInfo", JSON.stringify(me));
    document.getElementById("profile-name").textContent   = me.name;
    document.getElementById("profile-avatar").textContent = me.name[0].toUpperCase();
    showToast("Профіль оновлено ✓");
  } catch (err) { showToast(`Помилка: ${err.message}`); }
}

// ── Admin ─────────────────────────────────────────────────────────────────────
let adminCategories = [];

function adminTab(tab) {
  document.getElementById("admin-products").classList.toggle("hidden",   tab !== "products");
  document.getElementById("admin-categories").classList.toggle("hidden", tab !== "categories");
  document.getElementById("atab-products").classList.toggle("active",    tab === "products");
  document.getElementById("atab-categories").classList.toggle("active",  tab === "categories");
}

async function loadAdmin() {
  await Promise.all([loadAdminProducts(), loadAdminCategories()]);
}

async function loadAdminProducts() {
  const [products, cats] = await Promise.all([
    api.get("/api/catalog/products"),
    api.get("/api/catalog/categories"),
  ]);
  adminCategories = cats;
  fillCategorySelect("pf-cat", cats);

  document.getElementById("admin-products-table").innerHTML = products.map(p => `
    <tr class="border-t hover:bg-gray-50">
      <td class="px-4 py-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
            ${p.image_url ? `<img src="${p.image_url}" class="w-full h-full object-cover" />` : "📦"}
          </div>
          <span class="font-medium text-sm">${p.name}</span>
        </div>
      </td>
      <td class="px-4 py-3 text-gray-500 text-xs">${p.category?.name || "—"}</td>
      <td class="px-4 py-3 text-right font-semibold">${fmtPrice(p.price)}</td>
      <td class="px-4 py-3 text-right text-sm ${p.stock < 5 ? "text-red-500 font-semibold" : "text-gray-600"}">${p.stock}</td>
      <td class="px-4 py-3 text-right">
        <div class="flex gap-2 justify-end">
          <button onclick="editProduct(${JSON.stringify(p).replace(/"/g, "&quot;")})" class="btn-edit">Ред.</button>
          <button onclick="deleteProduct(${p.id})" class="btn-danger">Видалити</button>
        </div>
      </td>
    </tr>
  `).join("");
}

async function loadAdminCategories() {
  const cats = await api.get("/api/catalog/categories");
  document.getElementById("admin-categories-table").innerHTML = cats.map(c => `
    <tr class="border-t hover:bg-gray-50">
      <td class="px-4 py-3 font-medium">${c.name}</td>
      <td class="px-4 py-3 text-right">
        <button onclick="deleteCategory(${c.id})" class="btn-danger">Видалити</button>
      </td>
    </tr>
  `).join("");
}

function fillCategorySelect(id, cats) {
  document.getElementById(id).innerHTML =
    `<option value="">— Без категорії —</option>` +
    cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function submitProduct(e) {
  e.preventDefault();
  const id = document.getElementById("pf-id").value;
  const body = {
    name:        document.getElementById("pf-name").value,
    price:       parseFloat(document.getElementById("pf-price").value),
    stock:       parseInt(document.getElementById("pf-stock").value) || 0,
    category_id: document.getElementById("pf-cat").value ? parseInt(document.getElementById("pf-cat").value) : null,
    image_url:   document.getElementById("pf-img").value,
    description: document.getElementById("pf-desc").value,
  };
  try {
    if (id) {
      await api.put(`/api/catalog/products/${id}`, body, true);
      showToast("Товар оновлено ✓");
    } else {
      await api.post("/api/catalog/products", body, true);
      showToast("Товар додано ✓");
    }
    resetProductForm();
    await loadAdminProducts();
  } catch (err) { showToast(`Помилка: ${err.message}`); }
}

function editProduct(p) {
  document.getElementById("pf-id").value    = p.id;
  document.getElementById("pf-name").value  = p.name;
  document.getElementById("pf-price").value = p.price;
  document.getElementById("pf-stock").value = p.stock;
  document.getElementById("pf-img").value   = p.image_url;
  document.getElementById("pf-desc").value  = p.description;
  const sel = document.getElementById("pf-cat");
  if (p.category_id) sel.value = p.category_id;
  document.getElementById("pf-submit").textContent = "Зберегти зміни";
  document.getElementById("pf-cancel").classList.remove("hidden");
  document.getElementById("product-form-title").textContent = "Редагувати товар";
  document.getElementById("product-form").scrollIntoView({ behavior: "smooth" });
}

function resetProductForm() {
  document.getElementById("product-form").reset();
  document.getElementById("pf-id").value = "";
  document.getElementById("pf-submit").textContent = "Додати товар";
  document.getElementById("pf-cancel").classList.add("hidden");
  document.getElementById("product-form-title").textContent = "Додати товар";
}

async function deleteProduct(id) {
  if (!confirm("Видалити товар?")) return;
  await api.delete(`/api/catalog/products/${id}`, true);
  showToast("Товар видалено");
  await loadAdminProducts();
}

async function addCategory(e) {
  e.preventDefault();
  const name = document.getElementById("cat-name-input").value.trim();
  if (!name) return;
  try {
    await api.post("/api/catalog/categories", { name }, true);
    document.getElementById("cat-name-input").value = "";
    showToast("Категорію додано ✓");
    await loadAdminCategories();
  } catch (err) { showToast(`Помилка: ${err.message}`); }
}

async function deleteCategory(id) {
  if (!confirm("Видалити категорію?")) return;
  await api.delete(`/api/catalog/categories/${id}`, true);
  showToast("Категорію видалено");
  await loadAdminCategories();
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtPrice(n) {
  return Number(n).toLocaleString("uk-UA") + " ₴";
}

function showToast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.className = "fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-5 py-2.5 rounded-xl text-sm shadow-lg z-50";
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
setAuthState(!!token);
saveCart();

const startPage = location.hash.replace("#", "") || "catalog";
navigate(PAGES.includes(startPage) ? startPage : "catalog");
