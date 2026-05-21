/* ============================================
   TENXIX — ERP Bridge
   Posts orders to the Earnzaa ERP and captures
   attribution (cmp/cr/utm/landing page) across
   the visit.

   Loaded as a plain <script> on EVERY page so
   attribution gets captured on the page the
   customer actually landed on — not just checkout.

   Exposes:
     window.erpBridge.submitOrderToERP({...})
     window.erpBridge.captureAttribution()
     window.erpBridge.resetIdempotencyKey()
   ============================================ */
(function () {
  // ─── CONFIG ────────────────────────────────────────────────────────
  var SUPABASE_URL = 'https://neqtdckyrowyechbeppr.supabase.co';

  // Fallback slug — ERP prefers URL resolution. Slug is only used when
  // the current page URL isn't registered in order_form_landing_pages.
  var FALLBACK_FORM_SLUG  = 'tenxix-acne-complex';
  var FALLBACK_FORM_TOKEN = '19cf3c51-59e5-4840-a07a-2d161923cbef';

  // SKU → ERP product map. Single-unit products = pack 1.
  var PRODUCT_MAP = {
    'rapid-glow-corrector-serum':            { product_id: '4499cb30-467e-463d-a712-34f9fbfabfea', pack: 1, is_subscription: false },
    'acne-complex-4-serum':                  { product_id: 'fa422213-dbbd-4b69-bfa5-9d543905a90a', pack: 1, is_subscription: false },
    'clear-glow-soap':                       { product_id: 'd3c64137-4f63-4580-b526-2a1b60b65669', pack: 1, is_subscription: false },
    'body-scrub':                            { product_id: '3d26bc5e-d9ba-43bb-b243-7caacc178156', pack: 1, is_subscription: false },
    'orange-exfoliating-gel':                { product_id: 'adc8d7e7-a8c2-4f35-a490-889001fe9f19', pack: 1, is_subscription: false },
    'acne-complex-4-serum-3-pack-subscribe': { product_id: 'fa422213-dbbd-4b69-bfa5-9d543905a90a', pack: 3, is_subscription: true },
    'clear-glow-soap-3-pack-subscribe':      { product_id: 'd3c64137-4f63-4580-b526-2a1b60b65669', pack: 3, is_subscription: true },
    'clear-glow-soap-6-pack-subscribe':      { product_id: 'd3c64137-4f63-4580-b526-2a1b60b65669', pack: 6, is_subscription: true },
  };

  // Tenxix dropdown shows some state names slightly differently than ERP
  // expects. Map them here so customers see what they're used to and
  // ERP gets what it validates against.
  var STATE_MAP = {
    'Abuja FCT': 'FCT',
  };

  // Payment radio value (HTML) → ERP payment.method
  var PAYMENT_METHOD_MAP = {
    'cod': 'cod',
    'online': 'prepaid',
  };
  // ───────────────────────────────────────────────────────────────────

  var ENDPOINT = SUPABASE_URL + '/functions/v1/submit-external-order/' + FALLBACK_FORM_SLUG;
  var ATTR_KEY = 'erp_attribution_v1';
  var IDEM_KEY = 'erp_idempotency_v1';

  function canonicalUrl(u) {
    try {
      var parsed = new URL(u);
      var path = parsed.pathname;
      if (path.length > 1 && path.charAt(path.length - 1) === '/') {
        path = path.slice(0, -1);
      }
      return parsed.protocol + '//' + parsed.host + path;
    } catch (e) { return u; }
  }

  // Capture attribution on EVERY page load. Preserves the first
  // landing_page_url for the session so when the customer navigates
  // ad-page → checkout, the original ad-tagged URL is what reaches ERP.
  function captureAttribution() {
    if (typeof window === 'undefined') return;
    var params = new URLSearchParams(window.location.search);
    var carry = ['cmp','cr','pg','ref','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];

    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(ATTR_KEY) || '{}'); } catch (e) {}

    // Always refresh tracking params if the URL carries them (e.g. user
    // landed on a different ad after starting a session).
    for (var i = 0; i < carry.length; i++) {
      var k = carry[i];
      var v = params.get(k);
      if (v) stored[k] = v;
    }

    // landing_page_url stays as the FIRST page they hit this session.
    // Don't overwrite on later page loads — checkout.html is not a
    // landing page.
    if (!stored.landing_page_url) {
      stored.landing_page_url = canonicalUrl(window.location.href);
    }
    if (!stored.referrer) {
      stored.referrer = document.referrer || null;
    }

    sessionStorage.setItem(ATTR_KEY, JSON.stringify(stored));
  }

  function readAttribution() {
    try { return JSON.parse(sessionStorage.getItem(ATTR_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function getOrCreateIdempotencyKey() {
    var k = sessionStorage.getItem(IDEM_KEY);
    if (!k) {
      k = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(IDEM_KEY, k);
    }
    return k;
  }

  function resetIdempotencyKey() {
    sessionStorage.removeItem(IDEM_KEY);
  }

  function normalizeState(s) {
    if (!s) return s;
    return STATE_MAP[s] || s;
  }

  function normalizePaymentMethod(m) {
    return PAYMENT_METHOD_MAP[m] || 'cod';
  }

  async function submitOrderToERP(opts) {
    var cart = opts.cart || [];
    var customer = opts.customer || {};
    var address = opts.address || {};
    var pricing = opts.pricing || {};
    var payment = opts.payment || {};

    var items = [];
    for (var i = 0; i < cart.length; i++) {
      var line = cart[i];
      var map = PRODUCT_MAP[line.sku];
      if (!map) throw new Error('Unknown SKU "' + line.sku + '" — add it to PRODUCT_MAP');
      items.push({
        product_id: map.product_id,
        tier_id: null,
        label: line.label || line.sku,
        quantity: (line.quantity || 1) * map.pack,
        unit_price: Math.round(((line.unit_price || 0) / map.pack) * 100) / 100,
        is_subscription: !!map.is_subscription,
      });
    }

    var payload = {
      token: FALLBACK_FORM_TOKEN,
      idempotency_key: getOrCreateIdempotencyKey(),
      customer: {
        full_name: customer.full_name,
        email: customer.email || null,
        phone: customer.phone,
        alt_phone: customer.alt_phone || null,
      },
      address: {
        line1: address.line1,
        city: address.city || null,
        state: normalizeState(address.state),
        postal_code: address.postal_code || null,
        delivery_notes: address.delivery_notes || null,
        type: address.type || null,
      },
      items: items,
      pricing: {
        subtotal: pricing.subtotal,
        shipping: pricing.shipping || 0,
        discount_amount: pricing.discount_amount || 0,
        discount_code: pricing.discount_code || null,
        total: pricing.total,
      },
      payment: {
        method: normalizePaymentMethod(payment.method),
        status: payment.status || 'unpaid',
        provider: payment.provider || null,
        provider_ref: payment.provider_ref || null,
      },
      attribution: readAttribution(),
      _hp_field: '',
    };

    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    if (!data.success) {
      throw new Error((data.code || 'ERROR') + ': ' + (data.error || 'Unknown failure'));
    }
    resetIdempotencyKey();
    return data;
  }

  // Auto-capture on every page load so attribution sticks across navigation.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', captureAttribution);
  } else {
    captureAttribution();
  }

  window.erpBridge = {
    submitOrderToERP: submitOrderToERP,
    captureAttribution: captureAttribution,
    resetIdempotencyKey: resetIdempotencyKey,
  };
})();
