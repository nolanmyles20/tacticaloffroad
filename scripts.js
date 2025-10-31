
// ================= CONFIG =================
const SHOPIFY    = { shop: 'tacticaloffroad.myshopify.com' };
const CART       = `https://${SHOPIFY.shop}/cart`;
const CART_JS    = `https://${SHOPIFY.shop}/cart.js`;
const CART_ADD   = `https://${SHOPIFY.shop}/cart/add`;
const CART_NAME  = 'SHOPIFY_CART';

// Storefront (badge reliability + session mirror/fallback)
const SF_ENDPOINT = `https://${SHOPIFY.shop}/api/2025-01/graphql.json`;
const SF_TOKEN    = '7f1d57625124831f8f9c47a088e48fb8'; // Storefront Access Token

const DEBUG = false;

// Pending scroll target if hotspot clicked before products render
let __pendingScrollSel = null;

// ============== LOCAL CART (source of truth) ==============
const LS_CART_KEY = 'headless_cart_v1';

function readCart() {
  try { return JSON.parse(localStorage.getItem(LS_CART_KEY)) || { lines: [] }; }
  catch { return { lines: [] }; }
}
function writeCart(cart) {
  localStorage.setItem(LS_CART_KEY, JSON.stringify(cart));
}
function cartCount() {
  const c = readCart();
  return c.lines.reduce((n, l) => n + (l.qty|0), 0);
}
function cartSubtotalCents() {
  const c = readCart();
  return c.lines.reduce((sum, l) => sum + (l.price_cents || 0) * (l.qty|0), 0);
}
function setBadgeFromLocal() {
  setBadge(cartCount());
}
function addToLocalCart({ variantId, qty = 1, title, image, price_cents = 0, productId }) {
  const c = readCart();
  const key = String(variantId);
  const line = c.lines.find(l => l.variantId === key);
  if (line) {
    line.qty = Math.max(1, (line.qty|0) + (qty|0));
    line.title = title ?? line.title;
    line.image = image ?? line.image;
    line.price_cents = (price_cents ?? line.price_cents) | 0;
    line.productId = productId ?? line.productId;
  } else {
    c.lines.push({ variantId: key, qty: Math.max(1, qty|0), title, image, price_cents, productId });
  }
  writeCart(c);
  setBadgeFromLocal();
  return c;
}
function setLineQty(variantId, qty) {
  const c = readCart();
  const line = c.lines.find(l => l.variantId === String(variantId));
  if (!line) return c;
  if (qty <= 0) c.lines = c.lines.filter(l => l !== line);
  else line.qty = qty|0;
  writeCart(c);
  setBadgeFromLocal();
  return c;
}
function removeLine(variantId) {
  const c = readCart();
  c.lines = c.lines.filter(l => l.variantId !== String(variantId));
  writeCart(c);
  setBadgeFromLocal();
  return c;
}
function clearLocalCart() {
  writeCart({ lines: [] });
  setBadgeFromLocal();
}
function formatMoney(cents) {
  return `$${(Number(cents||0)/100).toFixed(2)}`;
}

// ============== TOAST (Item Added ✓) ==============
let __toastTimer = null;

function ensureToastHost() {
  if (document.getElementById('toast-host')) return;
  const host = document.createElement('div');
  host.id = 'toast-host';
  host.innerHTML = `<div id="toast" role="status" aria-live="polite" aria-atomic="true"></div>`;
  document.body.appendChild(host);
}
function showToast(msg = 'Item Added To Cart ✓', ms = 1000) {
  ensureToastHost();
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ================= BADGE =================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n ?? 0);
}

async function getCountFromCartJs() {
  try {
    const r = await fetch(CART_JS, { credentials: 'include', cache: 'no-store', mode: 'cors' });
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j.item_count) || 0;
  } catch { return 0; }
}

