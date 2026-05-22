/* ============================================
   TENXIX — Main JavaScript
   ============================================ */

// ---------- Navbar Scroll Effect ----------
const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
});

// ---------- Mobile Menu ----------
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');

hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('open');
  navLinks.classList.toggle('open');
});

// Close menu on link click
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
  });
});

// ---------- Scroll Animations ----------
const fadeElements = document.querySelectorAll('.fade-up');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1 });

fadeElements.forEach(el => observer.observe(el));

// ---------- Cart System ----------
let cart = JSON.parse(localStorage.getItem('tenxix_cart')) || [];

const FREE_SHIPPING_THRESHOLD = 30000;

function saveCart() {
  localStorage.setItem('tenxix_cart', JSON.stringify(cart));
  updateCartUI();
}

function updateCartUI() {
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  // Update cart count badges (header icon)
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = totalQty;
    el.style.display = totalQty > 0 ? 'flex' : 'none';
  });

  // Update cart count text in sidebar header "Your Cart (X)"
  document.querySelectorAll('.cart-count-text').forEach(el => {
    el.textContent = totalQty;
  });

  // Update cart sidebar if it exists
  const cartItems = document.querySelector('.cart-items');
  if (!cartItems) return;

  if (cart.length === 0) {
    cartItems.innerHTML = '<div class="cart-empty"><p>Your cart is empty</p><p style="font-size:0.85rem;margin-top:8px;">Add a product to start your glow-up</p></div>';
  } else {
    cartItems.innerHTML = cart.map((item, i) => `
      <div class="cart-item">
        <div class="cart-item-image">${item.name.charAt(0)}</div>
        <div class="cart-item-details">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">\u20A6${item.price.toLocaleString()}</div>
          <div class="cart-item-qty">
            <button onclick="changeQty(${i}, -1)">−</button>
            <span>${item.qty}</span>
            <button onclick="changeQty(${i}, 1)">+</button>
          </div>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart(${i})">Remove</button>
      </div>
    `).join('');
  }

  // Update subtotal
  const totalEl = document.querySelector('.cart-total-amount');
  if (totalEl) {
    totalEl.textContent = `\u20A6${subtotal.toLocaleString()}`;
  }

  // Free shipping is always on right now \u2014 show the live countdown
  // instead of a threshold progress. promo-countdown.js owns the timer
  // and updates any .promo-countdown span we drop into the message.
  const progressText = document.querySelector('.cart-progress-text');
  const progressFill = document.querySelector('.cart-progress-fill');
  if (progressText) {
    progressText.classList.add('unlocked');
    progressText.innerHTML = '\u{1F389} <strong>FREE SHIPPING</strong> ends in <span class="promo-countdown">23:59:59</span>';
  }
  if (progressFill) {
    progressFill.classList.add('unlocked');
    progressFill.style.width = '100%';
  }
}

function addToCart(name, price) {
  const existing = cart.find(item => item.name === name);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ name, price, qty: 1 });
  }
  saveCart();
  openCart();

  // Fire AddToCart to the buyer's pixel(s) — no-op for organic visits.
  if (window.erpBridge && typeof window.erpBridge.trackEvent === 'function') {
    window.erpBridge.trackEvent('AddToCart', {
      value: price,
      currency: 'NGN',
      content_ids: [name],
      content_type: 'product',
    });
  }
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
}

function changeQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) {
    cart.splice(index, 1);
  }
  saveCart();
}

// Cart sidebar toggle
function openCart() {
  document.querySelector('.cart-overlay')?.classList.add('open');
  document.querySelector('.cart-sidebar')?.classList.add('open');
}

function closeCart() {
  document.querySelector('.cart-overlay')?.classList.remove('open');
  document.querySelector('.cart-sidebar')?.classList.remove('open');
}

document.querySelector('.cart-overlay')?.addEventListener('click', closeCart);
document.querySelector('.cart-close')?.addEventListener('click', closeCart);

// Init cart UI
updateCartUI();

// ---------- Toast Notification ----------
function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ---------- Contact Form ----------
const contactForm = document.querySelector('.contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast('Thank you! We\'ll be in touch soon.');
    contactForm.reset();
  });
}

// ---------- Video Testimonial Reel ----------
function playVideo(cardEl) {
  // If there's a <video> inside, play it inline
  const v = cardEl.querySelector('video');
  if (v) {
    if (v.paused) { v.play(); v.controls = true; } else { v.pause(); v.controls = false; }
    return;
  }
  // Otherwise toast — replace this with your modal/embed logic when videos are ready
  showToast('Video coming soon — drop your customer video file in here');
}

// ---------- Hero Carousel ----------
let heroIndex = 0;
let heroInterval = null;
const heroSlides = document.querySelectorAll('.hero-slide');
const heroDots = document.querySelectorAll('.hero-dot');
const HERO_DURATION = 6000;

