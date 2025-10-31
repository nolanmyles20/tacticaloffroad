
// ================= CONFIG =================
const SHOPIFY    = { shop: 'tacticaloffroad.myshopify.com' };
const CART_CLEAR = `https://${SHOPIFY.shop}/cart/clear`;
const CART_ADD   = `https://${SHOPIFY.shop}/cart/add`;
const CART_NAME  = 'SHOPIFY_CART';

const SITE_CART  = (typeof window !== 'undefined' ? `${location.origin}/cart` : '/cart');
const DEBUG = false;

// ================= LOCAL CART (source of truth for badge/UI) =================
// Structure: [{id: <variantId number|string>, qty: <int>}]
function loadSiteCart() {
  try { return JSON.parse(localStorage.getItem('siteCart') || '[]'); } catch { return []; }
}
function saveSiteCart(lines) {
  localStorage.setItem('siteCart', JSON.stringify(lines));
}
function addToSiteCart(variantId, qty) {
  const id = String(variantId);
  const q  = Math.max(1, Number(qty) || 1);
  const lines = loadSiteCart();
  const i = lines.findIndex(l => String(l.id) === id);
  if (i >= 0) lines[i].qty = Math.max(1, (lines[i].qty|0) + q);
  else lines.push({ id, qty: q });
  saveSiteCart(lines);
  updateBadgeFromLocal();
}
function addManyToSiteCart(pairs /* [{id, qty},...] */) {
  const lines = loadSiteCart();
  pairs.forEach(({id, qty}) => {
    const sid = String(id);
    const q   = Math.max(1, Number(qty) || 1);
    const i   = lines.findIndex(l => String(l.id) === sid);
    if (i >= 0) lines[i].qty = Math.max(1, (lines[i].qty|0) + q);
    else lines.push({ id: sid, qty: q });
  });
  saveSiteCart(lines);
  updateBadgeFromLocal();
}
function setQtyInSiteCart(variantId, qty) {
  const id = String(variantId);
  const q  = Math.max(0, Number(qty) || 0);
  let lines = loadSiteCart();
  const i = lines.findIndex(l => String(l.id) === id);
  if (i >= 0) {
    if (q === 0) lines.splice(i, 1);
    else lines[i].qty = q;
  }
  saveSiteCart(lines);
  updateBadgeFromLocal();
}
function clearSiteCart() {
  saveSiteCart([]);
  updateBadgeFromLocal();
}
function getLocalCount() {
  return loadSiteCart().reduce((sum, l) => sum + (l.qty|0), 0);
}

// ================= BADGE (local = always correct) =================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n ?? 0);
}
function updateBadgeFromLocal() {
  setBadge(getLocalCount());
}

// ================= ONE NAMED CART TAB (for your /cart page and final checkout) =================
function focusCartTab() {
  let w = null;
  try { w = window.open('', CART_NAME); } catch {}
  try { if (w) w.focus(); } catch {}
  return w;
}
function openInCartTab(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = CART_NAME;      // reuse single named tab
  a.rel = 'noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function showSiteCartTab() {
  focusCartTab();
  openInCartTab(SITE_CART);
}

// ================= CHECKOUT TRANSFER (Local → Shopify, then to checkout) =================
// 1) Open named tab to /cart/clear (Shopify).
// 2) Post one form to /cart/add with items[n][id], items[n][quantity] and return_to=/checkout.
// 3) Clear local cart if desired AFTER form submit.
async function transferLocalCartToShopifyAndCheckout() {
  const lines = loadSiteCart();
  if (!lines.length) {
    // no items; just show your cart
    showSiteCartTab();
    return;
  }

  // Step 1: clear Shopify cart in the same named tab
  focusCartTab();
  openInCartTab(CART_CLEAR);

  // Step 2: build a single add form with all lines
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = CART_ADD;
  form.target = CART_NAME;

  lines.forEach((l, idx) => {
    const id = document.createElement('input');
    id.type = 'hidden';
    id.name = `items[${idx}][id]`;
    id.value = String(l.id);
    form.appendChild(id);

    const q = document.createElement('input');
    q.type = 'hidden';
    q.name = `items[${idx}][quantity]`;
    q.value = String(Math.max(1, l.qty|0));
    form.appendChild(q);
  });

  const returnTo = document.createElement('input');
  returnTo.type = 'hidden';
  returnTo.name = 'return_to';
  returnTo.value = '/checkout';     // jump straight to checkout after add
  form.appendChild(returnTo);

  document.body.appendChild(form);

  // Tiny delay gives the /cart/clear nav a tick to land in named tab
  setTimeout(() => {
    form.submit();       // navigates named tab to add → then to checkout
    form.remove();
    // Optional: clear local cart immediately; or wait and clear when user returns
    clearSiteCart();
  }, 250);
}

