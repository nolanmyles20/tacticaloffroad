
// ================= CONFIG =================
const SHOPIFY   = { shop: 'tacticaloffroad.myshopify.com' };
const SF_TOKEN  = '7f1d57625124831f8f9c47a088e48fb8';
const SF_URL    = `https://${SHOPIFY.shop}/api/2024-07/graphql.json`;

const CART_NAME   = 'SHOPIFY_CART_TAB';    // the single, reused browser tab name
const LS_CARTID   = 'SF_CART_ID';          // localStorage key for Storefront Cart ID
const LS_CHECKOUT = 'SF_CHECKOUT_URL';     // localStorage key for checkout URL

const DEBUG = false;

// ================= SMALL UTILS =================
const log  = (...a)=>DEBUG&&console.log('[cart]',...a);
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
function setBadge(n){ const el=document.getElementById('cart-count'); if(el) el.textContent=String(n??0); }

// Convert numeric Shopify variant id → Storefront Base64 GID (if needed)
function toVariantGID(id){
  const s = String(id).trim();
  if (s.startsWith('gid://')) return btoa(s);
  try { if (atob(s).startsWith('gid://')) return s; } catch {}
  return btoa(`gid://shopify/ProductVariant/${s}`);
}

// Always open/reuse a single named cart tab
function openInCartTab(url){
  const a = document.createElement('a');
  a.href   = url;
  a.target = CART_NAME;   // this ensures reuse of the same tab
  a.rel    = 'noreferrer';
  a.style.display='none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ================= STOREFRONT API CORE =================
async function sf(query, variables){
  const r = await fetch(SF_URL, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'X-Shopify-Storefront-Access-Token': SF_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function ensureCart(){
  let id = localStorage.getItem(LS_CARTID);
  let checkoutUrl = localStorage.getItem(LS_CHECKOUT);
  if (id && checkoutUrl) return { id, checkoutUrl };

  const q = `
    mutation CreateCart {
      cartCreate {
        cart { id checkoutUrl totalQuantity }
        userErrors { field message }
      }
    }`;
  const d = await sf(q, {});
  const cart = d.cartCreate.cart;
  id = cart.id;
  checkoutUrl = cart.checkoutUrl;
  localStorage.setItem(LS_CARTID, id);
  localStorage.setItem(LS_CHECKOUT, checkoutUrl);
  log('created cart', id);
  return { id, checkoutUrl };
}

async function getCartQuantity(){
  const id = localStorage.getItem(LS_CARTID);
  if (!id) return 0;
  const q = `query GetCart($id: ID!){ cart(id:$id){ totalQuantity } }`;
  try {
    const d = await sf(q, { id });
    return Number(d.cart?.totalQuantity ?? 0);
  } catch { return 0; }
}

async function addLine(variantId, qty){
  const cart = await ensureCart();
  const q = `
    mutation AddLines($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { id totalQuantity checkoutUrl }
        userErrors { field message }
      }
    }`;
  const vars = {
    cartId: cart.id,
    lines: [{ merchandiseId: toVariantGID(variantId), quantity: Math.max(1, Number(qty)||1) }]
  };
  const d = await sf(q, vars);
  const errs = d.cartLinesAdd.userErrors;
  if (errs && errs.length) throw new Error(errs.map(e=>e.message).join('; '));
  const c = d.cartLinesAdd.cart;
  if (c.checkoutUrl) localStorage.setItem(LS_CHECKOUT, c.checkoutUrl);
  return c.totalQuantity ?? 0;
}

async function addTwoLinesSequential(v1,q1,v2,q2){
  await addLine(v1,q1);
  await wait(350);                 // avoids racing on some mobile browsers
  await addLine(v2,q2);
}

async function handleAddToCart(variantId, qty, powderVariantId){
  try{
    const cart = await ensureCart();
    if (powderVariantId){
      await addTwoLinesSequential(variantId, qty, powderVariantId, 1);
    } else {
      await addLine(variantId, qty);
    }
    const n = await getCartQuantity();
    setBadge(n);
    openInCartTab(localStorage.getItem(LS_CHECKOUT) || cart.checkoutUrl);
  }catch(err){
    console.error('Add to cart failed', err);
    const c = await ensureCart();
    openInCartTab(c.checkoutUrl); // still show the cart tab even if add failed
  }
}

async function refreshBadge(){
  setBadge(await getCartQuantity());
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

// ================= HOTSPOT SCROLL =================
function scrollToEl(el) {
  if (!el) return;
  const navHVar = getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim();
  const navH = parseInt(navHVar || '0', 10) || 0;
  const extra = 20;
  const top = el.getBoundingClientRect().top + window.pageYOffset - (navH + extra);
  window.scrollTo({ top, behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ================= DATA LOAD (products) =================
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

  // Featured
  const fg = document.getElementById('featured-grid');
  if (fg) {
    const platforms = ['Humvee', 'Jeep', 'AR-15', 'Cross-Karts'];
    const picks = platforms.map(pl => items.find(p => p.platforms.includes(pl))).filter(Boolean);
    fg.innerHTML = picks.map(p => productCard(p)).join('');
  }

  wireCards(items);
}

// ================= RENDER (cards) =================
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

// ================= WIRING (cards → add-to-cart) =================
function wireCards(items) {
  document.querySelectorAll('.card').forEach(card => {
    const product = items.find(x => x.id === card.dataset.id);
    const btn  = card.querySelector('.add');
    const qty  = card.querySelector('.qty');
    const coat = card.querySelector('.powder');

    if (!btn) return;

    if (product.simple) {
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', async () => {
        const q = Math.max(1, parseInt(qty?.value, 10) || 1);
        const variantId = (product.variant_ids?.Solo || {})[varSel?.value || 'Default'];
        if (!variantId) return;
        await handleAddToCart(
          variantId,
          q,
          (coat && coat.checked && product.powdercoat_variant_id) ? product.powdercoat_variant_id : null
        );
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

    btn.addEventListener('click', async () => {
      const o1 = o1Sel ? o1Sel.value : Object.keys(vmap)[0];
      const o2 = o2Sel ? o2Sel.value : (vmap[o1] ? Object.keys(vmap[o1])[0] : '');
      const node = vmap[o1]?.[o2];
      const o3 = o3Sel ? o3Sel.value : (node && typeof node === 'object' ? Object.keys(node)[0] : '');
      const q  = Math.max(1, parseInt(qty?.value, 10) || 1);

      let variantId = null;
      if (typeof node === 'object') variantId = node?.[o3] || null;   // 3-level options
      else variantId = vmap[o1]?.[o2] || null;                        // 2-level options

      if (!variantId) return;
      await handleAddToCart(
        variantId,
        q,
        (coat && coat.checked && product.powdercoat_variant_id) ? product.powdercoat_variant_id : null
      );
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

// ================= BOOT =================
document.addEventListener('DOMContentLoaded', async () => {
  // Cart button(s) always open the *current* checkout in the SAME named tab
  const cartLinks = [...document.querySelectorAll('[data-cart-link], #cart-link')];
  if (cartLinks.length){
    const c = await ensureCart();
    cartLinks.forEach(el=>{
      el.setAttribute('href', c.checkoutUrl);
      el.setAttribute('target', CART_NAME);
      el.removeAttribute('rel');
      el.addEventListener('click', () => {
        setTimeout(refreshBadge, 1200);
        setTimeout(refreshBadge, 3000);
      });
    });
  }

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

  // Initial badge + keep in sync
  await refreshBadge();
  setInterval(refreshBadge, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });

  // Filters + products
  try { initFilters(); } catch (e) { console.warn('initFilters error', e); }
  loadProducts().catch(err => console.error('loadProducts failed', err));
});

// ================= HOTSPOT HANDLER =================
document.addEventListener('click', (e) => {
  const spot = e.target.closest('.hotspot');
  if (!spot) return;
  const sel = spot.getAttribute('data-target');
  if (!sel) return;
  const target = document.querySelector(sel);
  if (!target) return;
  scrollToEl(target);
});
