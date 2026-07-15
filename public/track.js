/* =====================================================================
   SISTEMA PRO CUIDADOR — track.js
   Pega esto en tu landing, justo antes de </body>:

     <script>window.PC_ENDPOINT="https://TU-DOMINIO/api/collect";</script>
     <script src="https://TU-DOMINIO/track.js"></script>

   Qué hace:
   - Captura y persiste los UTMs (localStorage + cookie de primera parte)
   - Lee las cookies _fbp y _fbc de Meta (y crea _fbc si llega fbclid)
   - Genera un event_id único y lo comparte con el Pixel y la CAPI (deduplicación)
   - Dispara PageView + ViewContent al cargar
   - Dispara InitiateCheckout al hacer clic en el botón de compra
   - Reescribe el link de Hotmart añadiendo el sck con los UTMs
   ===================================================================== */
(function () {
  'use strict';

  var PIXEL_ID = window.PC_PIXEL_ID || '954054883661119';
  var ENDPOINT = window.PC_ENDPOINT || '';           // https://TU-DOMINIO/api/collect
  var STORE = 'pc_attr';
  var DAYS = 90;

  /* ---------- utilidades ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function getCookie(n) {
    var m = document.cookie.match('(^|;)\\s*' + n + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : '';
  }
  function setCookie(n, v, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 864e5);
    var domain = location.hostname.split('.').slice(-2).join('.');
    document.cookie = n + '=' + v + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' +
      (location.hostname.indexOf('.') > -1 ? ';domain=.' + domain : '');
  }
  function qs(name) {
    return new URLSearchParams(location.search).get(name) || '';
  }

  /* ---------- 1. UTMs: capturar y persistir ---------- */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

  function readStored() {
    try {
      var s = localStorage.getItem(STORE);
      if (s) return JSON.parse(s);
    } catch (e) {}
    try {
      var c = getCookie(STORE);
      if (c) return JSON.parse(decodeURIComponent(c));
    } catch (e) {}
    return {};
  }

  function captureUtms() {
    var fresh = {};
    var found = false;
    UTM_KEYS.forEach(function (k) {
      var v = qs(k);
      if (v) { fresh[k] = v; found = true; }
    });

    var stored = readStored();
    // Primer clic gana solo si no llega atribución nueva; si llega, se actualiza.
    var attr = found ? fresh : stored;
    if (found) {
      attr.first_seen = stored.first_seen || new Date().toISOString();
      attr.landing = location.href.split('?')[0];
      try { localStorage.setItem(STORE, JSON.stringify(attr)); } catch (e) {}
      setCookie(STORE, encodeURIComponent(JSON.stringify(attr)), DAYS);
    }
    return attr || {};
  }

  var UTM = captureUtms();

  /* ---------- 2. Cookies de Meta: _fbp y _fbc ---------- */
  function ensureFbc() {
    var existing = getCookie('_fbc');
    if (existing) return existing;
    var fbclid = qs('fbclid') || UTM.fbclid;
    if (!fbclid) return '';
    // Formato oficial: fb.1.<timestamp>.<fbclid>
    var val = 'fb.1.' + Date.now() + '.' + fbclid;
    setCookie('_fbc', val, DAYS);
    return val;
  }
  function ensureFbp() {
    var existing = getCookie('_fbp');
    if (existing) return existing;
    // El Pixel la crea solo; si aún no existe, la generamos para no perder el match.
    var val = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10);
    setCookie('_fbp', val, DAYS);
    return val;
  }

  /* ---------- 3. Pixel de Meta (respaldo del servidor) ---------- */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s)
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);

  /* ---------- 4. Envío al servidor (CAPI = fuente principal) ---------- */
  function send(eventName, eventId, extra) {
    if (!ENDPOINT) return;
    var body = Object.assign({
      event_name: eventName,
      event_id: eventId,
      event_time: new Date().toISOString(),
      page_url: location.href,
      referrer: document.referrer || null,
      fbp: getCookie('_fbp') || ensureFbp(),
      fbc: getCookie('_fbc') || ensureFbc(),
      external_id: getExternalId(),
      utm: {
        utm_source: UTM.utm_source || null,
        utm_medium: UTM.utm_medium || null,
        utm_campaign: UTM.utm_campaign || null,
        utm_content: UTM.utm_content || null,
        utm_term: UTM.utm_term || null,
        fbclid: UTM.fbclid || null
      },
      user: window.PC_USER || {}   // si capturas email/nombre en un form, ponlo aquí
    }, extra || {});

    var json = JSON.stringify(body);
    // sendBeacon sobrevive a la navegación al checkout
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }));
        return;
      } catch (e) {}
    }
    fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: json, keepalive: true, mode: 'cors'
    }).catch(function () {});
  }

  /** ID propio y estable del visitante (mejora el match) */
  function getExternalId() {
    var k = 'pc_uid', v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) {}
    if (!v) { v = uuid(); try { localStorage.setItem(k, v); } catch (e) {} }
    return v;
  }

  /* ---------- 5. PageView + ViewContent ---------- */
  ensureFbp(); ensureFbc();

  var pvId = uuid();
  fbq('track', 'PageView', {}, { eventID: pvId });   // 🔑 mismo ID que la CAPI
  send('PageView', pvId);

  var vcId = uuid();
  fbq('track', 'ViewContent', {
    content_name: document.title, content_type: 'product'
  }, { eventID: vcId });
  send('ViewContent', vcId, { content_name: document.title });

  /* ---------- 6. sck: llevar los UTMs a Hotmart ---------- */
  function buildSck() {
    // Compacto para no exceder el límite de Hotmart: source|campaign|content|term
    var parts = [
      UTM.utm_source || 'direct',
      UTM.utm_campaign || '',
      UTM.utm_content || '',
      UTM.utm_term || ''
    ].map(function (s) { return String(s).replace(/\|/g, '-').slice(0, 60); });
    return encodeURIComponent(parts.join('|'));
  }

  function decorate(url) {
    try {
      var u = new URL(url, location.href);
      if (!/hotmart|hotm\.art|pay\.hotmart/i.test(u.hostname)) return url;
      u.searchParams.set('sck', decodeURIComponent(buildSck()));  // vuelve en el webhook
      if (UTM.utm_campaign) u.searchParams.set('src', String(UTM.utm_campaign).slice(0, 60));
      // Pasamos también los UTMs por si quieres leerlos en el checkout
      UTM_KEYS.forEach(function (k) { if (UTM[k]) u.searchParams.set(k, UTM[k]); });
      var xid = getExternalId(); if (xid) u.searchParams.set('xcod', xid);
      return u.toString();
    } catch (e) { return url; }
  }

  /* ---------- 7. InitiateCheckout ---------- */
  var CHECKOUT_SELECTOR = window.PC_CHECKOUT_SELECTOR ||
    'a[href*="hotmart"], a[href*="hotm.art"], a[href*="pay.hotmart"], [data-checkout]';

  function wire() {
    document.querySelectorAll(CHECKOUT_SELECTOR).forEach(function (el) {
      if (el.__pcWired) return;
      el.__pcWired = true;
      if (el.tagName === 'A' && el.href) el.href = decorate(el.href);

      el.addEventListener('click', function () {
        var icId = uuid();
        var val = parseFloat(el.getAttribute('data-value') || window.PC_VALUE || '7.99');
        var cur = el.getAttribute('data-currency') || window.PC_CURRENCY || 'USD';

        fbq('track', 'InitiateCheckout', {
          value: val, currency: cur, content_name: 'Sistema Pro Cuidador'
        }, { eventID: icId });                                  // 🔑 mismo ID que la CAPI

        send('InitiateCheckout', icId, {
          value: val, currency: cur, content_name: 'Sistema Pro Cuidador'
        });
      }, { passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else { wire(); }
  // Por si los botones se pintan después (contenido dinámico)
  new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- API pública ---------- */
  window.PC = {
    utm: UTM,
    decorate: decorate,
    track: function (name, data) { var id = uuid(); fbq('track', name, data || {}, { eventID: id }); send(name, id, data); },
    identify: function (user) { window.PC_USER = Object.assign(window.PC_USER || {}, user); }
  };
})();
