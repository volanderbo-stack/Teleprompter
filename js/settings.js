// Налаштування: зберігаються в IndexedDB (kv/settings), тримаються в пам'яті як об'єкт settings.

import { db } from './db.js';
import { esc, debounce } from './ui.js';
import { renderParsed } from './prompter.js';
import { parseScript } from './markup.js';

export const LANGS = [
  ['uk-UA', 'Українська'],
  ['fr-FR', 'Français'],
  ['en-US', 'English'],
];

const DEFAULTS = {
  lang: 'uk-UA',
  defaultMode: 'voice',
  fontSize: 48,
  lineHeight: 1.4,
  textWidth: 92,
  focus: 30,
  theme: 'system',
  customColors: false,
  textColor: '#ffffff',
  bgColor: '#000000',
  mirrorX: false,
  mirrorY: false,
  manualWpm: 130,
  recFontSize: 34,
  recWidth: 40,
  recFocus: 14,
  recHeight: 36,
  recOpacity: 55,
  fillers: 'ну, типу, ееее, е-е, ем, коротше, як би, euh, du coup, en fait, bah, um, uh, like',
};

export const settings = { ...DEFAULTS };

export async function loadSettings() {
  // На телефоні типовий шрифт менший, щоб довгі слова вміщалися в рядок.
  if (matchMedia('(max-width: 600px)').matches) Object.assign(settings, { fontSize: 36, recFontSize: 28, recWidth: 100 });
  // На широкому екрані вужчий рядок, щоб очі менше бігали.
  else if (matchMedia('(min-width: 1000px)').matches) settings.textWidth = 65;
  try {
    Object.assign(settings, (await db.get('kv', 'settings')) || {});
  } catch { /* приватний режим без IndexedDB — працюємо з типовими */ }
  applyTheme();
}

const persist = debounce(() => db.put('kv', { ...settings }, 'settings').catch(() => {}), 300);

export function saveSettings(patch) {
  Object.assign(settings, patch);
  applyTheme();
  persist();
}