// ---- Storefront helpers (fallback for badge) ----
async function sfFetch(query, variables = {}) {
  const r = await fetch(SF_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SF_TOKEN
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    mode: 'cors'
  });
  const j = await r.json();
  if (j.errors) { if (DEBUG) console.warn('SF errors', j.errors); throw j.errors; }
  return j.data;
}
async function ensureCart() {
  let id = localStorage.getItem('sf_cartId');
  if (id) return id;
  const data = await sfFetch(`mutation CreateCart { cartCreate { cart { id } } }`);
  id = data?.cartCreate?.cart?.id || '';
  if (id) localStorage.setItem('sf_cartId', id);
  return id;
}
function variantNumericToGid(numericId) {
  return `gid://shopify/ProductVariant/${String(numericId)}`;
}
// kept for compatibility (not used by local add flow)
async function sfAddLine(variantId, qty) {
  try {
    const cartId = await ensureCart();
    const merchandiseId = variantNumericToGid(variantId);
    await sfFetch(`
      mutation AddLines($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) { cart { totalQuantity } }
      }
    `, { cartId, lines: [{ merchandiseId, quantity: Math.max(1, Number(qty)||1) }] });
  } catch (e) {
    if (DEBUG) console.warn('sfAddLine failed', e);
  }
}
async function getCountFromStorefront() {
  try {
    const id = await ensureCart();
    if (!id) return 0;
    const data = await sfFetch(`query GetCart($id: ID!) { cart(id: $id) { totalQuantity } }`, { id });
    return Number(data?.cart?.totalQuantity || 0);
  } catch { return 0; }
}

// Local-first badge; fall back to Storefront/cart.js ONLY when local cart is empty.
// Also listen to cross-tab changes so the badge stays in sync.
async function refreshBadge() {
  const localQty = cartCount();
  if (localQty > 0) { setBadge(localQty); return; }
  const [sfQty, jsQty] = await Promise.all([getCountFromStorefront(), getCountFromCartJs()]);
  const qty = Math.max(sfQty, jsQty, 0);
  setBadge(qty);
}
window.addEventListener('storage', (ev) => {
  if (ev.key === LS_CART_KEY) setBadgeFromLocal();
});

// ================= ONE NAMED CART TAB (legacy helpers kept) =================
function focusCartTab() {
  let w = null;
  try { w = window.open('', CART_NAME); } catch {}
  try { if (w) w.focus(); } catch {}
  return w;
}
function openInCartTab(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = CART_NAME;
  a.rel = 'noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function primeCartTab() {
  focusCartTab();
  openInCartTab(CART);
}
// kept for compatibility
function addLineGET(variantId, qty) {
  const id = String(variantId);
  const q  = Math.max(1, Number(qty) || 1);
  sfAddLine(id, q);
  focusCartTab();
  const url = `${CART_ADD}?id=${encodeURIComponent(id)}&quantity=${q}&return_to=%2Fcart&_=${Date.now()}`;
  openInCartTab(url);
  setTimeout(refreshBadge, 900);
  setTimeout(refreshBadge, 2500);
  setTimeout(refreshBadge, 5000);
}
function addTwoSequentially(v1, q1, v2, q2) {
  addLineGET(v1, q1);
  setTimeout(() => addLineGET(v2, q2), 500);
}

// ============== CART PAGE RENDER + CHECKOUT (our cart UI) ==============
function renderCart() {
  const root = document.getElementById('cart-root');
  if (!root) return;

  const c = readCart();
  if (!c.lines.length) {
    root.innerHTML = `<p>Your cart is empty.</p>`;
    return;
  }

  const rows = c.lines.map(l => `
    <div class="cart-row" data-vid="${l.variantId}">
      <img class="cart-thumb" src="${l.image || 'assets/placeholder.png'}" alt="">
      <div class="cart-info">
        <div class="cart-title">${l.title || 'Item'}</div>
        <div class="cart-variant">Variant ID: ${l.variantId}</div>
      </div>
      <div class="cart-qty">
        <button class="qty-btn minus" aria-label="Decrease">−</button>
        <input class="qty-input" type="number" min="1" value="${l.qty}">
        <button class="qty-btn plus" aria-label="Increase">+</button>
      </div>
      <div class="cart-price">${formatMoney((l.price_cents||0)*(l.qty||1))}</div>
      <button class="cart-remove" aria-label="Remove">✕</button>
    </div>
  `).join('');

  const subtotal = cartSubtotalCents();
  root.innerHTML = `
    <div class="cart-table">${rows}</div>
    <div class="cart-summary">
      <div class="row"><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
      <p class="muted">Taxes and shipping calculated at checkout.</p>
      <div class="cart-actions">
        <button id="cart-clear" class="btn outline">Clear Cart</button>
        <button id="cart-checkout" class="btn primary">Checkout with Shopify</button>
      </div>
    </div>
  `;

  root.querySelectorAll('.cart-row').forEach(row => {
    const vid = row.getAttribute('data-vid');
    const input = row.querySelector('.qty-input');
    row.querySelector('.qty-btn.minus').addEventListener('click', () => {
      const n = Math.max(1, (parseInt(input.value,10)||1) - 1);
      input.value = n; setLineQty(vid, n); renderCart();
    });
    row.querySelector('.qty-btn.plus').addEventListener('click', () => {
      const n = Math.max(1, (parseInt(input.value,10)||1) + 1);
      input.value = n; setLineQty(vid, n); renderCart();
    });
    input.addEventListener('change', () => {
      const n = Math.max(1, parseInt(input.value,10)||1);
      setLineQty(vid, n); renderCart();
    });
    row.querySelector('.cart-remove').addEventListener('click', () => {
      removeLine(vid); renderCart();
    });
  });

  document.getElementById('cart-clear').addEventListener('click', () => { clearLocalCart(); renderCart(); });
  document.getElementById('cart-checkout').addEventListener('click', () => { sendToShopifyAndCheckout(); });
}

