/* ============================================
   TENXIX — Checkout Logic (ERP-integrated)
   Loaded as a plain <script> on checkout.html.
   Requires erp-bridge.js to be loaded first.

   Wrapped in an IIFE so our top-level const/let
   don't collide with main.js (which declares its
   own FREE_SHIPPING_THRESHOLD etc. at top scope).
   ============================================ */
(function () {

// Real shipping the customer pays = 0 (promo).
// The "strikethrough" amount we display in the order summary so the
// customer feels they're being gifted shipping.
const SHIPPING_FLAT = 0;
const SHIPPING_PROMO_AMOUNT = 3500;
const PAYAHEAD_DISCOUNT = 0.05;

// ─── Product name → ERP SKU mapping ─────────────────────────────────
const BASE_SKU_MAP = {
  'Acne Complex-4 Serum':         'acne-complex-4-serum',
  'Rapid Glow & Corrector Serum': 'rapid-glow-corrector-serum',
  'Clear Glow Exfoliating Soap':  'clear-glow-soap',
};

// Subscribe SKUs that exist in the bridge's PRODUCT_MAP
const KNOWN_SUBSCRIBE_SKUS = new Set([
  'acne-complex-4-serum-3-pack-subscribe',
  'clear-glow-soap-3-pack-subscribe',
  'clear-glow-soap-6-pack-subscribe',
]);

function convertCartItem(item) {
  const m = item.name.match(/^(.+?)\s*\((\d+)-Pack\s+([\w-]+)\)\s*$/);
  const baseName = (m ? m[1] : item.name).trim();
  const pack = m ? parseInt(m[2], 10) : 1;
  const isSubscribe = m ? /^subscribe$/i.test(m[3]) : false;

  const baseSku = BASE_SKU_MAP[baseName];
  if (!baseSku) throw new Error(`Unknown product: "${baseName}". Add to BASE_SKU_MAP.`);

  if (pack === 1) {
    return { sku: baseSku, label: item.name, quantity: item.qty, unit_price: item.price };
  }

  const subSku = `${baseSku}-${pack}-pack-subscribe`;
  if (isSubscribe && KNOWN_SUBSCRIBE_SKUS.has(subSku)) {
    return { sku: subSku, label: item.name, quantity: item.qty, unit_price: item.price };
  }

  // No matching subscribe SKU → submit as N base units at per-unit price
  return {
    sku: baseSku,
    label: item.name,
    quantity: item.qty * pack,
    unit_price: Math.round((item.price / pack) * 100) / 100,
  };
}

// ─── DOM refs ───────────────────────────────────────────────────────
const grid = document.getElementById('checkoutGrid');
const empty = document.getElementById('checkoutEmpty');
const success = document.getElementById('checkoutSuccess');
const itemsEl = document.getElementById('checkoutItems');
const subtotalEl = document.getElementById('sumSubtotal');
const shippingEl = document.getElementById('sumShipping');
const discountRowEl = document.getElementById('sumDiscountRow');
const discountEl = document.getElementById('sumDiscount');
const totalEl = document.getElementById('sumTotal');
const placeOrderTotalEl = document.getElementById('placeOrderTotal');
const placeBtn = document.getElementById('placeOrderBtn');

const fmt = (n) => '₦' + Math.round(n).toLocaleString();

// ─── Cart ───────────────────────────────────────────────────────────
function readCart() {
  try { return JSON.parse(localStorage.getItem('tenxix_cart')) || []; }
  catch (e) { return []; }
}

function clearCart() {
  localStorage.setItem('tenxix_cart', '[]');
}

function selectedPayment() {
  const el = document.querySelector('input[name="paymentMethod"]:checked');
  return el ? el.value : 'cod';
}

function getTotals(cart) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  // Shipping is currently free (SHIPPING_FLAT = 0). We still send it to the
  // ERP as a separate field so the columns are consistent when shipping
  // charges resume later.
  const shipping = SHIPPING_FLAT;
  const payment = selectedPayment();
  // Pay-ahead discount applies only when customer selects the prepaid option.
  const discount = payment === 'online' ? Math.round(subtotal * PAYAHEAD_DISCOUNT) : 0;
  const total = subtotal + shipping - discount;
  return { subtotal, shipping, discount, total, payment };
}

function renderItems(cart) {
  if (!itemsEl) return;
  itemsEl.innerHTML = cart.map(item => `
    <div class="checkout-item">
      <div class="checkout-item-image">
        ${item.name.charAt(0)}
        <span class="checkout-item-qty-badge">${item.qty}</span>
      </div>
      <div class="checkout-item-details">
        <p class="checkout-item-name">${item.name}</p>
        <p class="checkout-item-meta">${item.qty} × ${fmt(item.price)}</p>
      </div>
      <div class="checkout-item-price">${fmt(item.price * item.qty)}</div>
    </div>
  `).join('');
}

function renderTotals(cart) {
  const t = getTotals(cart);
  if (subtotalEl) subtotalEl.textContent = fmt(t.subtotal);
  if (shippingEl) {
    if (t.shipping === 0) {
      // Strikethrough the "was" price + show countdown so customer
      // perceives shipping as a gifted promo, not a baseline freebie.
      shippingEl.innerHTML =
        '<span style="text-decoration:line-through;color:var(--gray-dark);font-weight:400;margin-right:6px;">' +
        fmt(SHIPPING_PROMO_AMOUNT) +
        '</span>' +
        '<strong style="color:#0a8f3e;">FREE</strong>' +
        '<span style="display:block;font-size:0.75rem;color:var(--gray-dark);font-weight:400;margin-top:2px;">' +
        'ends in <span class="promo-countdown">23:59:59</span>' +
        '</span>';
    } else {
      shippingEl.textContent = fmt(t.shipping);
    }
  }
  if (totalEl) totalEl.textContent = fmt(t.total);
  if (placeOrderTotalEl) placeOrderTotalEl.textContent = fmt(t.total);
  if (discountRowEl) {
    if (t.discount > 0) {
      discountRowEl.style.display = '';
      if (discountEl) discountEl.textContent = '−' + fmt(t.discount);
    } else {
      discountRowEl.style.display = 'none';
    }
  }
}

function showEmpty() {
  if (grid) grid.style.display = 'none';
  if (empty) empty.style.display = '';
  if (success) success.style.display = 'none';
}

function showSuccess(orderInfo) {
  if (grid) grid.style.display = 'none';
  if (empty) empty.style.display = 'none';
  if (success) {
    success.style.display = '';
    const idEl = document.getElementById('orderId');
    const phoneEl = document.getElementById('orderPhone');
    const amountEl = document.getElementById('orderAmount');
    if (idEl) idEl.textContent = orderInfo.id;
    if (phoneEl) phoneEl.textContent = orderInfo.phone;
    if (amountEl) amountEl.textContent = fmt(orderInfo.total);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function validateForm() {
  const required = ['fullName', 'phone', 'email', 'address', 'city', 'state'];
  const missing = [];
  required.forEach(name => {
    const el = document.getElementById(name);
    if (!el || !el.value.trim()) {
      missing.push(name);
      if (el) el.style.borderColor = '#E63946';
    } else if (el) {
      el.style.borderColor = '';
    }
  });
  return missing;
}

function fallbackOrderId() {
  const random = Math.floor(10000 + Math.random() * 90000);
  return 'TX-' + random;
}

async function handlePlaceOrder() {
  if (!window.erpBridge) {
    console.error('erp-bridge.js is not loaded — include it before checkout.js');
    alert('Checkout is not ready. Refresh the page and try again.');
    return;
  }

  const cart = readCart();
  if (cart.length === 0) {
    if (typeof window.showToast === 'function') window.showToast('Your cart is empty — add a product first');
    else alert('Your cart is empty.');
    return;
  }

  const missing = validateForm();
  if (missing.length > 0) {
    if (typeof window.showToast === 'function') window.showToast('Please fill all required fields');
    const first = document.getElementById(missing[0]);
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.focus();
    }
    return;
  }

  const phone = document.getElementById('phone').value.trim();
  const t = getTotals(cart);

  const originalHTML = placeBtn ? placeBtn.innerHTML : '';
  if (placeBtn) {
    placeBtn.disabled = true;
    placeBtn.innerHTML = 'Placing order…';
  }

  try {
    const items = cart.map(convertCartItem);

    const result = await window.erpBridge.submitOrderToERP({
      cart: items,
      customer: {
        full_name: document.getElementById('fullName').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: phone,
      },
      address: {
        line1: document.getElementById('address').value.trim(),
        city: document.getElementById('city').value.trim(),
        state: document.getElementById('state').value,
        postal_code: document.getElementById('zip').value.trim() || null,
        delivery_notes: document.getElementById('notes').value.trim() || null,
      },
      pricing: {
        subtotal: t.subtotal,
        shipping: t.shipping,
        discount_amount: t.discount,
        discount_code: t.discount > 0 ? 'PAY_AHEAD_5' : null,
        total: t.total,
      },
      payment: {
        method: t.payment,                     // bridge maps 'online' → 'prepaid'
        status: 'unpaid',                      // until prepaid gateway is wired
      },
    });

    const orderRef = result.order_ref || result.order_id || fallbackOrderId();
    const orderIdStr = String(orderRef).startsWith('#') ? orderRef : '#' + orderRef;

    clearCart();
    if (typeof window.updateCartUI === 'function') window.updateCartUI();

    showSuccess({ id: orderIdStr, phone: phone, total: t.total });
  } catch (err) {
    console.error('ERP submission failed:', err);
    if (typeof window.showToast === 'function') {
      window.showToast('Order failed — please try again or call us');
    }
    alert(`Your order couldn't be submitted right now.\n\n${err.message}\n\nPlease try again or contact us.`);
    if (placeBtn) {
      placeBtn.disabled = false;
      placeBtn.innerHTML = originalHTML;
    }
  }
}

function init() {
  // ALWAYS attach safety net first — catches Enter-key submits + button
  // clicks even before any cart/erpBridge checks. preventDefault stops
  // the native GET-submit that was rewriting checkout.html?fullName=...
  const form = document.getElementById('checkoutForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handlePlaceOrder();
    });
  }
  if (placeBtn) {
    placeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handlePlaceOrder();
    });
  }

  const cart = readCart();
  if (cart.length === 0) {
    showEmpty();
    return;
  }
  renderItems(cart);
  renderTotals(cart);

  // Payment method change → re-render totals + active class
  document.querySelectorAll('input[name="paymentMethod"]').forEach(input => {
    input.addEventListener('change', () => {
      document.querySelectorAll('.payment-method').forEach(opt => {
        const radio = opt.querySelector('input[name="paymentMethod"]');
        opt.classList.toggle('selected', !!(radio && radio.checked));
      });
      renderTotals(cart);
    });
  });

  // Clicking the disabled payment option shows a friendly toast
  document.querySelectorAll('.payment-method.disabled').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window.showToast === 'function') {
        window.showToast('Pay Before Delivery coming soon — use Cash on Delivery for now');
      }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
