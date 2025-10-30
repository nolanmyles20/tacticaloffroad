
// ================= CONFIG =================
const SHOPIFY   = { shop: 'tacticaloffroad.myshopify.com' };
const CART      = `https://${SHOPIFY.shop}/cart`;
const CART_JS   = `https://${SHOPIFY.shop}/cart.js`;
const CART_ADD  = `https://${SHOPIFY.shop}/cart/add`;
const CART_NAME = 'SHOPIFY_CART';

// Debug log toggle
const DEBUG = false;

// For hotspot clicks that happen before products render
let __pendingScrollSel = null;

// ================= BADGE (Shopify = source of truth) =================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n ?? 0);
}
async function updateCartCount() {
  try {
    const r = await fetch(CART_JS, { credentials: 'include', cache: 'no-store', mode: 'cors' });
    if (!r.ok) return;
    const data = await r.json();
    const cnt = Number(data.item_count) || 0;
    if (DEBUG) console.log('[cart] count from Shopify', cnt);
    setBadge(cnt);
  } catch (e) {
    if (DEBUG) console.warn('[cart] count fetch failed', e);
  }
}

// ================= ONE NAMED CART TAB, ALWAYS =================
// Use an <a> click with target="SHOPIFY_CART" so the browser *reuses* that tab.
function openInCartTab(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = CART_NAME;       // reuse named tab
  a.rel = 'noreferrer';       // avoid opener side-effects
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Prime cart tab (loads /cart) so cookies/state are set, then we can navigate it again for adds.
function primeCartTab() {
  openInCartTab(CART);
}

// Add a single line via GET, then show /cart (return_to=/cart).
// Include a cache-buster so browsers never cache the add.
function addLineGET(variantId, qty) {
  const id = String(variantId);
  const q  = Math.max(1, Number(qty) || 1);
  const url = `${CART_ADD}?id=${encodeURIComponent(id)}&quantity=${q}&return_to=%2Fcart&_=${Date.now()}`;
  if (DEBUG) console.log('[cart] add variant', id, 'qty', q, '→', url);
  openInCartTab(url);

  // Sync the real count a few times after Shopify processes it
  setTimeout(updateCartCount, 1200);
  setTimeout(updateCartCount, 3000);
  setTimeout(updateCartCount, 6000);
}

// Add two items serially (e.g., base + powdercoat). Delay prevents mobile/Safari races.
function addTwoSequentially(v1, q1, v2, q2) {
  addLineGET(v1, q1);
  setTimeout(() => addLineGET(v2, q2), 500);
}

// ================= MOBILE NAV HELPERS =================
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

// ================= SMOOTH SCROLL (hotspots) =================
function scrollToEl(el) {
  if (!el) return;
  const navHVar = getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim();
  const navH = parseInt(navHVar || '0', 10) || 0;
  const extra = 20;
  const top = el.getBoundingClientRect().top + window.pageYOffset - (navH + extra);
  window.scrollTo({ top, behavior: 'smooth' });

  // Optional flash highlight if you style .flash in CSS
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ================= BOOT =================
document.addEventListener('DOMContentLoaded', () => {
  // Make every cart link reuse the SAME named tab
  [...document.querySelectorAll('[data-cart-link], #cart-link')].forEach(el => {
    el.setAttribute('href', CART);
    el.setAttribute('target', CART_NAME);   // reuse; NOT _blank
    el.removeAttribute('rel');              // allow name reuse
    // Let it navigate normally; afterwards, sync count
    el.addEventListener('click', () => {
      setTimeout(updateCartCount, 1200);
      setTimeout(updateCartCount, 3000);
    });
  });

  // Hotspots: click → scroll to target (e.g., data-target="#product-hd-front-bumper")
  document.addEventListener('click', (e) => {
    const spot = e.target.closest('.hotspot');
    if (!spot) return;
    const sel = spot.getAttribute('data-target');
    if (!sel) return;

    const target = document.querySelector(sel);
    if (target) {
      scrollToEl(target);
    } else {
      // If cards not rendered yet, remember and perform after loadProducts
      __pendingScrollSel = sel;
    }
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

  // First badge + keep in sync (also when user returns focus)
  updateCartCount();
  setInterval(updateCartCount, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateCartCount();
  });

  // Filters + products
  try { initFilters(); } catch (e) { if (DEBUG) console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed:', err));
});

// ================= DATA LOAD =================
async function loadProducts() {
  const res = await fetch('assets/products.json', { cache: 'no-store' });
  if (!res.ok) { console.error('products.json fetch failed:', res.status, res.statusText); return; }
  const items = await res.json();

  // Category pages
  document.querySelectorAll('#product-grid').forEach(grid => {
    const cat = grid.getAttribute('data-category');
    const activeTags = getActiveTags?.() || [];
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

  // Complete any pending hotspot scroll after cards exist
  if (__pendingScrollSel) {
    const el = document.querySelector(__pendingScrollSel);
    if (el) scrollToEl(el);
    __pendingScrollSel = null;
  }
}

// ================= RENDER =================
function productCard(p) {
  // give every card a stable id so hotspots can target it
  const cardId = `product-${p.id}`;

  if (p.simple) {
    return `
    <div class="card" data-id="${p.id}" id="${cardId}">
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
  <div class="card" data-id="${p.id}" id="${cardId}">
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

    if (product?.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', () => {
        const q = Math.max(1, parseInt(qty?.value, 10) || 1);
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (variantId) {
          primeCartTab();
          addLineGET(variantId, q);
          if (coat && coat.checked && product.powdercoat_variant_id) {
            setTimeout(() => addLineGET(product.powdercoat_variant_id, 1), 500);
          }
        } else if (DEBUG) {
          console.warn('[cart] missing variantId');
        }
      });
      return;
    }

    const vmap = product?.variant_ids || {};
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

      if (DEBUG) console.log('[cart] chosen variant', variantId, {o1, o2, o3, q});

      if (variantId) {
        primeCartTab();
        addLineGET(variantId, q);
        if (coat && coat.checked && product.powdercoat_variant_id) {
          setTimeout(() => addLineGET(product.powdercoat_variant_id, 1), 500);
        }
      } else if (DEBUG) {
        console.warn('[cart] no variantId resolved', { product: product.id, o1, o2, o3 });
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

