// ================ CONFIG =================
const SHOPIFY = { shop: 'shop.tacticaloffroad.store' }; // fallback to 'tacticaloffroad.myshopify.com' if shop. SSL not ready
let cartWin = null; // reuse one cart tab

// ================ HELPERS =================
async function updateCartCount(){
  try {
    const res = await fetch(`https://${SHOPIFY.shop}/cart.js`, {
      credentials: 'include',
      cache: 'no-store',
      mode: 'cors'
    });
    if(!res.ok) return;
    const data = await res.json();
    const countEl = document.getElementById('cart-count');
    if(countEl) countEl.textContent = data.item_count;
  } catch(err){
    console.error('Cart count fetch error:', err);
  }
}

async function addToCart(variantId, qty){
  // POST /cart/add.js appends to existing cart
  const form = new URLSearchParams();
  form.append('id', variantId);
  form.append('quantity', String(qty || 1));
  try {
    const res = await fetch(`https://${SHOPIFY.shop}/cart/add.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form.toString(),
      credentials: 'include',
      mode: 'cors'
    });
    if(!res.ok){
      const t = await res.text();
      console.error('addToCart failed', res.status, t);
    }
  } catch(e){
    console.error('addToCart error', e);
  }
}

function openCartTab(){
  const url = `https://${SHOPIFY.shop}/cart`;
  if(!cartWin || cartWin.closed){
    cartWin = window.open(url, '_blank', 'noopener');
  } else {
    try { cartWin.location.href = url; cartWin.focus(); } catch {}
  }
}

// ================ BOOT ===================
document.addEventListener('DOMContentLoaded', () => {
  // Wire any cart link(s)
  const cartTargets = [
    ...document.querySelectorAll('[data-cart-link]'),
    ...document.querySelectorAll('#cart-link')
  ];
  cartTargets.forEach(el => {
    el.setAttribute('href', `https://${SHOPIFY.shop}/cart`);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
    if (el.tagName !== 'A') {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openCartTab();
      });
    }
  });

  updateCartCount();
  setInterval(updateCartCount, 10000); // auto-refresh count

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

  // Wire events
  wireCards(items);
}

// ================ RENDER ================
function productCard(p){
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
          <input type="checkbox" class="powder"/> Powdercoat Black +$${p.powdercoat_price||50}
        </label>
      </div>
      <button class="btn add">ADD TO CART</button>
    </div>
  </div>`;
}

// ================ WIRING ================
function wireCards(items){
  document.querySelectorAll('.card').forEach(card=>{
    const product = items.find(x=>x.id === card.dataset.id);
    const btn = card.querySelector('.add');
    const qtyEl = card.querySelector('.qty');
    const powderEl = card.querySelector('.powder');

    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', async ()=>{
        const qty = Math.max(1, parseInt(qtyEl?.value || '1', 10));
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (variantId) await addToCart(variantId, qty);
        await updateCartCount();
        openCartTab();
      });
      return;
    }

    const vmap = product.variant_ids || {};
    const opt1 = card.querySelector('.opt1');
    const opt2 = card.querySelector('.opt2');
    const opt3 = card.querySelector('.opt3');

    opt1?.addEventListener('change', ()=>{
      const o1 = opt1.value;
      const o2Vals = Object.keys(vmap[o1] || {});
      if (opt2) opt2.innerHTML = o2Vals.map(v=>`<option value="${v}">${v}</option>`).join('');
      const o2 = opt2 ? opt2.value : o2Vals[0];
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
        ? Object.keys(vmap[o1][o2]) : [];
      if (opt3) opt3.innerHTML = o3Vals.map(v=>`<option value="${v}">${v}</option>`).join('');
    });

    opt2?.addEventListener('change', ()=>{
      const o1 = opt1 ? opt1.value : Object.keys(vmap)[0];
      const o2 = opt2.value;
      const o3Vals = (vmap[o1] && vmap[o1][o2] && typeof vmap[o1][o2] === 'object')
        ? Object.keys(vmap[o1][o2]) : [];
      if (opt3) opt3.innerHTML = o3Vals.map(v=>`<option value="${v}">${v}</option>`).join('');
    });

    btn.addEventListener('click', async ()=>{
      const o1 = opt1 ? opt1.value : Object.keys(vmap)[0];
      const o2 = opt2 ? opt2.value : (vmap[o1] ? Object.keys(vmap[o1])[0] : '');
      const node = vmap[o1]?.[o2];
      const o3 = opt3 ? opt3.value : (node && typeof node === 'object' ? Object.keys(node)[0] : '');
      const qty = Math.max(1, parseInt(qtyEl?.value || '1', 10));

      let variantId = null;
      if (typeof node === 'object') {
        variantId = node?.[o3] || null;     // 3-level map
      } else {
        variantId = vmap[o1]?.[o2] || null; // 2-level map
      }

      if (variantId) {
        await addToCart(variantId, qty);
      }
      if (powderEl && powderEl.checked && product.powdercoat_variant_id) {
        await addToCart(product.powdercoat_variant_id, 1);
      }

      await updateCartCount();
      openCartTab();
    });
  });
}

// ================ FILTERS ================
function initFilters(){
  document.querySelectorAll('.toggle').forEach(t=>{
    t.addEventListener('click',()=>{
      t.classList.toggle('active');
      updateUrlFromFilters();
      loadProducts();
    });
  });
  const params = new URLSearchParams(window.location.search);
  const tags = params.getAll('tag');
  if(tags.length){
    document.querySelectorAll('.toggle').forEach(t=>{
      if(tags.includes(t.dataset.tag)) t.classList.add('active');
    });
  }
}
function getActiveTags(){
  return Array.from(document.querySelectorAll('.toggle.active')).map(el=>el.dataset.tag);
}
function updateUrlFromFilters(){
  const tags = getActiveTags();
  const params = new URLSearchParams();
  tags.forEach(t=>params.append('tag',t));
  const newUrl = window.location.pathname + (tags.length?('?'+params.toString()):'');
  history.replaceState({},'',newUrl);
}
