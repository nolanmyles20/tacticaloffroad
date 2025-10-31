
// ================= CONFIG =================
const SHOPIFY    = { shop: 'tacticaloffroad.myshopify.com' };
const CART       = `https://${SHOPIFY.shop}/cart`;
const CART_JS    = `https://${SHOPIFY.shop}/cart.js`;
const CART_ADD   = `https://${SHOPIFY.shop}/cart/add`;
const CART_NAME  = 'SHOPIFY_CART';

// Storefront API (used only as a fallback for the badge when cookies block /cart.js)
const SF_VERSION  = '2024-10';
const SF_ENDPOINT = `https://${SHOPIFY.shop}/api/${SF_VERSION}/graphql.json`;
const SF_TOKEN    = '7f1d57625124831f8f9c47a088e48fb8'; // your token

const DEBUG = false;
let __pendingScrollSel = null;

// ================= LOG HELPERS =================
const dbg  = (...a)=>{ if (DEBUG) console.log('[SF]', ...a); };
const warn = (...a)=>{ if (DEBUG) console.warn('[SF]', ...a); };

// ================= BADGE =================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n ?? 0);
}

// Prefer Online-Store cart.js when possible (truth for what /cart shows)
async function getCountFromCartJs() {
  try {
    const r = await fetch(CART_JS, { credentials: 'include', cache: 'no-store', mode: 'cors' });
    if (!r.ok) return null; // null => not available
    const j = await r.json();
    return Number(j.item_count) || 0;
  } catch {
    return null;
  }
}

// =================== STOREFRONT CART (fallback) ===================
const SF_CART_KEY = 'sf_cart_obj_v2'; // {version, token, id}

function readSfCartObj() { try { return JSON.parse(localStorage.getItem(SF_CART_KEY)||'{}')||{}; } catch { return {}; } }
function writeSfCartObj(o){ localStorage.setItem(SF_CART_KEY, JSON.stringify(o||{})); }
function clearSfCartObj(){ localStorage.removeItem(SF_CART_KEY); }

function cartSignatureChanged() {
  const cur = readSfCartObj();
  return (cur.version !== SF_VERSION || cur.token !== SF_TOKEN);
}

async function sfFetch(query, variables = {}) {
  const r = await fetch(SF_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Shopify-Storefront-Access-Token': SF_TOKEN
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    mode: 'cors'
  });
  let payload = null;
  try { payload = await r.json(); } catch (e) { warn('bad JSON from SF', e); throw new Error(`SF ${r.status}`); }
  if (!r.ok || payload.errors) { warn('SF error', { status:r.status, errors:payload?.errors }); throw new Error('Storefront API error'); }
  return payload.data;
}

async function ensureSfCart() {
  if (cartSignatureChanged()) clearSfCartObj();
  let cur = readSfCartObj();
  if (cur.id) return cur.id;
  const data = await sfFetch(`mutation CreateCart { cartCreate { cart { id } } }`);
  const id = data?.cartCreate?.cart?.id;
  if (!id) throw new Error('Failed to create SF cart');
  cur = { id, version: SF_VERSION, token: SF_TOKEN };
  writeSfCartObj(cur);
  dbg('created SF cart', id);
  return id;
}

function variantNumericToGid(numericId) {
  return `gid://shopify/ProductVariant/${String(numericId).trim()}`;
}

async function sfAddLine(numericVariantId, qty) {
  const cartId = await ensureSfCart();
  const merchandiseId = variantNumericToGid(numericVariantId);
  const data = await sfFetch(`
    mutation AddLines($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) { cart { totalQuantity } }
    }`,
    { cartId, lines: [{ merchandiseId, quantity: Math.max(1, Number(qty)||1) }] }
  );
  return Number(data?.cartLinesAdd?.cart?.totalQuantity || 0);
}

async function getCountFromStorefront() {
  try {
    const id = await ensureSfCart();
    const data = await sfFetch(`query GetCart($id: ID!) { cart(id: $id) { totalQuantity } }`, { id });
    return Number(data?.cart?.totalQuantity || 0);
  } catch (e) { warn('getCountFromStorefront failed', e); return 0; }
}

// Hard reset the Storefront fallback if Online-Store cart is empty
async function resetSfIfJsZero(jsQty) {
  if (jsQty === 0) {
    clearSfCartObj();
    try { await ensureSfCart(); } catch (e) { /* ignore */ }
  }
}

