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
    // fbclid / ttclid are stamped by Meta / TikTok respectively when a
    // user clicks an ad. Capturing them gives the pixel a stronger
    // match signal even when third-party cookies are blocked.
    var carry = ['cmp','cr','pg','ref','utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','ttclid'];

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

  // ── User data hashing for Meta Event Match Quality ─────────────────
  // Meta + TikTok both improve attribution accuracy when events carry
  // hashed customer identifiers (email / phone). SHA-256 is the
  // expected hash. Strings are normalised (lowercased, stripped) per
  // the platforms' docs before hashing.
  async function sha256(str) {
    if (!str) return undefined;
    if (!window.crypto || !window.crypto.subtle) return undefined;
    var enc = new TextEncoder();
    var buf = await window.crypto.subtle.digest('SHA-256', enc.encode(str));
    var bytes = new Uint8Array(buf);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  function normaliseEmail(e) {
    return (e || '').toString().trim().toLowerCase() || undefined;
  }
  function normalisePhone(p) {
    // Meta expects E.164 digits-only without leading 0 / + symbols.
    var digits = (p || '').toString().replace(/\D/g, '');
    if (!digits) return undefined;
    // Default Nigerian numbers — strip leading 0, prepend 234 if needed.
    if (digits.length === 11 && digits.charAt(0) === '0') digits = '234' + digits.slice(1);
    return digits;
  }

  async function buildUserData(customer, attribution) {
    var em = normaliseEmail(customer && customer.email);
    var ph = normalisePhone(customer && customer.phone);
    var userData = {};
    if (em) userData.em = await sha256(em);
    if (ph) userData.ph = await sha256(ph);
    // External click identifiers — sent UNHASHED per Meta docs
    if (attribution && attribution.fbclid) userData.fbc = 'fb.1.' + Date.now() + '.' + attribution.fbclid;
    return userData;
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
      // Browser↔CAPI dedup: caller can pass a UUID they'll also use when
      // firing the browser Purchase pixel; ERP will use the same id in
      // its server-side Conversions API call so Meta / TikTok collapse
      // them to one conversion.
      event_id: opts.event_id || null,
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
  var EVENTLOG_ENDPOINT = SUPABASE_URL + '/functions/v1/log-page-event';
  var pixelConfig = { meta: null, tiktok: null };
  var pixelsInjected = false;

  // ── Event-log batching (per-landing-page funnel) ───────────────────
  // Buffer events for ~2 seconds before POSTing in one batch so a busy
  // page doesn't hammer Supabase. Always flush before page-unload so
  // PageView/AddToCart aren't lost if the user navigates quickly.
  var SESSION_KEY = 'erp_session_id_v1';
  function getOrCreateSessionId() {
    var s = sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  }
  var eventQueue = [];
  var flushTimer = null;
  function enqueueEventLog(eventName, payload) {
    payload = payload || {};
    var attribution = readAttribution();
    eventQueue.push({
      event_name: eventName,
      landing_page_url: attribution.landing_page_url || canonicalUrl(window.location.href),
      cmp: attribution.cmp || null,
      cr:  attribution.cr  || null,
      session_id: getOrCreateSessionId(),
      value:     typeof payload.value === 'number' ? payload.value : null,
      currency:  payload.currency || 'NGN',
      num_items: typeof payload.num_items === 'number' ? payload.num_items : null,
      order_ref: payload.order_id || null,
      source_url: canonicalUrl(window.location.href),
      referrer:  attribution.referrer || (document.referrer || null),
      occurred_at: new Date().toISOString(),
    });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushEventLog, 2000);
    if (eventQueue.length >= 20) flushEventLog();
  }
  function flushEventLog() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (eventQueue.length === 0) return;
    var batch = eventQueue.splice(0, eventQueue.length);
    var payload = JSON.stringify({ events: batch });
    // keepalive:true preserves the request through page-unload (replacing
    // what sendBeacon offered) AND respects CORS preflight correctly.
    // sendBeacon with application/json Blobs silently fails CORS in Chrome
    // even when the function returns Access-Control-Allow-Origin: *.
    fetch(EVENTLOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      mode: 'cors',
    }).catch(function () { /* silent — event logging is best-effort */ });
  }
  window.addEventListener('beforeunload', flushEventLog);
  window.addEventListener('pagehide',     flushEventLog);

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
    // Always log a PageView to our event-log, even on organic visits (no cmp).
    // Lets the funnel widget show total page views per landing page including
    // organic — so buyers can see ad-driven vs organic traffic split.
    enqueueEventLog('PageView', {});
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
  //   payload:   { value, currency, content_ids, content_type, num_items, order_id,
  //                customer: { email, phone }   // optional — boosts Event Match Quality
  //              }
  //
  // Async so we can SHA-256 the customer email/phone before firing
  // (Meta + TikTok use hashed identifiers for matching). Callers can
  // fire-and-forget — the underlying fbq/ttq HTTP requests go out
  // even if the caller doesn't await.
  //
  // Returns the event_id (UUID) — passed back so we can echo the same
  // id from server-side CAPI later for browser↔server dedup.
  async function trackEvent(eventName, payload) {
    payload = payload || {};
    var eventId = payload.event_id
      || (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID()
          : 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));

    // If the caller supplied customer info (typically only Purchase),
    // re-init the pixels with hashed matching params so this event +
    // any subsequent events benefit from Event Match Quality.
    if (payload.customer && (window.fbq || window.ttq)) {
      var userData = await buildUserData(payload.customer, readAttribution());
      if (window.fbq && pixelConfig.meta) {
        try { window.fbq('init', pixelConfig.meta.pixel_id, userData); } catch (e) {}
      }
      if (window.ttq && pixelConfig.tiktok) {
        try {
          window.ttq.identify({
            email: userData.em,
            phone_number: userData.ph,
          });
        } catch (e) {}
      }
    }

    // ALSO log this event to the ERP's funnel telemetry — same call
    // regardless of whether a pixel is loaded. Lets the per-landing-page
    // funnel dashboard count drop-off across organic + paid traffic.
    enqueueEventLog(eventName, payload);

    // Strip customer from what we send to the pixel — it's already
    // applied via matching above.
    var pixelPayload = Object.assign({}, payload);
    delete pixelPayload.customer;
    delete pixelPayload.event_id;

    // Meta
    if (window.fbq && pixelConfig.meta) {
      try { window.fbq('track', eventName, pixelPayload, { eventID: eventId }); }
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
          value: pixelPayload.value,
          currency: pixelPayload.currency || 'NGN',
          content_id: (pixelPayload.content_ids && pixelPayload.content_ids[0]) || pixelPayload.content_id,
          content_type: pixelPayload.content_type || 'product',
          event_id: eventId,
        });
      } catch (e) { console.warn('[erpBridge] ttq track failed:', e); }
    }

    return eventId;
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
