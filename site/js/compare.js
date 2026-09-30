/**
 * Compare logic (up to 3 trips side by side).
 * - compareRows(ids): pure, returns table-ready rows for any renderer.
 * - attachCompareTray(el, opts): minimal accessible tray bound to store.js; pages style it
 *   via the class names below (.compare-tray, .compare-tray__item, .compare-table ...).
 */

import { getTripById, DIFFICULTY, FLEX_POLICY, PUBLIC_INVENTORY_CONFIRMED } from './data.js';
import { priceLabel, filledPercent, monthNames } from './planner.js';
import { getCompare, removeFromCompare, clearCompare, onStoreChange, COMPARE_MAX } from './store.js';

export const COMPARE_FIELDS = [
  { key: 'region', label: 'Region', get: (t) => t.region },
  { key: 'duration', label: 'Duration', get: (t) => `${t.days} days / ${t.nights} nights` },
  { key: 'price', label: 'Price', get: (t) => priceLabel(t).text },
  { key: 'difficulty', label: 'Difficulty', get: (t) => DIFFICULTY[t.difficulty]?.label || t.difficulty },
  { key: 'bestMonths', label: 'Best months', get: (t) => monthNames(t.months).join(', ') },
  { key: 'group', label: 'Group size', get: (t) => PUBLIC_INVENTORY_CONFIRMED ? `${t.groupMin}–${t.groupMax} travellers` : 'On request' },
  { key: 'spots', label: 'Availability', get: (t) => PUBLIC_INVENTORY_CONFIRMED ? `${t.spotsLeft} left (${filledPercent(t)}% filled)` : 'Ask us on WhatsApp' },
  { key: 'startPoint', label: 'Starts from', get: (t) => t.startPoint },
  { key: 'inclusions', label: 'Includes', get: (t) => t.inclusions },
  { key: 'flex', label: 'Flexibility', get: () => FLEX_POLICY.dateChange.display },
];

/** Returns { trips, rows: [{ key, label, values: [...], differs }] }. */
export function compareRows(ids = getCompare()) {
  const trips = ids.map(getTripById).filter(Boolean).slice(0, COMPARE_MAX);
  const rows = COMPARE_FIELDS.map((f) => {
    const values = trips.map(f.get);
    const flat = values.map((v) => (Array.isArray(v) ? v.join('|') : String(v)));
    return { key: f.key, label: f.label, values, differs: new Set(flat).size > 1 };
  });
  return { trips, rows };
}

/** Builds an accessible <table> element for the given trip ids. */
export function renderCompareTable(ids = getCompare()) {
  const { trips, rows } = compareRows(ids);
  const table = document.createElement('table');
  table.className = 'compare-table';
  const caption = document.createElement('caption');
  caption.textContent = trips.length ? `Comparing ${trips.length} trips` : 'Pick up to 3 trips to compare';
  table.appendChild(caption);
  if (!trips.length) return table;

  const thead = table.createTHead().insertRow();
  thead.appendChild(cell('th', '', 'col'));
  trips.forEach((t) => {
    const th = cell('th', '', 'col');
    const img = document.createElement('img');
    img.src = t.image; img.alt = t.imageAlt; img.loading = 'lazy'; img.width = 320; img.height = 180;
    const name = document.createElement('span');
    name.textContent = t.name;
    th.append(img, name);
    thead.appendChild(th);
  });

  const tbody = table.createTBody();
  rows.forEach((r) => {
    const tr = tbody.insertRow();
    if (r.differs) tr.dataset.differs = '';
    tr.appendChild(cell('th', r.label, 'row'));
    r.values.forEach((v) => {
      const td = cell('td');
      if (Array.isArray(v)) {
        const ul = document.createElement('ul');
        v.forEach((x) => { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
        td.appendChild(ul);
      } else td.textContent = v;
      tr.appendChild(td);
    });
  });
  return table;
}

function cell(tag, text = '', scope) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (scope) el.scope = scope;
  return el;
}

/**
 * attachCompareTray(trayEl, { onCompare(ids) })
 * Renders selected trips as chips with remove buttons, a "Compare" button (enabled at 2+)
 * and "Clear". Hidden when empty. Re-renders on store changes. Returns an unsubscribe fn.
 */
export function attachCompareTray(trayEl, { onCompare } = {}) {
  if (!trayEl) return () => {};
  trayEl.classList.add('compare-tray');
  trayEl.setAttribute('role', 'region');
  trayEl.setAttribute('aria-label', 'Trips selected to compare');

  const render = () => {
    const ids = getCompare();
    trayEl.replaceChildren();
    trayEl.hidden = ids.length === 0;
    if (!ids.length) return;

    const list = document.createElement('ul');
    list.className = 'compare-tray__list';
    ids.map(getTripById).filter(Boolean).forEach((t) => {
      const li = document.createElement('li');
      li.className = 'compare-tray__item';
      const label = document.createElement('span');
      label.textContent = t.name;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'compare-tray__remove';
      rm.setAttribute('aria-label', `Remove ${t.name} from compare`);
      rm.textContent = '×';
      rm.addEventListener('click', () => removeFromCompare(t.id));
      li.append(label, rm);
      list.appendChild(li);
    });

    const count = document.createElement('p');
    count.className = 'compare-tray__count';
    count.textContent = `${ids.length} of ${COMPARE_MAX} selected`;

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'compare-tray__go';
    go.textContent = ids.length < 2 ? 'Add one more to compare' : 'Compare now';
    go.disabled = ids.length < 2;
    go.addEventListener('click', () => onCompare && onCompare(getCompare()));

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'compare-tray__clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => clearCompare());

    trayEl.append(list, count, go, clear);
  };

  render();
  const off = onStoreChange(({ key }) => key === 'compare' && render());
  return off;
}
