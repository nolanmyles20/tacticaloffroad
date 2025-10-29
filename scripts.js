// ================ CONFIG =================
const SHOPIFY = { shop: 'tacticaloffroad.myshopify.com' }; // change if needed
let cartWin = null; // single, reusable cart tab
let localCartCount = Number(localStorage.getItem('localCartCount') ?? 0) || 0;

// ================ BADGE ==================
function setBadge(n) {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(n);
}
setBadge(localCartCount);

// Try to pull the real count from Shopify (works best after user has opened cart at least once)
async function updateCartCount() {
  try {
    const res = await fetch(`https://${SHOPIFY.shop}/cart.js`, {
      credentials: 'include',
      cache: 'no-store',
      mode: 'cors'
    });
    if (!res.ok) return;
    const data = await res.json();
    localCartCount = Number(data.item_count) || 0;
    localStorage.setItem('localCartCount', String(localCartCount));
    setBadge(localCartCount);
  } catch (_e) {
    // cross-origin or first-visit will often fail; keep optimistic count
  }
}

// Open/reuse the cart tab (safer noopener style)
function openCartTab(url = `https://${SHOPIFY.shop}/cart`) {
  const name = 'SHOPIFY_CART';
  const w = cartWin && !cartWin.closed ? cartWin : window.open('', name);
  if (!w) return; // popup blocked
  try { w.opener = null; } catch {}
  try { w.location.href = url; } catch {}
  try { w.focus(); } catch {}
  cartWin = w;

  // after a short delay, Shopify will have set cookies -> try to sync real count
  setTimeout(updateCartCount, 1500);
  setTimeout(updateCartCount, 4000);
}

// Append an item by navigating the named cart tab to cart/add (no CORS issues)
function addViaUrl(variantId, qty) {
  const q = Math.max(1, Number(qty) || 1);
  const url = `https://${SHOPIFY.shop}/cart/add?id=${encodeURIComponent(variantId)}&quantity=${q}`;

  // optimistic local badge bump so user sees feedback immediately
  localCartCount += q;
  localStorage.setItem('localCartCount', String(localCartCount));
  setBadge(localCartCount);

  openCartTab(url);
}

// ================ BOOT ===================
document.addEventListener('DOMContentLoaded', () => {
  // Wire cart links to reuse the same named tab
  const cartTargets = [
    ...document.querySelectorAll('[data-cart-link]'),
    ...document.querySelectorAll('#cart-link')
  ];
  cartTargets.forEach(el => {
    const href = `https://${SHOPIFY.shop}/cart`;
    el.setAttribute('href', href);           // keep for long-press/copy
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openCartTab(href);
    });
  });

  // mobile menu toggle
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('main-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // initial attempts to sync cart count
  updateCartCount();
  setInterval(updateCartCount, 10000);

  // filters + products
  try { initFilters(); } catch (e) { console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed', err));
});

// ================ DATA LOAD ==============
async function loadProducts() {
  const res = await fetch('assets/products.json', { cache: 'no-store' });
  if (!res.ok) {
    console.error('products.json fetch failed:', res.status, res.statusText);
    return;
  }
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

  // Wire events after render
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
        const qty = Math.max(1, parseInt(qtyEl?.value, 10) || 1);
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (variantId) addViaUrl(variantId, qty);
        openCartTab(); // brings/reuses the tab
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
      if (typeof node === 'object') {
        variantId = node?.[o3] || null;     // 3-level map
      } else {
        variantId = vmap[o1]?.[o2] || null; // 2-level map
      }

      if (variantId) addViaUrl(variantId, qty);
      if (powderEl && powderEl.checked && product.powdercoat_variant_id) {
        addViaUrl(product.powdercoat_variant_id, 1);
      }
      openCartTab();
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
