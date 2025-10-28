// ================ CONFIG =================
const SHOPIFY = { shop: 'shop.tacticaloffroad.store' }; // use myshopify domain until shop. subdomain has SSL

// ================ BOOT ===================
document.addEventListener('DOMContentLoaded', () => {
  // Wire any cart link(s)
  const cartTargets = [
    ...document.querySelectorAll('[data-cart-link]'),
    ...document.querySelectorAll('#cart-link')
  ];
  cartTargets.forEach(el => {
    el.setAttribute('href', `https://${SHOPIFY.shop}/cart`);
    el.addEventListener('click', (e) => {
      // allow default <a href> navigation, but if it's a button/div, navigate manually
      if (el.tagName !== 'A') {
        e.preventDefault();
        window.location.href = `https://${SHOPIFY.shop}/cart`;
      }
    });
  });

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
  const grids = document.querySelectorAll('#product-grid');
  grids.forEach(grid => {
    const cat = grid.getAttribute('data-category');
    const activeTags = getActiveTags();
    const subset = items
      .filter(p => p.platforms.includes(cat))
      .filter(p => activeTags.length === 0 || activeTags.every(t => p.tags.includes(t)));
    grid.innerHTML = subset.map(p => productCard(p)).join('') || '<p>No products match those filters.</p>';
  });

  // Featured grid (home) — one per platform including Cross-Karts
  const fg = document.getElementById('featured-grid');
  if (fg) {
    const platforms = ['Humvee', 'Jeep', 'AR-15', 'Cross-Karts'];
    const picks = platforms.map(pl => items.find(p => p.platforms.includes(pl))).filter(Boolean);
    fg.innerHTML = picks.map(p => productCard(p)).join('');
  }

  // Wire dynamic selects + buttons after render
  wireCards(items);
}

// ================ RENDER ================
function productCard(p) {
  // Simple product (e.g., Cross-Karts "Solo")
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
            <select class="select simple-variant">
              <option value="Default">Solo</option>
            </select>
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

  // Standard Armor/Stainless product
  return `
  <div class="card" data-id="${p.id}">
    <img src="${p.image}" alt="${p.title}">
    <div class="content">
      <div class="badge">${p.platforms.join(' • ')}</div>
      <h3>${p.title}</h3>
      <p>${p.desc}</p>
      <p class="price">$${p.basePrice}</p>
      <div class="controls">
        <div>
          <label>Material</label>
          <select class="select material">
            <option value="Armor">Armor</option>
            <option value="Stainless">Stainless</option>
          </select>
        </div>
        <div>
          <label>Thickness</label>
          <select class="select thickness">
            <option>1mm</option>
            <option>2mm</option>
            <option>3mm</option>
          </select>
        </div>
        <div>
          <label>Qty</label>
          <input type="number" class="qty" min="1" value="1"/>
        </div>
        <label class="checkbox">
          <input type="checkbox" class="powder"/> Powdercoat Black +$50
        </label>
      </div>
      <button class="btn add">ADD TO CART</button>
    </div>
  </div>`;
}

// ================ WIRING ================
function wireCards(items) {
  document.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    const product = items.find(x => x.id === id);
    const btn = card.querySelector('.add');
    const qtyEl = card.querySelector('.qty');

    // Simple product behavior
    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', () => {
        const qty = Math.max(1, parseInt(qtyEl.value || '1', 10));
        const variantId = (product.variant_ids['Solo'] || {})[varSel.value];
        if (!variantId) {
          // Graceful fallback: open cart instead of alerting
          window.location.href = `https://${SHOPIFY.shop}/cart`;
          return;
        }
        const url = `https://${SHOPIFY.shop}/cart/${variantId}:${qty}?channel=buy_button`;
        window.location.href = url;
      });
      return;
    }

    // Standard product behavior
    const matSel = card.querySelector('.material');
    const thickSel = card.querySelector('.thickness');
    const powderEl = card.querySelector('.powder');

    btn.addEventListener('click', () => {
      const material = matSel.value;
      const thickness = thickSel.value; // '1mm', '2mm', '3mm'
      const qty = Math.max(1, parseInt(qtyEl.value || '1', 10));
      const variantId = (product.variant_ids[material] || {})[thickness];

      if (!variantId) {
        // Graceful fallback: open cart; still usable before variants are wired
        window.location.href = `https://${SHOPIFY.shop}/cart`;
        return;
      }

      let cartParts = [`${variantId}:${qty}`];
      if (powderEl && powderEl.checked && product.powdercoat_variant_id) {
        cartParts.push(`${product.powdercoat_variant_id}:1`);
      }
      const url = `https://${SHOPIFY.shop}/cart/${cartParts.join(',')}?channel=buy_button`;
      window.location.href = url;
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
