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

  // Fallback slug — used only when the current page URL doesn't match
  // a registered row in order_form_landing_pages. Pointed at a generic
  // "Tenxix Storefront — Organic" form so untagged visits (homepage,
  // /shop, /about etc.) get filed under that catch-all bucket instead
  // of leaking into whichever product form happened to be the default.
  // Product-page entries continue to route to their specific form via
  // URL resolution and never touch this fallback.
  var FALLBACK_FORM_SLUG  = 'tenxix-storefront';
  var FALLBACK_FORM_TOKEN = '265670a5-c79c-42bb-b6cd-023a9107798c';

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

  // ── Ad pixel injection (Meta / TikTok) ──────────────────────────────
  // When a visit lands with `cmp=X`, fetch that campaign's pixel config
  // from the ERP and inject ONLY that buyer's pixel(s). Other buyers
  // never see the visit. PageView fires automatically once loaded;
  // AddToCart / InitiateCheckout / Purchase are fired by checkout.js
  // and main.js via window.erpBridge.trackEvent(...).
  var PIXEL_ENDPOINT = SUPABASE_URL + '/functions/v1/pixel-config';
  var pixelConfig = { meta: null, tiktok: null };
  var pixelsInjected = false;

  function loadMetaPixel(pixelId) {
    if (window.fbq) {                                  // already loaded by a prior visit
      try { window.fbq('init', pixelId); window.fbq('track', 'PageView'); } catch (e) {}
      return;
    }
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    try {
      window.fbq('init', pixelId);
      window.fbq('track', 'PageView');
    } catch (e) { console.warn('[erpBridge] Meta pixel init failed:', e); }
  }

  function loadTikTokPixel(pixelId) {
    if (window.ttq && window.ttq.load) {
      try { window.ttq.load(pixelId); window.ttq.page(); } catch (e) {}
      return;
    }
    /* eslint-disable */
    !function (w, d, t) {
      w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
      ttq.load(pixelId); ttq.page();
    }(window, document, 'ttq');
    /* eslint-enable */
  }

  async function fetchAndInjectPixels() {
    if (pixelsInjected) return;
    var attribution = readAttribution();
    var cmp = attribution && attribution.cmp;
    if (!cmp) return;                                   // organic visit — no pixel
    try {
      var res = await fetch(PIXEL_ENDPOINT + '?cmp=' + encodeURIComponent(cmp));
      if (!res.ok) return;
      var data = await res.json();
      pixelConfig = { meta: data.meta || null, tiktok: data.tiktok || null };
      if (pixelConfig.meta && pixelConfig.meta.pixel_id)     loadMetaPixel(pixelConfig.meta.pixel_id);
      if (pixelConfig.tiktok && pixelConfig.tiktok.pixel_id) loadTikTokPixel(pixelConfig.tiktok.pixel_id);
      pixelsInjected = true;
    } catch (e) {
      console.warn('[erpBridge] pixel-config fetch failed:', e);
    }
  }

  // Public event API — checkout.js / main.js call this on cart and
  // checkout actions. Fires the equivalent event to whichever pixels
  // are loaded; no-ops cleanly if no pixel was injected (organic visit).
  //
  //   eventName: 'AddToCart' | 'InitiateCheckout' | 'Purchase' | 'ViewContent' | ...
  //   payload:   { value, currency, contents, content_ids, ... } — Meta-style.
  //              We map the same fields to TikTok's expected shape.
  function trackEvent(eventName, payload) {
    payload = payload || {};
    // Meta
    if (window.fbq && pixelConfig.meta) {
      try { window.fbq('track', eventName, payload); }
      catch (e) { console.warn('[erpBridge] fbq track failed:', e); }
    }
    // TikTok — uses slightly different event names; map common ones.
    if (window.ttq && pixelConfig.tiktok) {
      var ttEvent = eventName === 'Purchase' ? 'CompletePayment'
                  : eventName === 'AddToCart' ? 'AddToCart'
                  : eventName === 'InitiateCheckout' ? 'InitiateCheckout'
                  : eventName === 'ViewContent' ? 'ViewContent'
                  : eventName;
      try {
        window.ttq.track(ttEvent, {
          value: payload.value,
          currency: payload.currency || 'NGN',
          content_id: (payload.content_ids && payload.content_ids[0]) || payload.content_id,
          content_type: payload.content_type || 'product',
        });
      } catch (e) { console.warn('[erpBridge] ttq track failed:', e); }
    }
  }

  // Auto-capture on every page load so attribution sticks across navigation.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      captureAttribution();
      fetchAndInjectPixels();
    });
  } else {
    captureAttribution();
    fetchAndInjectPixels();
  }

  window.erpBridge = {
    submitOrderToERP: submitOrderToERP,
    captureAttribution: captureAttribution,
    resetIdempotencyKey: resetIdempotencyKey,
    trackEvent: trackEvent,
  };
})();
