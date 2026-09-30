// Settings come from environment variables (Railway/Vercel "Variables") or a local .env file.
// Nothing secret lives in the code: switching demo -> the client's real payments is a settings change.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (KEY=value lines) without overriding variables that are already set.
function loadDotEnv(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(ROOT, '.env'));
// "Today" and daily revenue follow the business's time zone, not the server's (Railway runs on UTC).
if (!process.env.TZ) process.env.TZ = (process.env.TIMEZONE || 'Asia/Kolkata').trim();

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const MODES = ['demo', 'upi', 'razorpay'];

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  business: env('BUSINESS_NAME', 'Our Store'),
  currency: env('CURRENCY', 'INR'),
  dataDir: path.resolve(ROOT, env('DATA_DIR', '.data')),
  // demo: nothing real is charged (for showing clients) | upi: straight to the owner's UPI ID, owner
  // confirms in the dashboard | razorpay: the owner's Razorpay account, verified automatically.
  paymentMode: MODES.includes(env('PAYMENT_MODE', 'demo')) ? env('PAYMENT_MODE', 'demo') : 'demo',
  // UPI_QR_IMAGE: the owner's own printed QR (PhonePe/Paytm/bank sticker) saved in site/, e.g.
  // assets/payments/upi-qr.png. With UPI_ID set too, the checkout makes an exact-amount QR instead.
  upi: { vpa: env('UPI_ID'), payee: env('UPI_PAYEE_NAME', env('BUSINESS_NAME', 'Our Store')), qrImage: env('UPI_QR_IMAGE').replace(/^\/+/, '') },
  // Razorpay: keys only from the environment. Test keys start rzp_test_, live keys rzp_live_.
  razorpay: {
    keyId: env('RAZORPAY_KEY_ID'), keySecret: env('RAZORPAY_KEY_SECRET'), webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
    apiBase: env('RAZORPAY_API_BASE', 'https://api.razorpay.com/v1').replace(/\/+$/, ''),
    timeoutMs: Math.max(2000, Math.min(60000, Number(env('RAZORPAY_TIMEOUT_MS', '12000')) || 12000)),
    retries: Math.max(0, Math.min(5, Math.floor(Number(env('RAZORPAY_RETRIES', '2'))) || 0)),
  },
  admin: { email: env('ADMIN_EMAIL').toLowerCase(), password: env('ADMIN_PASSWORD') },
  // Sessions survive restarts only when SESSION_SECRET is set; otherwise the owner logs in again.
  sessionSecret: env('SESSION_SECRET') || crypto.randomBytes(32).toString('hex'),
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
};

// A mode that is missing its settings falls back to demo, loudly, instead of taking broken payments.
export function paymentProblems() {
  const p = [];
  if (config.paymentMode === 'upi') {
    const vpaOk = /^[\w.-]{2,}@[a-z][\w]{1,}$/i.test(config.upi.vpa);
    const imgOk = !!config.upi.qrImage && /^[\w./-]+\.(png|jpe?g|webp|svg)$/i.test(config.upi.qrImage) && !config.upi.qrImage.includes('..') && fs.existsSync(path.join(ROOT, 'site', config.upi.qrImage));
    if (config.upi.vpa && !vpaOk) p.push(`UPI_ID "${config.upi.vpa}" does not look like a UPI ID (like shopname@okhdfcbank)`);
    else if (!vpaOk && !imgOk) p.push('PAYMENT_MODE=upi needs the owner\'s UPI_ID, or their QR image saved in site/ and named in UPI_QR_IMAGE');
  }
  if (config.paymentMode === 'razorpay') {
    const { keyId, keySecret } = config.razorpay;
    if (!keyId || !keySecret) p.push('PAYMENT_MODE=razorpay needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
    // Messages here can reach the checkout page: they name settings, never their values.
    else if (!/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(keyId)) p.push('RAZORPAY_KEY_ID does not look like a Razorpay key id (rzp_test_... or rzp_live_...)');
    else if (keySecret.length < 12 || keySecret === keyId) p.push('RAZORPAY_KEY_SECRET does not look like a Razorpay key secret');
  }
  return p;
}

// Not bad enough to fall back to demo, but the owner should fix them (shown in /admin only).
export function paymentWarnings() {
  const w = [];
  if (config.paymentMode !== 'razorpay' || paymentProblems().length) return w;
  if (!config.razorpay.webhookSecret) w.push('RAZORPAY_WEBHOOK_SECRET is not set: payments are confirmed only while the buyer keeps the checkout open. Add a webhook in the Razorpay Dashboard.');
  if (config.razorpay.keyId.startsWith('rzp_live_')) w.push('Live Razorpay keys are in use: real money is charged.');
  return w;
}
