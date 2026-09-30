/* The site has one checkout page: /checkout (site/checkout.html + /js/checkout.js). Kit links
 * such as /checkout/?order=ID&t=TOKEN are forwarded there with their query string, so there is
 * no second copy of the payment code to keep in step. */
location.replace('/checkout' + location.search + location.hash);
