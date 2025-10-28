
const SHOPIFY = { shop:'tacticaloffroad.myshopify.com' }; // <-- change me

document.addEventListener('DOMContentLoaded',()=>{
  const c=document.getElementById('cart-link');
  if(c) c.href=`https://${SHOPIFY.shop}/cart`;
  initFilters();
  loadProducts();
});

async function loadProducts(){
  const res = await fetch('assets/products.json'); if(!res.ok) return;
  const items = await res.json();

  // Category grids
  const grids = document.querySelectorAll('#product-grid');
  grids.forEach(grid=>{
    const cat = grid.getAttribute('data-category');
    const activeTags = getActiveTags();
    const subset = items.filter(p=>p.platforms.includes(cat)).filter(p=>{
      if(activeTags.length===0) return true;
      return activeTags.every(t=>p.tags.includes(t));
    });
    grid.innerHTML = subset.map(p=>productCard(p)).join('') || '<p>No products match those filters.</p>';
  });

  // Featured grid (home) — one per platform including Cross-Karts
  const fg = document.getElementById('featured-grid');
  if(fg){
    const platforms = ['Humvee','Jeep','AR-15','Cross-Karts'];
    const picks = platforms.map(pl=>items.find(p=>p.platforms.includes(pl))).filter(Boolean);
    fg.innerHTML = picks.map(p=>productCard(p)).join('');
  }

  // Wire dynamic selects + buttons after render
  wireCards(items);
}

function productCard(p){
  // Simple products (e.g., Cross-Karts "Solo") render different controls
  if(p.simple){
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

  // Standard Armor/Stainless products
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

function wireCards(items){
  document.querySelectorAll('.card').forEach(card=>{
    const id = card.dataset.id;
    const product = items.find(x=>x.id===id);
    const btn = card.querySelector('.add');
    const qtyEl = card.querySelector('.qty');

    // Simple product behavior
    if(product.simple){
      const varSel = card.querySelector('.simple-variant');
      btn.addEventListener('click', ()=>{
        const qty = Math.max(1, parseInt(qtyEl.value||'1',10));
        const variantId = (product.variant_ids['Solo']||{})[varSel.value];
        if(!variantId){
          alert('Missing variant mapping for Simple product.');
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

    btn.addEventListener('click', ()=>{
      const material = matSel.value;
      const thickness = thickSel.value; // '1mm' etc
      const qty = Math.max(1, parseInt(qtyEl.value||'1',10));
      const variantId = (product.variant_ids[material]||{})[thickness];
      if(!variantId){
        alert('Missing variant mapping. Update products.json variant_ids.');
        return;
      }
      let cartParts = [`${variantId}:${qty}`];
      if(powderEl && powderEl.checked && product.powdercoat_variant_id){
        cartParts.push(`${product.powdercoat_variant_id}:1`);
      }
      const url = `https://${SHOPIFY.shop}/cart/${cartParts.join(',')}?channel=buy_button`;
      window.location.href = url;
    });
  });
}

// Toggle filter logic with URL sync
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