function heroGoTo(index) {
  if (!heroSlides.length) return;
  heroIndex = (index + heroSlides.length) % heroSlides.length;
  heroSlides.forEach((s, i) => s.classList.toggle('active', i === heroIndex));
  heroDots.forEach((d, i) => d.classList.toggle('active', i === heroIndex));
  resetHeroTimer();
}
function heroChange(delta) { heroGoTo(heroIndex + delta); }
function resetHeroTimer() {
  if (heroInterval) clearInterval(heroInterval);
  heroInterval = setInterval(() => heroGoTo(heroIndex + 1), HERO_DURATION);
}
if (heroSlides.length > 0) {
  resetHeroTimer();
  // Pause on hover
  const heroEl = document.querySelector('.hero');
  if (heroEl) {
    heroEl.addEventListener('mouseenter', () => clearInterval(heroInterval));
    heroEl.addEventListener('mouseleave', resetHeroTimer);
  }
}

// ---------- Kira Modal ----------
function openKira() {
  const overlay = document.querySelector('.kira-modal-overlay');
  const modal = document.querySelector('.kira-modal');
  const iframe = document.querySelector('.kira-modal-body iframe');
  const loader = document.querySelector('.kira-modal-loading');
  if (!overlay || !modal) return;
  if (iframe && !iframe.dataset.loaded) {
    iframe.src = iframe.dataset.src;
    iframe.dataset.loaded = '1';
    iframe.addEventListener('load', () => {
      if (loader) loader.classList.add('hidden');
    }, { once: true });
    setTimeout(() => { if (loader) loader.classList.add('hidden'); }, 4000);
  }
  overlay.classList.add('open');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeKira() {
  const overlay = document.querySelector('.kira-modal-overlay');
  const modal = document.querySelector('.kira-modal');
  if (!overlay || !modal) return;
  overlay.classList.remove('open');
  modal.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeKira();
});

// ---------- Bundle Builder ----------
const bundleSelections = {};
document.querySelectorAll('.bundle-item').forEach(item => {
  const name = item.querySelector('.bundle-item-name')?.textContent;
  const onclickAttr = item.getAttribute('onclick') || '';
  const match = onclickAttr.match(/toggleBundle\(this,\s*'([^']+)',\s*(\d+)/);
  if (match) {
    bundleSelections[match[1]] = { selected: true, price: parseInt(match[2]) };
  }
});

function toggleBundle(el, name, price) {
  el.classList.toggle('selected');
  bundleSelections[name] = { selected: el.classList.contains('selected'), price };
  updateBundleSummary();
}

function updateBundleSummary() {
  const rows = document.getElementById('bundleRows');
  if (!rows) return;
  let subtotal = 0;
  const lines = [];
  Object.keys(bundleSelections).forEach(name => {
    const item = bundleSelections[name];
    if (item.selected) {
      subtotal += item.price;
      lines.push(`<div class="bundle-summary-row"><span>${name}</span><span>₦${item.price.toLocaleString()}</span></div>`);
    }
  });
  rows.innerHTML = lines.length ? lines.join('') : '<div class="bundle-summary-row"><span>No items selected</span></div>';
  const selectedCount = Object.values(bundleSelections).filter(i => i.selected).length;
  const discount = selectedCount >= 2 ? Math.round(subtotal * 0.15) : 0;
  const total = subtotal - discount;
  document.getElementById('bundleSubtotal').textContent = `₦${subtotal.toLocaleString()}`;
  document.getElementById('bundleDiscount').textContent = discount > 0 ? `−₦${discount.toLocaleString()}` : '₦0';
  document.getElementById('bundleTotal').textContent = `₦${total.toLocaleString()}`;
}

function addBundleToCart() {
  const selected = Object.entries(bundleSelections).filter(([_, v]) => v.selected);
  if (selected.length === 0) {
    showToast('Select at least one product');
    return;
  }
  const discount = selected.length >= 2 ? 0.85 : 1;
  selected.forEach(([name, item]) => {
    addToCart(name, Math.round(item.price * discount));
  });
  showToast(`Bundle added — saved 15%!`);
}

// ---------- Sticky Cart Bar ----------
const stickyBar = document.querySelector('.sticky-cart-bar');
if (stickyBar) {
  const trigger = document.querySelector('.product-page-actions');
  if (trigger) {
    const observerSticky = new IntersectionObserver(([entry]) => {
      stickyBar.classList.toggle('visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold: 0 });
    observerSticky.observe(trigger);
  }
}

// ---------- Product Filtering (Products & Shop pages) ----------
const filterBtns = document.querySelectorAll('.filter-btn');
const productCards = document.querySelectorAll('.product-card[data-category]');

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;

    productCards.forEach(card => {
      if (filter === 'all' || card.dataset.category === filter) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  });
});