// Build /cart permalink then go to checkout in the same named tab
function sendToShopifyAndCheckout() {
  const c = readCart();
  if (!c.lines.length) return;
  const parts = c.lines.map(l => `${encodeURIComponent(l.variantId)}:${encodeURIComponent(l.qty)}`).join(',');
  const url = `https://${SHOPIFY.shop}/cart/${parts}`;
  focusCartTab();
  openInCartTab(url);
  setTimeout(() => openInCartTab(`https://${SHOPIFY.shop}/checkout`), 800);
  // keep local cart for safety; clear later if desired
}

// ================= MOBILE NAV & SCROLL =================
function setNavHeightVar() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const h = Math.ceil(nav.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--nav-h', `${h}px`);
}
function openMobileMenu(toggle, menu) {
  if (!toggle || !menu) return;
  setNavHeightVar();
  menu.classList.add('is-open');
  toggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('no-scroll');
}
function closeMobileMenu(toggle, menu) {
  if (!toggle || !menu) return;
  menu.classList.remove('is-open');
  toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('no-scroll');
}
function scrollToEl(el) {
  if (!el) return;
  const navHVar = getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim();
  const navH = parseInt(navHVar || '0', 10) || 0;
  const extra = 20;
  const top = el.getBoundingClientRect().top + window.pageYOffset - (navH + extra);
  window.scrollTo({ top, behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ================= BOOT =================
document.addEventListener('DOMContentLoaded', async () => {
  try { await ensureCart(); } catch {}

  // One-time cleanup: remove legacy shadow counter so badge can't get stuck
  try { localStorage.removeItem('shadowCartQty'); } catch {}

  // Header cart links → go to OUR cart page (local cart UI)
  [...document.querySelectorAll('[data-cart-link], #cart-link')].forEach(el => {
    el.setAttribute('href', '/cart.html');
    el.removeAttribute('target');
    el.removeAttribute('rel');
  });

  // Badge: show local immediately, then background refresh
  setBadgeFromLocal();
  await refreshBadge();
  setInterval(refreshBadge, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });

  // Filters + products
  try { initFilters(); } catch (e) { if (DEBUG) console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed', err));

  // If on cart.html, render the cart UI
  renderCart();
});

// ================= DATA LOAD =================
async function loadProducts() {
  const res = await fetch('assets/products.json', { cache: 'no-store' });
  if (!res.ok) { console.error('products.json fetch failed:', res.status, res.statusText); return; }
  const items = await res.json();

  // Category pages
  document.querySelectorAll('#product-grid').forEach(grid => {
    const cat = grid.getAttribute('data-category');
    const activeTags = getActiveTags();
    const subset = items
      .filter(p => p.platforms.includes(cat))
      .filter(p => activeTags.length === 0 || activeTags.every(t => p.tags.includes(t)));
    grid.innerHTML = subset.map(p => productCard(p)).join('') || '<p>No products match those filters.</p>';
  });

  // Featured (home)
  const fg = document.getElementById('featured-grid');
  if (fg) {
    const platforms = ['Humvee', 'Jeep', 'AR-15', 'Cross-Karts'];
    const picks = platforms.map(pl => items.find(p => p.platforms.includes(pl))).filter(Boolean);
    fg.innerHTML = picks.map(p => productCard(p)).join('');
  }

  wireCards(items);

  // Finish any pending scroll (e.g., Humvee/Jeep insert hotspot)
  if (__pendingScrollSel) {
    const el = document.querySelector(__pendingScrollSel);
    if (el) scrollToEl(el);
    __pendingScrollSel = null;
  }
}

// ================= RENDER =================
function productCard(p) {
  if (p.simple) {
    return `
    <div class="card" data-id="${p.id}" id="product-${p.id}">
      <img src="${p.image}" alt="${p.title}">
      <div class="content">
        <div class="badge">${p.platforms.join(' • ')}</div>
        <h3>${p.title}</h3>
        <p>${p.desc}</p>
        <div class="controls">
          <div>
            <label>Variant</label>
            <select class="select simple-variant"><option value="Default">Solo</option></select>
          </div>
          <div>
            <label>Qty</label>
            <input type="number" class="qty" min="1" value="1"/>
          </div>
        </div>
        <button class="btn add">ADD TO CART</button>
      </div>
    </div>`;
  }

  const labels = p.option_labels || {};
  const vmap   = p.variant_ids || {};
  const opt1   = Object.keys(vmap);
  const o1     = opt1[0] || '';
  const opt2   = o1 ? Object.keys(vmap[o1] || {}) : [];
  const o2     = opt2[0] || '';
  const opt3   = (o1 && o2 && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
               ? Object.keys(vmap[o1][o2]) : [];

  return `
  <div class="card" data-id="${p.id}" id="product-${p.id}">
    <img src="${p.image}" alt="${p.title}">
    <div class="content">
      <div class="badge">${p.platforms.join(' • ')}</div>
      <h3>${p.title}</h3>
      <p>${p.desc}</p>
      <p class="price">$${p.basePrice}</p>
      <div class="controls">
        <div ${opt1.length<=1 ? 'style="display:none"' : ''}>
          <label>${labels.first || 'Option 1'}</label>
          <select class="select opt1">${opt1.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>
        </div>
        <div ${opt2.length<=1 ? 'style="display:none"' : ''}>
          <label>${labels.second || 'Option 2'}</label>
          <select class="select opt2">${opt2.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>
        </div>
        <div ${opt3.length<=1 ? 'style="display:none"' : ''}>
          <label>${labels.third || 'Option 3'}</label>
          <select class="select opt3">${opt3.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>
        </div>
        <div>
          <label>Qty</label>
          <input type="number" class="qty" min="1" value="1"/>
        </div>
        <label class="checkbox" ${p.powdercoat_variant_id ? '' : 'style="display:none"'}><input type="checkbox" class="powder"/> Powdercoat Black +$${p.powdercoat_price || 50}</label>
      </div>
      <button class="btn add">ADD TO CART</button>
    </div>
  </div>`;
}

// ================= WIRING =================
function wireCards(items) {
  document.querySelectorAll('.card').forEach(card => {
    const product = items.find(x => x.id === card.dataset.id);
    const btn  = card.querySelector('.add');
    const qty  = card.querySelector('.qty');
    const coat = card.querySelector('.powder');

    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', () => {
        const q = Math.max(1, parseInt(qty?.value, 10) || 1);
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (!variantId) { if (DEBUG) console.warn('[cart] missing variantId'); return; }

        const priceCents = Math.round((product.basePrice || 0) * 100);
        addToLocalCart({
          variantId, qty: q,
          title: product.title, image: product.image,
          price_cents: priceCents, productId: product.id
        });

        if (coat && coat.checked && product.powdercoat_variant_id) {
          addToLocalCart({
            variantId: product.powdercoat_variant_id, qty: 1,
            title: 'Powdercoat Black', image: product.image,
            price_cents: Math.round((product.powdercoat_price || 50) * 100),
            productId: product.id
          });
        }

        showToast('Item Added To Cart ✓');
      });
      return;
    }

    const vmap = product.variant_ids || {};
    const o1Sel = card.querySelector('.opt1');
    const o2Sel = card.querySelector('.opt2');
    const o3Sel = card.querySelector('.opt3');

    o1Sel?.addEventListener('change', () => {
      const o1 = o1Sel.value;
      const o2Vals = Object.keys(vmap[o1] || {});
      if (o2Sel) o2Sel.innerHTML = o2Vals.map(v => `<option value="${v}">${v}</option>`).join('');
      const o2 = o2Sel ? o2Sel.value : o2Vals[0];
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
        ? Object.keys(vmap[o1][o2]) : [];
      if (o3Sel) o3Sel.innerHTML = o3Vals.map(v => `<option value="${v}">${v}</option>`).join('');
    });

    o2Sel?.addEventListener('change', () => {
      const o1 = o1Sel ? o1Sel.value : Object.keys(vmap)[0];
      const o2 = o2Sel.value;
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
        ? Object.keys(vmap[o1][o2]) : [];
      if (o3Sel) o3Sel.innerHTML = o3Vals.map(v => `<option value="${v}">${v}</option>`).join('');
    });

    btn.addEventListener('click', () => {
      const o1 = o1Sel ? o1Sel.value : Object.keys(vmap)[0];
      const o2 = o2Sel ? o2Sel.value : (vmap[o1] ? Object.keys(vmap[o1])[0] : '');
      const node = vmap[o1]?.[o2];
      const o3 = o3Sel ? o3Sel.value : (node && typeof node === 'object' ? Object.keys(node)[0] : '');
      const q  = Math.max(1, parseInt(qty?.value, 10) || 1);

      let variantId = null;
      if (typeof node === 'object') variantId = node?.[o3] || null;  // 3-level
      else variantId = vmap[o1]?.[o2] || null;                       // 2-level

      if (!variantId) { if (DEBUG) console.warn('[cart] no variantId resolved'); return; }

      const priceCents = Math.round((product.basePrice || 0) * 100);
      addToLocalCart({
        variantId, qty: q,
        title: product.title, image: product.image,
        price_cents: priceCents, productId: product.id
      });

      if (coat && coat.checked && product.powdercoat_variant_id) {
        addToLocalCart({
          variantId: product.powdercoat_variant_id, qty: 1,
          title: 'Powdercoat Black', image: product.image,
          price_cents: Math.round((product.powdercoat_price || 50) * 100),
          productId: product.id
        });
      }

      showToast('Item Added To Cart ✓');
    });
  });
}

// ================= FILTERS =================
function initFilters() {
  document.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', () => {
      t.classList.toggle('active');
      updateUrlFromFilters();
      loadProducts();
    });
  });
  const params = new URLSearchParams(window.location.search);
  const tags = params.getAll('tag');
  if (tags.length) {
    document.querySelectorAll('.toggle').forEach(t => {
      if (tags.includes(t.dataset.tag)) t.classList.add('active');
    });
  }
}
function getActiveTags() {
  return Array.from(document.querySelectorAll('.toggle.active')).map(el => el.dataset.tag);
}
function updateUrlFromFilters() {
  const tags = getActiveTags();
  const params = new URLSearchParams();
  tags.forEach(t => params.append('tag', t));
  const newUrl = window.location.pathname + (tags.length ? ('?' + params.toString()) : '');
  history.replaceState({}, '', newUrl);
}

// ================= HOTSPOTS (Humvee + Jeep) =================
// Guarded so clicks inside header/menu never get hijacked by hotspots.
document.addEventListener('click', (e) => {
  // 🚫 Ignore clicks originating in header/nav/menu
  if (e.target.closest('.nav, #main-menu')) return;

  const node = e.target.closest('[data-target], .hotspot, .humvee-hotspot, .jeep-hotspot');
  if (!node) return;

  let sel = node.getAttribute('data-target') || node.dataset?.target || null;

  // Allow anchors with hash to act as hotspots (outside nav)
  if (!sel && node.tagName === 'A') {
    const href = node.getAttribute('href') || '';
    if (href.startsWith('#')) sel = href;
  }
  if (!sel) return;

  if (node.tagName === 'A') e.preventDefault();

  const target = document.querySelector(sel);
  if (target) {
    scrollToEl(target);
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
  } else {
    __pendingScrollSel = sel; // wait until loadProducts finishes
  }
});
