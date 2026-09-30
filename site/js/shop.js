/* Shop helper for the site's pages: catalog, cart, and placing an order.
 * Pages build their own look; this only talks to the server. Prices shown come from /api/catalog,
 * and the server recomputes the total from its own prices when the order is placed.
 *
 *   <script src="/js/shop.js"></script>
 *   const items = await Shop.catalog();                  // [{id, kind, name, price (paise), image, ...}]
 *   Shop.cart.add('sample-product', 1);                  // cart kept in this browser
 *   await Shop.checkout({ customer: { name, phone, email }, date: '2026-10-02', notes });
 *        // -> creates the order (POST /api/pay/order) and opens /checkout?order=…&t=… to pay
 *   Shop.money(49900) -> "₹499"
 */
(function () {
  'use strict';
  var KEY = 'shop-cart-v1';
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} document.dispatchEvent(new CustomEvent('cart:change', { detail: c })); }

  var cart = {
    get: read,
    lines: function () { var c = read(); return Object.keys(c).map(function (id) { return { id: id, qty: c[id] }; }); },
    count: function () { var c = read(); return Object.keys(c).reduce(function (n, k) { return n + c[k]; }, 0); },
    add: function (id, qty) { var c = read(); c[id] = Math.max(1, (c[id] || 0) + (qty || 1)); write(c); return c; },
    set: function (id, qty) { var c = read(); if (qty > 0) c[id] = qty; else delete c[id]; write(c); return c; },
    remove: function (id) { var c = read(); delete c[id]; write(c); return c; },
    clear: function () { write({}); },
  };

  // One Idempotency-Key per checkout attempt: a double click or a retry returns the same order.
  function newKey() { return 'shop_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }

  async function request(url, body, key) {
    var headers = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    var r;
    try {
      r = await fetch(url, body ? { method: 'POST', headers: headers, body: JSON.stringify(body) } : {});
    } catch (e) {
      throw new Error("We couldn't reach our server. Check your internet connection and try again.");
    }
    var data = await r.json().catch(function () { return {}; });
    // Older routes answer { error: "message" }, /api/pay/* answers { error: { code, message } }.
    var msg = typeof data.error === 'string' ? data.error : data.error && data.error.message;
    if (!r.ok) throw new Error(msg || 'Something went wrong. Please try again.');
    return data;
  }
  var pending = null;

  window.Shop = {
    cart: cart,
    catalog: function () { return request('/api/catalog'); },
    money: function (paise, currency) {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
    },
    // items: [{id, qty}] (defaults to the cart). Creates the order on the server (prices from the
    // catalog) and opens /checkout for it. A second call while one is running returns the same promise.
    checkout: function (opts) {
      if (pending) return pending;
      opts = opts || {};
      var body = { items: opts.items || cart.lines(), customer: opts.customer || {}, date: opts.date || '', notes: opts.notes || '' };
      pending = (async function () {
        var order = await request('/api/pay/order', body, opts.idempotencyKey || newKey());
        if (!opts.items) cart.clear();
        order.checkoutUrl = '/checkout?order=' + encodeURIComponent(order.orderId) + '&t=' + encodeURIComponent(order.token);
        if (opts.redirect !== false) location.href = order.checkoutUrl;
        return order;
      })();
      pending.then(function () { pending = null; }, function () { pending = null; });
      return pending;
    },
  };
})();
