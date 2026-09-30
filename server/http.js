// Small HTTP helpers: JSON in/out with size limits, security headers, per-IP rate limits, cookies.
import crypto from 'node:crypto';

// Machine-readable error codes for API clients ({ error: { code, message } } on /api/pay/*).
const CODES = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed', 409: 'conflict',
  413: 'too_large', 415: 'unsupported_media_type', 422: 'unprocessable', 429: 'rate_limited', 502: 'gateway_error', 503: 'unavailable',
};
export const errorCode = (status) => CODES[status] || (status >= 500 ? 'server_error' : 'error');

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || errorCode(status); }
}

// Error body. Unexpected errors (no status) never leak their message to the browser.
// legacy: the older /api/* routes send { error: "message", code } because shop.js etc. read error as text.
export function sendError(res, e, { legacy = false } = {}) {
  const status = e.status || 500;
  const message = status >= 500 && !e.status ? 'Something went wrong. Please try again.' : e.message;
  const code = e.status ? (typeof e.code === 'string' && e.code ? e.code : errorCode(status)) : 'server_error';
  if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
  sendJson(res, status, legacy ? { error: message, code } : { error: { code, message } });
}

export function clientIp(req) {
  // Railway/Vercel put the real visitor address first in x-forwarded-for.
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
export const isHttps = (req) => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

// Read the raw body (webhooks need the exact bytes to verify signatures). The bytes are kept on
// req.rawBody before any JSON parsing, so a signature is always checked against what was sent.
export function readRaw(req, limit = 64 * 1024) {
  if (req.rawBody) return Promise.resolve(req.rawBody);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { req.rawBody = Buffer.concat(chunks); resolve(req.rawBody); });
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  if (!/application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON');
  const raw = await readRaw(req, limit);
  try { return raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

// Fixed-window rate limit per key (IP + route), in memory: enough for one server instance. Only
// counters live here (a restart just resets them); orders, payments and idempotency are in SQLite.
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n += 1;
  if (b.n > max) {
    const e = new HttpError(429, 'Too many requests. Please wait a few minutes and try again.');
    e.retryAfter = Math.max(1, Math.ceil((b.reset - now) / 1000));
    throw e;
  }
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
