/* ============================================
   TENXIX — Checkout Logic
   ============================================ */

(function () {
  const SHIPPING_FLAT = 2500;
  const FREE_SHIPPING_THRESHOLD = 30000;
  const PAYAHEAD_DISCOUNT = 0.05;

  const grid = document.getElementById('checkoutGrid');
  const empty = document.getElementById('checkoutEmpty');
  const success = document.getElementById('checkoutSuccess');
  const itemsEl = document.getElementById('checkoutItems');
  const subtotalEl = document.getElementById('summarySubtotal');
  const shippingEl = document.getElementById('summaryShipping');
  const discountRowEl = document.getElementById('summaryDiscountRow');
  const discountEl = document.getElementById('summaryDiscount');
  const totalEl = document.getElementById('summaryTotal');
  const placeBtn = document.getElementById('placeOrderBtn');

  const fmt = (n) => '₦' + n.toLocaleString();

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem('tenxix_cart')) || [];
    } catch (e) {
      return [];
    }
  }

  function clearCart() {
    localStorage.setItem('tenxix_cart', '[]');
  }

  function selectedPayment() {
    const el = document.querySelector('input[name="payment"]:checked');
    return el ? el.value : 'cod';
  }

  function getTotals(cart) {
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT;
    const payment = selectedPayment();
    const discount = payment === 'paid' ? Math.round(subtotal * PAYAHEAD_DISCOUNT) : 0;
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
    if (shippingEl) shippingEl.textContent = t.shipping === 0 ? 'FREE' : fmt(t.shipping);
    if (totalEl) totalEl.textContent = fmt(t.total);
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
      const totalEl2 = document.getElementById('orderTotal');
      if (idEl) idEl.textContent = orderInfo.id;
      if (phoneEl) phoneEl.textContent = orderInfo.phone;
      if (totalEl2) totalEl2.textContent = fmt(orderInfo.total);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function validateForm() {
    const required = ['fullname', 'phone', 'email', 'address', 'city', 'state'];
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

  function generateOrderId() {
    const random = Math.floor(10000 + Math.random() * 90000);
    return '#TX-' + random;
  }

  function init() {
    const cart = readCart();
    if (cart.length === 0) {
      showEmpty();
      return;
    }
    renderItems(cart);
    renderTotals(cart);

    // Payment method change → re-render totals + active class
    document.querySelectorAll('input[name="payment"]').forEach(input => {
      input.addEventListener('change', () => {
        document.querySelectorAll('.payment-option').forEach(opt => {
          const radio = opt.querySelector('input');
          opt.classList.toggle('payment-option-active', radio && radio.checked);
        });
        renderTotals(cart);
      });
    });

    // Clicking the disabled payment option shows a friendly toast
    document.querySelectorAll('.payment-option-disabled').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof showToast === 'function') {
          showToast('Pay Before Delivery coming soon — use Cash on Delivery for now');
        }
      });
    });

    // Place order
    if (placeBtn) {
      placeBtn.addEventListener('click', () => {
        const missing = validateForm();
        if (missing.length > 0) {
          if (typeof showToast === 'function') showToast('Please fill in all required fields');
          const first = document.getElementById(missing[0]);
          if (first) {
            first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            first.focus();
          }
          return;
        }

        const phone = document.getElementById('phone').value.trim();
        const t = getTotals(readCart());
        const orderId = generateOrderId();

        const order = {
          id: orderId,
          date: new Date().toISOString(),
          customer: {
            name: document.getElementById('fullname').value.trim(),
            phone: phone,
            email: document.getElementById('email').value.trim(),
            address: document.getElementById('address').value.trim(),
            city: document.getElementById('city').value.trim(),
            state: document.getElementById('state').value,
            notes: document.getElementById('notes').value.trim()
          },
          items: cart,
          totals: t,
          payment: t.payment
        };

        try {
          const past = JSON.parse(localStorage.getItem('tenxix_orders')) || [];
          past.push(order);
          localStorage.setItem('tenxix_orders', JSON.stringify(past));
        } catch (e) { /* ignore */ }

        clearCart();
        if (typeof updateCartUI === 'function') updateCartUI();

        showSuccess({ id: orderId, phone: phone, total: t.total });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
