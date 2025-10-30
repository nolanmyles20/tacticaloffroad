// ================ CONFIG =================
const SHOPIFY = { shop: 'tacticaloffroad.myshopify.com' };
const CART_URL = `https://${SHOPIFY.shop}/cart`;
const CART_JS  = `https://${SHOPIFY.shop}/cart.js`;
const ADD_URL  = `https://${SHOPIFY.shop}/cart/add`;

// Named window handle (reused)
let cartWin = null;

// ================ BADGE ==================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n);
}

// Only ever trust Shopify for the number
async function updateCartCount() {
  try {
    const res = await fetch(CART_JS, { credentials: 'include', cache: 'no-store', mode: 'cors' });
    if (!res.ok) return;
    const data = await res.json();
    setBadge(Number(data.item_count) || 0);
  } catch {
    // ignore — user may not have cart cookies yet
  }
}

// ================ CART WINDOW =============
// Ensure the named cart window exists/opened in a user gesture
function ensureCartWindow() {
  // If closed or missing, open a fresh named window
  if (!cartWin || cartWin.closed) {
    // Use a minimal about:blank first; navigation happens via form target
    cartWin = window.open('', 'SHOPIFY_CART');
    try { if (cartWin) cartWin.opener = null; } catch {}
  }
  return cartWin || null;
}

// ================ CROSS-ORIGIN POST HELPERS =============
// Classic form POST to Shopify. Works on mobile & with a pre-open tab.
function postToShopify(actionUrl, params, targetName) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  form.target = targetName;

  // Shopify expects `id` and `quantity` for /cart/add; extra params are okay.
  Object.entries(params).forEach(([k, v]) => {
    const inp = document.createElement('input');
    inp.type = 'hidden';
    inp.name = k;
    inp.value = String(v);
    form.appendChild(inp);
  });

  // Hidden submit
  form.style.position = 'absolute';
  form.style.left = '-9999px';
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
}

// Add one line item; opens/reuses the named cart tab
function addLineItem(variantId, qty) {
  const w = ensureCartWindow();
  if (!w) return; // popup blocked

  postToShopify(ADD_URL, { id: variantId, quantity: Math.max(1, Number(qty) || 1) }, 'SHOPIFY_CART');

  // Sync the real count shortly after Shopify processes the add
  setTimeout(updateCartCount, 1200);
  setTimeout(updateCartCount, 3000);
  setTimeout(updateCartCount, 6000);
}

// ================ MOBILE NAV HELPERS ================
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

// ================ BOOT ===================
document.addEventListener('DOMContentLoaded', () => {
  // Wire cart links: open/reuse the named cart tab
  const cartTargets = [
    ...document.querySelectorAll('[data-cart-link]'),
    ...document.querySelectorAll('#cart-link')
  ];
  cartTargets.forEach(el => {
    el.setAttribute('href', CART_URL);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const w = ensureCartWindow();
      if (!w) return; // popup blocked
      // If it's a fresh blank window, navigate it to the cart page
      try {
        if (w.location.href === 'about:blank') w.location.href = CART_URL;
        w.focus();
      } catch {}
      // Sync in case Shopify set cookies after opening
      setTimeout(updateCartCount, 1000);
      setTimeout(updateCartCount, 3000);
    });
  });

  // Mobile menu toggle (fixed overlay behavior)
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('main-menu');

  setNavHeightVar();
  window.addEventListener('resize', setNavHeightVar);
  window.addEventListener('orientationchange', setNavHeightVar);

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const isOpen = menu.classList.contains('is-open');
      if (isOpen) closeMobileMenu(toggle, menu);
      else openMobileMenu(toggle, menu);
    });

    menu.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) closeMobileMenu(toggle, menu);
    });

    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('is-open')) return;
      const insideMenu = e.target.closest('#main-menu');
      const onToggle = e.target.closest('.nav-toggle');
      if (!insideMenu && !onToggle) closeMobileMenu(toggle, menu);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        closeMobileMenu(toggle, menu);
      }
    });

    const mqDesktop = window.matchMedia('(min-width: 801px)');
    mqDesktop.addEventListener?.('change', (m) => {
      if (m.matches) closeMobileMenu(toggle, menu);
    });
  }

  // First count sync (shows 0 until Shopify cookies exist)
  updateCartCount();
  // Keep trying to stay in sync
  setInterval(updateCartCount, 15000);

  // Filters + products
  try { initFilters(); } catch (e) { console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed', err));
});