// ================= OPTIONAL CART PAGE RENDERER (your /cart page) =================
// If your /cart page has:
//   <div id="cart-root"></div>
//   <button id="checkout-btn">Checkout</button>
// We'll render items and wire the button.
function renderSiteCartUI() {
  const root = document.getElementById('cart-root');
  if (!root) return; // not on cart page

  const lines = loadSiteCart();
  if (!lines.length) {
    root.innerHTML = '<p>Your cart is empty.</p>';
    return;
  }

  // Simple list; you can style with your CSS
  root.innerHTML = `
    <div class="cart-lines">
      ${lines.map(l => `
        <div class="cart-line" data-id="${l.id}">
          <div class="line-main">
            <span class="sku">Variant #${l.id}</span>
          </div>
          <div class="line-qty">
            <button class="qty-dec" aria-label="Decrease">−</button>
            <input class="qty-input" type="number" min="1" value="${l.qty}">
            <button class="qty-inc" aria-label="Increase">+</button>
            <button class="line-remove">Remove</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Wire qty +/- and remove
  root.querySelectorAll('.cart-line').forEach(row => {
    const id = row.getAttribute('data-id');
    const inp = row.querySelector('.qty-input');
    row.querySelector('.qty-dec')?.addEventListener('click', () => {
      const next = Math.max(1, (parseInt(inp.value,10)||1) - 1);
      inp.value = String(next);
      setQtyInSiteCart(id, next);
      renderSiteCartUI(); // re-render
    });
    row.querySelector('.qty-inc')?.addEventListener('click', () => {
      const next = Math.max(1, (parseInt(inp.value,10)||1) + 1);
      inp.value = String(next);
      setQtyInSiteCart(id, next);
      renderSiteCartUI();
    });
    row.querySelector('.line-remove')?.addEventListener('click', () => {
      setQtyInSiteCart(id, 0);
      renderSiteCartUI();
    });
    inp?.addEventListener('change', () => {
      const val = Math.max(1, parseInt(inp.value,10)||1);
      setQtyInSiteCart(id, val);
      renderSiteCartUI();
    });
  });

  // Wire checkout
  document.getElementById('checkout-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    transferLocalCartToShopifyAndCheckout();
  });
}

// ================= MOBILE NAV & SCROLL (unchanged) =================
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
document.addEventListener('DOMContentLoaded', () => {
  // Cart links → open your /cart in the single named tab
  [...document.querySelectorAll('[data-cart-link], #cart-link')].forEach(el => {
    el.setAttribute('href', SITE_CART);
    el.setAttribute('target', CART_NAME);
    el.removeAttribute('rel');
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showSiteCartTab();
    });
  });

  // Badge from local
  updateBadgeFromLocal();

  // Optional: on /cart page render UI
  renderSiteCartUI();

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

  // Filters + products
  try { initFilters(); } catch (e) { if (DEBUG) console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed', err));
});

// ================= DATA LOAD (unchanged) =================
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
}

// ================= RENDER (unchanged) =================
function productCard(p) {
  if (p.simple) {
    return `
    <div class="card" data-id="${p.id}">
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
  <div class="card" data-id="${p.id}">
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

// ================= WIRING (updated to add to LOCAL cart only) =================
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
        if (!variantId) return;
        if (coat && coat.checked && product.powdercoat_variant_id) {
          addManyToSiteCart([{id: variantId, qty: q}, {id: product.powdercoat_variant_id, qty: 1}]);
        } else {
          addToSiteCart(variantId, q);
        }
        // Optionally show the cart tab after add:
        showSiteCartTab();
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
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object') ? Object.keys(vmap[o1][o2]) : [];
      if (o3Sel) o3Sel.innerHTML = o3Vals.map(v => `<option value="${v}">${v}</option>`).join('');
    });

    o2Sel?.addEventListener('change', () => {
      const o1 = o1Sel ? o1Sel.value : Object.keys(vmap)[0];
      const o2 = o2Sel.value;
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object') ? Object.keys(vmap[o1][o2]) : [];
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

      if (!variantId) return;

      if (coat && coat.checked && product.powdercoat_variant_id) {
        addManyToSiteCart([{id: variantId, qty: q}, {id: product.powdercoat_variant_id, qty: 1}]);
      } else {
        addToSiteCart(variantId, q);
      }
      // Optionally show the cart tab after add:
      showSiteCartTab();
    });
  });
}

// ================= FILTERS (unchanged) =================
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

// ================= HOTSPOTS (unchanged) =================
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
    // wait to scroll once products render
    window.__pendingScrollSel = sel;
  }
});
