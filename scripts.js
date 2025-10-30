// ================= CONFIG =================
const SHOPIFY = { shop: 'tacticaloffroad.myshopify.com' };
let cartWin = null; // single, reusable named window/tab

// ================= BADGE (no optimistic bumps) =================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n ?? 0);
}
setBadge(0);

/** Always read count from Shopify to avoid cookie/localStorage drift */
async function updateCartCount() {
  try {
    const res = await fetch(`https://${SHOPIFY.shop}/cart.js`, {
      credentials: 'include', cache: 'no-store', mode: 'cors'
    });
    if (!res.ok) return;
    const data = await res.json();
    setBadge(Number(data.item_count) || 0);
  } catch {
    /* ignore */
  }
}

// ================= CART WINDOW HELPERS =================
/** Ensure the named cart window exists and is on /cart (prevents about:blank on iOS) */
function ensureCartWindow() {
  const url = `https://${SHOPIFY.shop}/cart`;
  if (!cartWin || cartWin.closed) {
    cartWin = window.open(url, 'SHOPIFY_CART');
    try { if (cartWin) cartWin.opener = null; } catch {}
  } else {
    try {
      if (cartWin.location && cartWin.location.href === 'about:blank') {
        cartWin.location.href = url;
      }
    } catch {}
    try { cartWin.focus(); } catch {}
  }
  return cartWin || null;
}

/** Open cart directly (used by explicit cart clicks) */
function openCartNow() {
  const w = ensureCartWindow();
  if (!w) {
    // Popup blocked: just go same-tab as a fallback
    window.location.href = `https://${SHOPIFY.shop}/cart`;
  }
  // Pull real count shortly after open
  setTimeout(updateCartCount, 1200);
  setTimeout(updateCartCount, 3000);
}

/** POST helper that targets the named window */
function postToShopify(actionUrl, params, targetName) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  form.target = targetName;

  Object.entries(params).forEach(([k, v]) => {
    const inp = document.createElement('input');
    inp.type = 'hidden';
    inp.name = k;
    inp.value = String(v);
    form.appendChild(inp);
  });

  form.style.position = 'absolute';
  form.style.left = '-9999px';
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
}

/** Add a single line item; always lands the cart window on /cart after add */
function addLineItem(variantId, qty) {
  const w = ensureCartWindow();
  const id = String(variantId);
  const q  = Math.max(1, Number(qty) || 1);

  if (!w) {
    // Popup blocked: fall back to same-tab navigation that still adds & redirects
    window.location.href =
      `https://${SHOPIFY.shop}/cart/add?id=${encodeURIComponent(id)}&quantity=${q}&return_to=/cart`;
    return;
  }

  postToShopify(`https://${SHOPIFY.shop}/cart/add`, {
    id, quantity: q, return_to: '/cart'
  }, 'SHOPIFY_CART');

  // Sync badge with Shopify after add processes
  setTimeout(updateCartCount, 1200);
  setTimeout(updateCartCount, 3000);
  setTimeout(updateCartCount, 6000);
}

// ================= MOBILE NAV =================
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

// ================= BOOT =================
document.addEventListener('DOMContentLoaded', () => {
  // Wire cart link(s) to reuse the named cart window
  [...document.querySelectorAll('[data-cart-link], #cart-link')].forEach(el => {
    const href = `https://${SHOPIFY.shop}/cart`;
    el.setAttribute('href', href);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
    el.addEventListener('click', (e) => { e.preventDefault(); openCartNow(); });
  });

  // Mobile menu toggle (fixed overlay behavior)
  const toggle = document.querySelector('.nav-toggle');
  const menu   = document.getElementById('main-menu');

  setNavHeightVar();
  window.addEventListener('resize', setNavHeightVar);
  window.addEventListener('orientationchange', setNavHeightVar);

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.contains('is-open');
      if (open) closeMobileMenu(toggle, menu);
      else openMobileMenu(toggle, menu);
    });

    // Close when clicking any link in the menu
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeMobileMenu(toggle, menu);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('is-open')) return;
      const inMenu  = e.target.closest('#main-menu');
      const onTgl   = e.target.closest('.nav-toggle');
      if (!inMenu && !onTgl) closeMobileMenu(toggle, menu);
    });

    // ESC closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        closeMobileMenu(toggle, menu);
      }
    });

    // If we cross to desktop, ensure menu is closed
    const mq = window.matchMedia('(min-width: 801px)');
    mq.addEventListener?.('change', (m) => { if (m.matches) closeMobileMenu(toggle, menu); });
  }

  // Initial badge + polling
  updateCartCount();
  setInterval(updateCartCount, 10000);

  // Filters + products
  try { initFilters(); } catch (e) { console.warn('initFilters error', e); }
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

  // Featured grid (home)
  const fg = document.getElementById('featured-grid');
  if (fg) {
    const platforms = ['Humvee', 'Jeep', 'AR-15', 'Cross-Karts'];
    const picks = platforms.map(pl => items.find(p => p.platforms.includes(pl))).filter(Boolean);
    fg.innerHTML = picks.map(p => productCard(p)).join('');
  }

  wireCards(items);
}

// ================= RENDER =================
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

  const labels  = p.option_labels || {};
  const vmap    = p.variant_ids || {};
  const opt1    = Object.keys(vmap);
  const o1      = opt1[0] || '';
  const opt2    = o1 ? Object.keys(vmap[o1] || {}) : [];
  const o2      = opt2[0] || '';
  const opt3    = (o1 && o2 && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
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
        <label class="checkbox" ${p.powdercoat_variant_id ? '' : 'style="display:none"'}>
          <input type="checkbox" class="powder"/> Powdercoat Black +$${p.powdercoat_price || 50}
        </label>
      </div>
      <button class="btn add">ADD TO CART</button>
    </div>
  </div>`;
}

// ================= WIRING =================
function wireCards(items) {
  document.querySelectorAll('.card').forEach(card => {
    const product = items.find(x => x.id === card.dataset.id);
    const btn     = card.querySelector('.add');
    const qtyEl   = card.querySelector('.qty');
    const powder  = card.querySelector('.powder');

    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', () => {
        const qty = Math.max(1, parseInt(qtyEl?.value, 10) || 1);
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (variantId) addLineItem(variantId, qty);
        if (powder && powder.checked && product.powdercoat_variant_id) {
          addLineItem(product.powdercoat_variant_id, 1);
        }
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
      const o1 = opt1 ? opt1.value : Object.keys(vmap)[0];
      const o2 = opt2 ? opt2.value : (vmap[o1] ? Object.keys(vmap[o1])[0] : '');
      const node = vmap[o1]?.[o2];
      const o3 = opt3 ? opt3.value : (node && typeof node === 'object' ? Object.keys(node)[0] : '');
      const qty = Math.max(1, parseInt(qtyEl?.value, 10) || 1);

      let variantId = null;
      if (typeof node === 'object') variantId = node?.[o3] || null;   // 3-level
      else variantId = vmap[o1]?.[o2] || null;                        // 2-level

      if (variantId) addLineItem(variantId, qty);
      if (powder && powder.checked && product.powdercoat_variant_id) {
        addLineItem(product.powdercoat_variant_id, 1);
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