// ================ DATA LOAD ==============
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

  // Featured grid (home)
  const fg = document.getElementById('featured-grid');
  if (fg) {
    const platforms = ['Humvee', 'Jeep', 'AR-15', 'Cross-Karts'];
    const picks = platforms.map(pl => items.find(p => p.platforms.includes(pl))).filter(Boolean);
    fg.innerHTML = picks.map(p => productCard(p)).join('');
  }

  wireCards(items);
}

// ================ RENDER ================
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
  const vmap = p.variant_ids || {};
  const opt1Vals = Object.keys(vmap);
  const o1 = opt1Vals[0] || '';
  const opt2Vals = o1 ? Object.keys(vmap[o1] || {}) : [];
  const o2 = opt2Vals[0] || '';
  const opt3Vals = (o1 && o2 && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
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
        <div ${opt1Vals.length<=1 ? 'style="display:none"' : ''}>
          <label>${labels.first || 'Option 1'}</label>
          <select class="select opt1">${opt1Vals.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>
        </div>
        <div ${opt2Vals.length<=1 ? 'style="display:none"' : ''}>
          <label>${labels.second || 'Option 2'}</label>
          <select class="select opt2">${opt2Vals.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>
        </div>
        <div ${opt3Vals.length<=1 ? 'style="display:none"' : ''}>
          <label>${labels.third || 'Option 3'}</label>
          <select class="select opt3">${opt3Vals.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>
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

// ================ WIRING ================
function wireCards(items) {
  document.querySelectorAll('.card').forEach(card => {
    const product = items.find(x => x.id === card.dataset.id);
    const btn = card.querySelector('.add');
    const qtyEl = card.querySelector('.qty');
    const powderEl = card.querySelector('.powder');

    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', () => {
        // Open/reuse the cart window in the same user gesture
        ensureCartWindow();
        const qty = Math.max(1, parseInt(qtyEl?.value, 10) || 1);
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (variantId) addLineItem(variantId, qty);
      });
      return;
    }

    const vmap = product.variant_ids || {};
    const opt1 = card.querySelector('.opt1');
    const opt2 = card.querySelector('.opt2');
    const opt3 = card.querySelector('.opt3');

    opt1?.addEventListener('change', () => {
      const o1 = opt1.value;
      const o2Vals = Object.keys(vmap[o1] || {});
      if (opt2) opt2.innerHTML = o2Vals.map(v => `<option value="${v}">${v}</option>`).join('');
      const o2 = opt2 ? opt2.value : o2Vals[0];
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
        ? Object.keys(vmap[o1][o2]) : [];
      if (opt3) opt3.innerHTML = o3Vals.map(v => `<option value="${v}">${v}</option>`).join('');
    });

    opt2?.addEventListener('change', () => {
      const o1 = opt1 ? opt1.value : Object.keys(vmap)[0];
      const o2 = opt2.value;
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
        ? Object.keys(vmap[o1][o2]) : [];
      if (opt3) opt3.innerHTML = o3Vals.map(v => `<option value="${v}">${v}</option>`).join('');
    });

    btn.addEventListener('click', () => {
      ensureCartWindow();

      const o1 = opt1 ? opt1.value : Object.keys(vmap)[0];
      const o2 = opt2 ? opt2.value : (vmap[o1] ? Object.keys(vmap[o1])[0] : '');
      const node = vmap[o1]?.[o2];
      const o3 = opt3 ? opt3.value : (node && typeof node === 'object' ? Object.keys(node)[0] : '');
      const qty = Math.max(1, parseInt(qtyEl?.value, 10) || 1);

      let variantId = null;
      if (typeof node === 'object') {
        variantId = node?.[o3] || null;     // 3-level map
      } else {
        variantId = vmap[o1]?.[o2] || null; // 2-level map
      }

      if (variantId) addLineItem(variantId, qty);
      if (powderEl && powderEl.checked && product.powdercoat_variant_id) {
        // slight delay so requests land in order
        setTimeout(() => addLineItem(product.powdercoat_variant_id, 1), 250);
      }
    });
  });
}

// ================ FILTERS ================
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
