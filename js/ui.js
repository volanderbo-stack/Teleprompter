// Спільні дрібниці інтерфейсу: іконки, екранування, шторки, тости, форматування.

const ICONS = {
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
  'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
  'chevron-right': '<path d="M9 18l6-6-6-6"/>',
  'para-back': '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>',
  'para-fwd': '<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  'mic-off': '<path d="M15 9.5V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 5.1 2.1M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.4 5.2M12 17.5V21M3 3l18 18"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  doc: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9.5 13h6M9.5 17h6"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
  chart: '<path d="M3 20h18M6 16v-4M11 16V7M16 16v-6M21 16V4" />',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h1.5A1.5 1.5 0 0 1 19 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5H8"/>',
  import: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M6 12H5v8h14v-8h-1"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'font-down': '<path d="M3 18l5-12 5 12M4.7 14h6.6M16 12h5"/>',
  'font-up': '<path d="M3 18l5-12 5 12M4.7 14h6.6M18.5 9.5v5M16 12h5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
export function toast(msg, ms = 2400) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Нижня шторка. Повертає Promise зі значенням натиснутої дії або null.
export function sheet({ title = '', html = '', actions = [], onMount } = {}) {
  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'sheet-backdrop';
    bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      ${title ? `<h2>${esc(title)}</h2>` : ''}${html}
      ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) =>
        `<button class="btn btn-block ${a.style || 'btn-tinted'}" data-act-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    const close = value => {
      document.removeEventListener('keydown', onKey, true);
      bd.classList.add('closing');
      setTimeout(() => bd.remove(), 220);
      resolve(value);
    };
    bd.addEventListener('click', e => {
      if (e.target === bd) return close(null);
      const b = e.target.closest('[data-act-i]');
      if (b) { const a = actions[b.dataset.actI]; close(a.value ?? Number(b.dataset.actI)); }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(bd);
    onMount?.(bd.querySelector('.sheet'), close);
  });
}

export const isSheetOpen = () => !!document.querySelector('.sheet-backdrop:not(.closing)');

export async function confirmSheet(title, label = 'Видалити') {
  return !!(await sheet({
    title,
    actions: [
      { label, value: true, style: 'btn-danger' },
      { label: 'Скасувати', value: false, style: 'btn-plain' },
    ],
  }));
}

// Відкриває системний вибір файлів.
export function pickFiles(accept, multiple = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...input.files]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// Читає .txt як UTF-8; якщо бачимо зіпсовані символи — пробуємо Windows-1251.
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('�')) return utf.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1251').decode(buf); } catch { return utf; }
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const wordsLabel = n => `${n} ${plural(n, ['слово', 'слова', 'слів'])}`;

export function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtReadTime(words, wpm) {
  const sec = Math.round((words / Math.max(wpm, 1)) * 60);
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} хв ${s} с` : `${m} хв`;
}

export function fmtDate(ts) {
  return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); return fn(...args); };
  return d;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
