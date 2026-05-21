/* ============================================
   TENXIX — Free-Shipping Promo Countdown
   24-hour rolling cycle anchored in localStorage.
   - First load: starts a 24h cycle, shows 23:59:59 ticking down.
   - Revisit within the cycle: resumes from saved end-time.
   - Visit after expiry: starts a new 24h cycle automatically.

   DOM contract: any element with class `.promo-countdown` has its
   textContent updated every second with HH:MM:SS remaining.
   Drop the class anywhere in any page; this script handles the rest.

   Loaded as a plain <script> on every page.
   Exposes window.tenxixPromo for manual querying.
   ============================================ */
(function () {
  var STORAGE_KEY  = 'tenxix_promo_end_at_v1';
  var CYCLE_MS     = 24 * 60 * 60 * 1000; // 24h

  function getOrSetEndAt() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var end = raw ? parseInt(raw, 10) : NaN;
    var now = Date.now();
    if (!end || isNaN(end) || end <= now) {
      end = now + CYCLE_MS;
      try { localStorage.setItem(STORAGE_KEY, String(end)); } catch (e) {}
    }
    return end;
  }

  function remainingMs() {
    return Math.max(0, getOrSetEndAt() - Date.now());
  }

  function formatHMS(ms) {
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  function tick() {
    var ms = remainingMs();
    var text = formatHMS(ms);
    var nodes = document.getElementsByClassName('promo-countdown');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = text;
    }
    // If we just hit 0 the next remainingMs() call will reseed via
    // getOrSetEndAt() — countdown auto-restarts seamlessly on next tick.
  }

  function start() {
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.tenxixPromo = {
    remainingMs: remainingMs,
    formatHMS: formatHMS,
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      tick();
    },
  };
})();