// Main badge logic: trust Online-Store when available; fallback to SF
async function refreshBadge() {
  const jsQty = await getCountFromCartJs(); // number or null
  if (jsQty !== null) {
    // We have a real answer from Online-Store (cookie/session). TRUST IT.
    setBadge(jsQty);
    // If Online-Store says empty, kill the SF shadow so it can't show 16 later.
    await resetSfIfJsZero(jsQty);
    dbg('badge via cart.js', jsQty);
    return;
  }
  // If cart.js is unavailable (blocked cookies), fall back to Storefront
  const sfQty = await getCountFromStorefront();
  setBadge(sfQty);
  dbg('badge via Storefront fallback', sfQty);
}

// ================= ONE NAMED CART TAB (desktop + mobile) =================
function openInCartTab(url) {
  // <a target="SHOPIFY_CART"> guarantees reusing the same named tab/window
  const a = document.createElement('a');
  a.href = url;
  a.target = CART_NAME;
  a.rel = 'noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function showCart() { openInCartTab(CART); }

// Add to Online-Store cart (so /cart shows items) AND mirror to Storefront (for badge)
async function addLine(variantId, qty) {
  const id = String(variantId);
  const q  = Math.max(1, Number(qty) || 1);

  // Mirror to SF first (so badge works when cookies are blocked)
  try { await sfAddLine(id, q); } catch (e) { warn('sfAddLine failed', e); }

  // Navigate the single named tab to /cart/add, then to /cart via return_to
  const url = `${CART_ADD}?id=${encodeURIComponent(id)}&quantity=${q}&return_to=%2Fcart&_=${Date.now()}`;
  openInCartTab(url);

  // Refresh badge soon (both sources)
  setTimeout(refreshBadge, 900);
  setTimeout(refreshBadge, 3000);
  setTimeout(refreshBadge, 6000);
}

async function addTwo(v1,q1,v2,q2) {
  try { await sfAddLine(v1,q1); await sfAddLine(v2,q2); } catch(e){ warn('sfAddLine pair', e); }
  addLine(v1,q1);
  setTimeout(()=>addLine(v2,q2), 450);
}

// ================= MOBILE NAV & SMART SCROLL =================
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
  // Cart links → always reuse the SAME tab
  [...document.querySelectorAll('[data-cart-link], #cart-link')].forEach(el => {
    el.setAttribute('href', CART);
    el.setAttribute('target', CART_NAME);
    el.removeAttribute('rel');
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showCart();
      setTimeout(refreshBadge, 1000);
      setTimeout(refreshBadge, 3000);
    });
  });

  // Mobile menu toggle
  const toggle = document.querySelector('.nav-toggle');
  const menu   = document.getElementById('main-menu');

  setNavHeightVar();
  window.addEventListener('resize', setNavHeightVar);
  window.addEventListener('orientationchange', setNavHeightVar);

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.contains('is-open') ? closeMobileMenu(toggle, menu) : openMobileMenu(toggle, menu);
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) closeMobileMenu(toggle, menu); });
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('is-open')) return;
      const inMenu = e.target.closest('#main-menu');
      const onTgl  = e.target.closest('.nav-toggle');
      if (!inMenu && !onTgl) closeMobileMenu(toggle, menu);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) closeMobileMenu(toggle, menu);
    });
    const mq = window.matchMedia('(min-width: 801px)');
    mq.addEventListener?.('change', (m) => { if (m.matches) closeMobileMenu(toggle, menu); });
  }

  // Make sure we have an SF cart (for fallback), but do not display its count unless needed
  try { await ensureSfCart(); } catch(e){ warn('ensureSfCart failed', e); }

  // Seed & keep badge in sync (now reconciles to 0 when Online-Store is empty)
  await refreshBadge();
  setInterval(refreshBadge, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });

  // Filters + products
  try { initFilters(); } catch (e) { if (DEBUG) console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed', err));
});

// ================= DATA LOAD =================
async function loadProducts() {
  const res = await fetch('assets/products.json', { cache: 'no-store' });
  if (!res.ok) { console.error('products.json fetch failed:', res.status, res.statusText); return; }
  const items = await res.json();

  // Category grids
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

  // Finish any pending hotspot scroll
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
        if (coat && coat.checked && product.powdercoat_variant_id) {
          addTwo(variantId, q, product.powdercoat_variant_id, 1);
        } else {
          addLine(variantId, q);
        }
      });
      return;
    }

    const vmap  = product.variant_ids || {};
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
      if (coat && coat.checked && product.powdercoat_variant_id) {
        addTwo(variantId, q, product.powdercoat_variant_id, 1);
      } else {
        addLine(variantId, q);
      }
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

// ================= HOTSPOTS =================
document.addEventListener('click', (e) => {
  const spot = e.target.closest('.hotspot');
  if (!spot) return;
  const sel = spot.getAttribute('data-target');
  if (!sel) return;

  const target = document.querySelector(sel);
  if (target) {
    scrollToEl(target);
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
  } else {
    __pendingScrollSel = sel; // wait until loadProducts finishes
  }
});