export function isDark() {
  return settings.theme === 'dark' ||
    (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
}

function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Параметри вигляду для суфлера.
export function prompterView(overrides = {}) {
  const s = { ...settings, ...overrides };
  let bg, fg;
  if (s.customColors) { bg = s.bgColor; fg = s.textColor; }
  else if (isDark()) { bg = '#000000'; fg = '#ffffff'; }
  else { bg = '#ffffff'; fg = '#111111'; }
  const darkBg = luminance(bg) < 0.5;
  return {
    fontSize: s.fontSize, lineHeight: s.lineHeight, textWidth: s.textWidth, focus: s.focus,
    mirrorX: s.mirrorX, mirrorY: s.mirrorY,
    bg, fg, cur: darkBg ? '#ffd60a' : '#0a63e0', em: darkBg ? '#ff9f0a' : '#c4410c',
  };
}

const PREVIEW = 'Добрий день! Сьогодні [ПАУЗА] я розповім про **найголовніше** — коротко і по суті.';

export async function settingsScreen(root) {
  const s = settings;
  const range = (key, label, min, max, step, fmt) => `
    <div class="row stack">
      <div class="row-line"><span>${label}</span><span class="row-value" data-out="${key}">${fmt(s[key])}</span></div>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">
    </div>`;
  const toggle = (key, label) => `
    <label class="row"><span>${label}</span><span class="switch"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}><span></span></span></label>`;
  const seg = (key, options) => `<div class="seg" data-seg="${key}">${options.map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${s[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const fmts = {
    fontSize: v => `${v} px`, lineHeight: v => Number(v).toFixed(2), textWidth: v => `${v}%`,
    focus: v => `${v}%`, manualWpm: v => `${v} сл/хв`,
  };

  root.innerHTML = `<div class="screen settings">
    <h1 class="large-title">Налаштування</h1>

    <div class="preview-wrap"><div class="preview"></div></div>

    <div class="group-title">Розпізнавання мови</div>
    <div class="group">
      <label class="row"><span>Мова</span>
        <select data-key="lang" class="select">${LANGS.map(([v, l]) => `<option value="${v}" ${s.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <div class="row"><span>Режим за замовчуванням</span>${seg('defaultMode', [['voice', 'Голос'], ['manual', 'Вручну']])}</div>
    </div>
    <div class="group-footer">Голосовий режим працює в Chrome, Edge і Safari та потребує інтернету. Без нього суфлер прокручує текст сам.</div>

    <div class="group-title">Текст</div>
    <div class="group">
      ${range('fontSize', 'Розмір шрифту', 24, 120, 2, fmts.fontSize)}
      ${range('lineHeight', 'Міжрядковий інтервал', 1, 2.2, 0.05, fmts.lineHeight)}
      ${range('textWidth', 'Ширина тексту', 40, 100, 1, fmts.textWidth)}
      ${range('focus', 'Лінія читання від верху', 5, 70, 1, fmts.focus)}
    </div>

    <div class="group-title">Кольори</div>
    <div class="group">
      <div class="row"><span>Тема</span>${seg('theme', [['system', 'Авто'], ['light', 'Світла'], ['dark', 'Темна']])}</div>
      ${toggle('customColors', 'Свої кольори суфлера')}
      <label class="row" data-dep="customColors"><span>Колір тексту</span><input type="color" data-key="textColor" value="${s.textColor}"></label>
      <label class="row" data-dep="customColors"><span>Колір фону</span><input type="color" data-key="bgColor" value="${s.bgColor}"></label>
    </div>

    <div class="group-title">Дзеркало</div>
    <div class="group">
      ${toggle('mirrorX', 'По горизонталі')}
      ${toggle('mirrorY', 'По вертикалі')}
    </div>
    <div class="group-footer">Для скла-суфлера: текст відбивається у склі й читається правильно.</div>

    <div class="group-title">Ручна прокрутка</div>
    <div class="group">
      ${range('manualWpm', 'Швидкість', 60, 260, 5, fmts.manualWpm)}
    </div>

    <div class="group-title">Запис відео</div>
    <div class="group">
      <div class="row"><span>Папка для відео</span><span class="row-value folder-name">…</span></div>
      <div class="row folder-actions" hidden>
        <button class="btn-plain-sm" data-folder="choose">Вибрати папку</button>
        <button class="btn-plain-sm danger" data-folder="forget" hidden>Скинути</button>
      </div>
    </div>
    <div class="group-footer folder-note"></div>

    <div class="group-title">Слова-паразити</div>
    <div class="group">
      <div class="row stack"><textarea data-key="fillers" rows="3" class="fillers" spellcheck="false">${esc(s.fillers)}</textarea></div>
    </div>
    <div class="group-footer">Через кому. Розпізнавач мови часто пропускає звуки на кшталт «ееее», тож їх підрахунок приблизний.</div>
  </div>`;

  const preview = root.querySelector('.preview');
  const parsed = parseScript(PREVIEW);
  const drawPreview = () => {
    const v = prompterView();
    preview.style.cssText = `--pr-bg:${v.bg};--pr-fg:${v.fg};--pr-cur:${v.cur};--pr-em:${v.em};
      --pr-size:${Math.min(v.fontSize, 64) * 0.6}px;--pr-lh:${v.lineHeight};--pr-width:${v.textWidth}%;
      transform:scale(${v.mirrorX ? -1 : 1},${v.mirrorY ? -1 : 1})`;
    preview.innerHTML = `<div class="pr-text">${renderParsed(parsed)}</div>`;
    preview.querySelectorAll('.w').forEach((el, i) => {
      if (i < 2) el.classList.add('read');
      if (i === 2) el.classList.add('cur');
    });
    root.querySelectorAll('[data-dep]').forEach(el => { el.hidden = !settings[el.dataset.dep]; });
  };
  drawPreview();

  root.addEventListener('input', e => {
    const key = e.target.dataset.key;
    if (!key) return;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'range') v = Number(v);
    const out = root.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = fmts[key](v);
    saveSettings({ [key]: v });
    drawPreview();
  });
  root.addEventListener('change', e => { if (e.target.tagName === 'SELECT') saveSettings({ [e.target.dataset.key]: e.target.value }); });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-seg] button');
    if (!b) return;
    const group = b.parentElement;
    group.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    saveSettings({ [group.dataset.seg]: b.dataset.v });
    drawPreview();
  });
  // Папка для відео: працює лише там, де є File System Access API.
  const rec = await import('./recorder.js');
  const folderName = root.querySelector('.folder-name');
  const drawFolder = async () => {
    if (!rec.folderSupported()) {
      folderName.textContent = 'Завантаження';
      root.querySelector('.folder-note').textContent =
        'Вибір папки працює в Chrome і Edge на комп\'ютері. На телефоні відео потрапляє в «Завантаження» або через «Поділитися → Зберегти відео».';
      return;
    }
    const dir = await rec.getVideoFolder();
    folderName.textContent = dir ? dir.name : 'Не вибрано';
    root.querySelector('.folder-actions').hidden = false;
    root.querySelector('[data-folder="choose"]').textContent = dir ? 'Змінити папку' : 'Вибрати папку';
    root.querySelector('[data-folder="forget"]').hidden = !dir;
    root.querySelector('.folder-note').textContent = dir
      ? 'Після запису кнопка «Зберегти» одразу кладе відео в цю папку.'
      : 'Виберіть папку — і відео зберігатимуться туди одним натиском.';
  };
  drawFolder();
  root.addEventListener('click', async e => {
    const act = e.target.closest('[data-folder]')?.dataset.folder;
    if (!act) return;
    try {
      if (act === 'choose') await rec.chooseVideoFolder();
      else await rec.forgetVideoFolder();
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
    }
    drawFolder();
  });

  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', drawPreview);
  return () => mq.removeEventListener('change', drawPreview);
}
