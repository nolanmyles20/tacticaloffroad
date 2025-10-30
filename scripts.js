
// ================== CONFIG ==================
const SHOPIFY     = { shop: 'tacticaloffroad.myshopify.com' };
const CART        = `https://${SHOPIFY.shop}/cart`;
const CART_JS     = `https://${SHOPIFY.shop}/cart.js`;
const CART_ADD    = `https://${SHOPIFY.shop}/cart/add`;
const CART_TAB    = 'SHOPIFY_CART';         // user-visible cart window/tab (only when user clicks cart)
const CART_SILENT = 'SHOPIFY_CART_SILENT';  // hidden iframe name used for silent adds

let __pendingScrollSel = null;              // if a hotspot is clicked before products render
let localCount = 0;

// ================== BADGE (Shopify is source of truth) ==================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n ?? 0);
}
async function updateBadgeFromShopify() {
  try {
    const r = await fetch(CART_JS, { credentials: 'include', cache: 'no-store', mode: 'cors' });
    if (!r.ok) return; // first visit or blocked → leave current badge
    const data = await r.json();
    localCount = Number(data.item_count) || 0;
    setBadge(localCount);
  } catch {}
}

// ================== CART LINKS (single reusable tab) ==================
function wireCartLinks() {
  document.querySelectorAll('[data-cart-link], #cart-link').forEach(el => {
    el.setAttribute('href', CART);
    el.setAttribute('target', CART_TAB);  // reuse same named tab every time
    el.removeAttribute('rel');            // keep named relationship
    el.addEventListener('click', () => {
      // After cart opens, Shopify has context → try syncing shortly after
      setTimeout(updateBadgeFromShopify, 1200);
      setTimeout(updateBadgeFromShopify, 3000);
    });
  });
}

// ================== HIDDEN IFRAME (no-tab) ADDS ==================
function ensureSilentFrame() {
  let frame = document.querySelector(`iframe[name="${CART_SILENT}"]`);
  if (!frame) {
    frame = document.createElement('iframe');
    frame.name = CART_SILENT;
    frame.style.display = 'none';
    document.body.appendChild(frame);
  }
  return frame;
}

function addToCartSilent(variantId, qty) {
  const id = String(variantId);
  const q  = Math.max(1, Number(qty) || 1);

  ensureSilentFrame();

  // Build a short-lived form that posts into the hidden iframe
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = CART_ADD;
  form.target = CART_SILENT;

  const mk = (name, val) => { const i = document.createElement('input'); i.type='hidden'; i.name=name; i.value=val; return i; };
  form.appendChild(mk('id', id));
  form.appendChild(mk('quantity', String(q)));
  form.appendChild(mk('return_to', '/cart')); // optional: cart will be ready if user opens it next

  document.body.appendChild(form);
  form.submit();
  form.remove();

  // Optimistic badge so the user sees immediate feedback
  localCount = Number(document.getElementById('cart-count')?.textContent || 0) || 0;
  localCount += q;
  setBadge(localCount);

  // Reconcile with Shopify when possible
  setTimeout(updateBadgeFromShopify, 1200);
  setTimeout(updateBadgeFromShopify, 3000);
  setTimeout(updateBadgeFromShopify, 6000);
}

// Helper to wire a single product card's Add button
function wireCardAdd(buttonEl, qtyEl, variantResolver, powderEl, powderVariantId) {
  if (!buttonEl) return;
  buttonEl.addEventListener('click', () => {
    const q = Math.max(1, parseInt(qtyEl?.value, 10) || 1);
    const variantId = variantResolver();
    if (variantId) addToCartSilent(variantId, q);
    if (powderEl && powderEl.checked && powderVariantId) {
      setTimeout(() => addToCartSilent(powderVariantId, 1), 250); // serialize
    }
  });
}

// ================== MOBILE NAV HELPERS ==================
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

// ================== SMART SCROLL (hotspots) ==================
function scrollToEl(el) {
  if (!el) return;
  const navHVar = getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim();
  const navH = parseInt(navHVar || '0', 10) || 0;
  const extra = 20;
  const top = el.getBoundingClientRect().top + window.pageYOffset - (navH + extra);
  window.scrollTo({ top, behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ================== BOOT ==================
document.addEventListener('DOMContentLoaded', () => {
  // Cart
  wireCartLinks();
  updateBadgeFromShopify();
  setInterval(updateBadgeFromShopify, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateBadgeFromShopify();
  });

  // Mobile menu
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
  try { initFilters(); } catch (e) { console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed:', err));
});

// ================== DATA LOAD ==================
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

  // Home featured
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

// ================== RENDER ==================
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
        <label class="checkbox" ${p.powdercoat_variant_id ? '' : 'style="display:none"'}>
          <input type="checkbox" class="powder"/> Powdercoat Black +$${p.powdercoat_price || 50}
        </label>
      </div>
      <button class="btn add">ADD TO CART</button>
    </div>
  </div>`;
}

// ================== WIRING ==================
function wireCards(items) {
  document.querySelectorAll('.card').forEach(card => {
    const product = items.find(x => x.id === card.dataset.id);
    const btn  = card.querySelector('.add');
    const qty  = card.querySelector('.qty');
    const coat = card.querySelector('.powder');

    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      wireCardAdd(
        btn,
        qty,
        () => (product.variant_ids?.Solo || {})[varSel?.value || 'Default'],
        coat,
        product.powdercoat_variant_id
      );
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

    wireCardAdd(
      btn,
      qty,
      () => {
        const o1 = o1Sel ? o1Sel.value : Object.keys(vmap)[0];
        const o2 = o2Sel ? o2Sel.value : (vmap[o1] ? Object.keys(vmap[o1])[0] : '');
        const node = vmap[o1]?.[o2];
        const o3 = o3Sel ? o3Sel.value : (node && typeof node === 'object' ? Object.keys(node)[0] : '');
        return (typeof node === 'object') ? node?.[o3] : vmap[o1]?.[o2];
      },
      coat,
      product.powdercoat_variant_id
    );
  });
}

// ================== FILTERS ==================
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

// ================== HOTSPOTS (optional) ==================
document.addEventListener('click', (e) => {
  const spot = e.target.closest('.hotspot');
  if (!spot) return;
  const sel = spot.getAttribute('data-target');
  if (!sel) return;

  const target = document.querySelector(sel);
  if (target) {
    scrollToEl(target);
  } else {
    __pendingScrollSel = sel; // finish after loadProducts runs
  }
});

