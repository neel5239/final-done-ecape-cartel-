/**
 * Lead capture: validate, sanitize, save locally, and hand off to WhatsApp.
 * No network calls. Leads are kept in localStorage 'leads' so the owner can export a CSV
 * from the same browser (e.g. an admin page calling downloadLeadsCSV()).
 *
 * Expected form field names: name, phone, email, city, message, website (honeypot, hidden).
 * Optional extras are carried into the WhatsApp message: trip, dates, groupSize, budget.
 */

import { WHATSAPP_NUMBER } from './data.js';

export const LEADS_KEY = 'leads';
export const LIMITS = { name: 80, email: 120, city: 60, message: 600, extra: 160 };
export const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FIELDS = ['name', 'phone', 'email', 'city', 'message', 'trip', 'dates', 'groupSize', 'budget', 'website'];

/* ---------- Normalising ---------- */

/** Strip spaces, dashes, brackets and an Indian prefix (+91, 91, 0). Returns digits only. */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** Remove tags and control characters, collapse whitespace, cap length. */
export function sanitizeText(value, max = LIMITS.extra, { multiline = false } = {}) {
  let s = String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

/** Accepts a <form>, FormData, or plain object. Returns a plain object of strings. */
export function readForm(form) {
  if (!form) return {};
  let entries;
  if (typeof FormData !== 'undefined' && form instanceof FormData) entries = form;
  else if (typeof HTMLFormElement !== 'undefined' && form instanceof HTMLFormElement) entries = new FormData(form);
  if (entries) {
    const out = {};
    for (const [k, v] of entries) if (typeof v === 'string') out[k] = v;
    return out;
  }
  return { ...form };
}

export function sanitize(data) {
  const d = readForm(data);
  return {
    name: sanitizeText(d.name, LIMITS.name),
    phone: normalizePhone(d.phone),
    email: sanitizeText(d.email, LIMITS.email).toLowerCase(),
    city: sanitizeText(d.city, LIMITS.city),
    message: sanitizeText(d.message, LIMITS.message, { multiline: true }),
    trip: sanitizeText(d.trip),
    dates: sanitizeText(d.dates),
    groupSize: sanitizeText(d.groupSize, 4),
    budget: sanitizeText(d.budget),
  };
}

/* ---------- Validation ---------- */

/**
 * validate(form) -> { ok, errors: {field: message}, data, spam }
 * spam: true when the honeypot field `website` is filled (bots). Treat as silent success.
 */
export function validate(form) {
  const raw = readForm(form);
  const errors = {};
  const spam = String(raw.website ?? '').trim() !== '';
  const data = sanitize(raw);

  if (!data.name) errors.name = 'Please tell us your name.';
  else if (data.name.length < 2) errors.name = 'Your name looks too short.';

  if (!String(raw.phone ?? '').trim()) errors.phone = 'Please add your WhatsApp number.';
  else if (!PHONE_RE.test(data.phone)) errors.phone = 'Enter a 10-digit Indian mobile number, e.g. 98765 43210.';

  if (data.email && !EMAIL_RE.test(data.email)) errors.email = 'That email doesn’t look right. You can also leave it empty.';

  const rawMsg = String(raw.message ?? '');
  if (rawMsg.trim().length > LIMITS.message) errors.message = `Please keep your message under ${LIMITS.message} characters.`;

  return { ok: !spam && Object.keys(errors).length === 0, errors, data, spam };
}

/* ---------- WhatsApp ---------- */

export function buildLeadMessage(lead, context = {}) {
  const l = { ...lead, ...stripEmpty(context) };
  const lines = [
    'Hi! I’d like to plan a trip.',
    '',
    `Name: ${l.name}`,
    `Phone: +91 ${l.phone}`,
    l.email && `Email: ${l.email}`,
    l.city && `City: ${l.city}`,
    l.trip && `Trip: ${l.trip}`,
    l.dates && `Dates: ${l.dates}`,
    l.groupSize && `Group size: ${l.groupSize}`,
    l.budget && `Budget: ${l.budget}`,
    l.estimate && `Estimate seen: ${l.estimate}`,
    l.addOns && `Add-ons: ${l.addOns}`,
    l.stay && `Stay: ${l.stay}`,
    l.message && '',
    l.message && `Message: ${l.message}`,
  ];
  return lines.filter((x) => x !== undefined && x !== null && x !== false).join('\n');
}

export function buildWhatsAppUrl(lead, context = {}) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(buildLeadMessage(lead, context))}`;
}

function stripEmpty(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = sanitizeText(Array.isArray(v) ? v.join(', ') : v, k === 'message' ? LIMITS.message : LIMITS.extra);
  }
  return out;
}

/* ---------- Local lead log ---------- */

export function getLeads() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(LEADS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Returns the saved record, or null if storage is unavailable (lead still goes to WhatsApp). */
export function saveLead(lead, context = {}) {
  const record = { id: `L${Date.now().toString(36)}`, createdAt: new Date().toISOString(), page: pagePath(), ...lead, ...stripEmpty(context) };
  try {
    const list = getLeads();
    list.push(record);
    globalThis.localStorage.setItem(LEADS_KEY, JSON.stringify(list.slice(-200)));
    return record;
  } catch {
    return null;
  }
}

const pagePath = () => (typeof location !== 'undefined' ? location.pathname : '');

const CSV_COLUMNS = ['createdAt', 'name', 'phone', 'email', 'city', 'trip', 'dates', 'groupSize', 'budget', 'estimate', 'message', 'page'];

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportLeadsCSV(leads = getLeads()) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const l of leads) rows.push(CSV_COLUMNS.map((c) => csvCell(l[c])).join(','));
  return rows.join('\r\n');
}

export function downloadLeadsCSV(filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`) {
  const blob = new Blob(['﻿' + exportLeadsCSV()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- DOM binding ---------- */

/**
 * attachLeadForm(formEl, options)
 * options.getContext(): extra fields for the message (trip, dates, estimate, addOns, stay...)
 * options.onSuccess(record, url), options.openWhatsApp (default true)
 *
 * Markup hooks (created automatically if missing):
 *   an element with [data-error-for="phone"] per field for inline errors
 *   an element with [data-form-status] for the aria-live status message
 */
export function attachLeadForm(formEl, options = {}) {
  if (!formEl) return () => {};
  const { getContext = () => ({}), onSuccess, openWhatsApp = true } = options;
  formEl.noValidate = true;
  const status = ensureStatus(formEl);

  const onSubmit = (e) => {
    e.preventDefault();
    clearErrors(formEl);
    setStatus(status, '', '');

    let result;
    try {
      result = validate(formEl);
    } catch {
      setStatus(status, 'error', 'Something went wrong on our side. Please message us directly on WhatsApp.', `https://wa.me/${WHATSAPP_NUMBER}`);
      return;
    }

    if (result.spam) {
      setStatus(status, 'success', 'Thanks! We’ll be in touch soon.');
      formEl.reset();
      return;
    }

    if (!result.ok) {
      showErrors(formEl, result.errors);
      const count = Object.keys(result.errors).length;
      setStatus(status, 'error', count === 1 ? 'Please fix the highlighted field.' : `Please fix the ${count} highlighted fields.`);
      return;
    }

    let context = {};
    try { context = getContext() || {}; } catch { /* keep going without context */ }
    const record = saveLead(result.data, context);
    const url = buildWhatsAppUrl(result.data, context);

    let opened = false;
    if (openWhatsApp && typeof window !== 'undefined') {
      // No 'noopener' feature: it makes window.open return null, hiding whether it opened.
      try {
        const w = window.open(url, '_blank');
        if (w) { w.opener = null; opened = true; }
      } catch { opened = false; }
    }
    setStatus(
      status,
      'success',
      opened
        ? 'Thanks! WhatsApp is opening with your details. Just hit send and we’ll reply shortly.'
        : 'Thanks! Tap the button to send your details to us on WhatsApp.',
      url,
    );
    formEl.reset();
    formEl.dispatchEvent(new CustomEvent('lead:submitted', { bubbles: true, detail: { record, url } }));
    if (onSuccess) onSuccess(record, url);
  };

  const onInput = (e) => {
    const name = e.target?.name;
    if (name && e.target.getAttribute('aria-invalid') === 'true') {
      const r = validate(formEl);
      if (!r.errors[name]) clearError(formEl, name);
    }
  };

  formEl.addEventListener('submit', onSubmit);
  formEl.addEventListener('input', onInput);
  return () => {
    formEl.removeEventListener('submit', onSubmit);
    formEl.removeEventListener('input', onInput);
  };
}

function ensureStatus(formEl) {
  let el = formEl.querySelector('[data-form-status]');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-form-status', '');
    el.className = 'form-status';
    formEl.appendChild(el);
  }
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  return el;
}

function setStatus(el, state, text, link) {
  el.dataset.state = state;
  el.textContent = text;
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'form-status__link';
    a.textContent = 'Open WhatsApp';
    el.append(' ', a);
  }
}

function errorEl(formEl, name) {
  let el = formEl.querySelector(`[data-error-for="${name}"]`);
  if (!el) {
    const field = formEl.elements.namedItem(name);
    if (!field || !field.insertAdjacentElement) return null;
    el = document.createElement('p');
    el.className = 'field-error';
    el.setAttribute('data-error-for', name);
    field.insertAdjacentElement('afterend', el);
  }
  if (!el.id) el.id = `${formEl.id || 'lead'}-${name}-error`;
  return el;
}

function showErrors(formEl, errors) {
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    const field = formEl.elements.namedItem(name);
    const el = errorEl(formEl, name);
    if (el) { el.textContent = msg; el.hidden = false; }
    if (field && field.setAttribute) {
      field.setAttribute('aria-invalid', 'true');
      if (el) {
        const ids = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        ids.add(el.id);
        field.setAttribute('aria-describedby', [...ids].join(' '));
      }
      if (!first) first = field;
    }
  }
  if (first && first.focus) first.focus();
}

function clearError(formEl, name) {
  const field = formEl.elements.namedItem(name);
  if (field && field.removeAttribute) field.removeAttribute('aria-invalid');
  const el = formEl.querySelector(`[data-error-for="${name}"]`);
  if (el) { el.textContent = ''; el.hidden = true; }
}

function clearErrors(formEl) {
  FIELDS.forEach((n) => clearError(formEl, n));
}
