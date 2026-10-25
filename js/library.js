// Бібліотека сценаріїв і редактор.

import { db, uid } from './db.js';
import { parseScript, plainText } from './markup.js';
import { averageWpm } from './stats.js';
import {
  icon, esc, sheet, confirmSheet, toast, pickFiles, readTextFile,
  wordsLabel, fmtReadTime, debounce,
} from './ui.js';

const DEMO = `Ласкаво просимо до розумного телесуфлера.

Цей текст прокручується в темпі вашого голосу. Говоріть природно — суфлер слухає і рухається разом із вами. [ПАУЗА]

Якщо ви замовкнете, текст зупиниться. Якщо пропустите речення, суфлер сам знайде, де ви зараз.

Важливі слова можна виділити **ось так**, а перед складним місцем поставити позначку [ПОВІЛЬНІШЕ].

Торкніться екрана, щоб поставити на паузу. Кнопки внизу перемикають абзаци.`;

export function newScript({ title = '', text = '', tags = [], draft = false } = {}) {
  const now = Date.now();
  return { id: uid(), title, text, tags, words: parseScript(text).words.length, createdAt: now, updatedAt: now, draft };
}

async function seedDemo() {
  if (await db.get('kv', 'seeded')) return;
  await db.put('scripts', newScript({ title: 'Як користуватися суфлером', text: DEMO, tags: ['довідка'] }));
  await db.put('kv', true, 'seeded');
}

const titleFrom = text => plainText(text).split(/(?<=[.!?…])\s/)[0].slice(0, 60) || 'Без назви';

async function createFrom(text, title) {
  const s = newScript({ title: title || titleFrom(text), text });
  await db.put('scripts', s);
  return s;
}

export async function deleteScript(id) {
  await db.del('scripts', id);
  await db.delByIndex('rehearsals', 'scriptId', id);
}

// --- Список ---
export async function libraryScreen(root) {
  await seedDemo().catch(() => {});
  const [scripts, wpm] = await Promise.all([db.all('scripts'), averageWpm()]);
  const visible = scripts.filter(s => !s.draft).sort((a, b) => b.updatedAt - a.updatedAt);
  let query = '';
  let activeTag = null;

  root.innerHTML = `<div class="screen library">
    <h1 class="large-title">Сценарії</h1>
    <label class="search">${icon('search')}<input type="search" placeholder="Пошук" autocomplete="off"></label>
    <div class="chips"></div>
    <div class="list"></div>
  </div>
  <button class="fab" data-act="add" aria-label="Новий сценарій">${icon('plus')}</button>`;

  const listEl = root.querySelector('.list');
  const chipsEl = root.querySelector('.chips');
  const tags = [...new Set(visible.flatMap(s => s.tags || []))].sort((a, b) => a.localeCompare(b, 'uk'));

  const renderChips = () => {
    chipsEl.hidden = !tags.length;
    chipsEl.innerHTML = [null, ...tags].map(t =>
      `<button class="chip ${t === activeTag ? 'active' : ''}" data-tag="${t === null ? '' : esc(t)}">${t === null ? 'Усі' : '#' + esc(t)}</button>`).join('');
  };

  const renderList = () => {
    const q = query.trim().toLowerCase();
    const items = visible.filter(s =>
      (!activeTag || s.tags?.includes(activeTag)) &&
      (!q || s.title.toLowerCase().includes(q) || s.text.toLowerCase().includes(q)));
    if (!visible.length) {
      listEl.innerHTML = `<div class="empty">${icon('doc')}<p>Ще немає сценаріїв</p>
        <button class="btn btn-primary" data-act="add">${icon('plus')}Створити</button></div>`;
      return;
    }
    if (!items.length) { listEl.innerHTML = '<div class="empty"><p>Нічого не знайдено</p></div>'; return; }
    listEl.innerHTML = items.map(s => `
      <div class="card" data-id="${s.id}" tabindex="0" role="button">
        <div class="card-main">
          <div class="card-title">${esc(s.title || 'Без назви')}</div>
          <div class="card-snippet">${esc(plainText(s.text).slice(0, 180)) || '<i>Порожньо</i>'}</div>
          <div class="card-meta"><span>${wordsLabel(s.words)} · ~${fmtReadTime(s.words, wpm)}</span>
            ${(s.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
        </div>
        <button class="card-play" data-play="${s.id}" aria-label="Відкрити суфлер">${icon('play')}</button>
      </div>`).join('');
  };

  renderChips();
  renderList();

  root.querySelector('.search input').addEventListener('input', e => { query = e.target.value; renderList(); });

  root.addEventListener('click', async e => {
    const chip = e.target.closest('[data-tag]');
    if (chip) { activeTag = chip.dataset.tag || null; renderChips(); renderList(); return; }
    const play = e.target.closest('[data-play]');
    if (play) { location.hash = `#/play/${play.dataset.play}`; return; }
    const card = e.target.closest('.card');
    if (card) { location.hash = `#/script/${card.dataset.id}`; return; }
    if (e.target.closest('[data-act="add"]')) addMenu();
  });
  root.addEventListener('keydown', e => {
    const card = e.target.closest?.('.card');
    if (card && e.key === 'Enter') location.hash = `#/script/${card.dataset.id}`;
  });
}

async function addMenu() {
  const choice = await sheet({
    title: 'Новий сценарій',
    actions: [
      { label: 'Порожній сценарій', value: 'new', icon: 'doc', style: 'btn-tinted' },
      { label: 'Вставити з буфера', value: 'paste', icon: 'clipboard', style: 'btn-tinted' },
      { label: 'Імпорт .txt', value: 'import', icon: 'import', style: 'btn-tinted' },
      { label: 'Скасувати', value: null, style: 'btn-plain' },
    ],
  });
  if (choice === 'new') {
    const s = newScript({ draft: true });
    await db.put('scripts', s);
    location.hash = `#/script/${s.id}`;
  } else if (choice === 'paste') {
    const text = await readClipboard();
    if (text == null) return;
    if (!text.trim()) { toast('Буфер обміну порожній'); return; }
    const s = await createFrom(text);
    location.hash = `#/script/${s.id}`;
  } else if (choice === 'import') {
    const files = await pickFiles('.txt,text/plain', true);
    if (!files.length) return;
    let last;
    for (const f of files) last = await createFrom(await readTextFile(f), f.name.replace(/\.[^.]+$/, ''));
    if (files.length === 1) location.hash = `#/script/${last.id}`;
    else { toast(`Імпортовано: ${files.length}`); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  }
}

async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    toast('Немає доступу до буфера — вставте текст у редактор вручну');
    return null;
  }
}

// --- Редактор ---
export async function editorScreen(root, id) {
  const s = await db.get('scripts', id);
  if (!s) { location.replace('#/'); return; }
  const wpm = await averageWpm();

  root.innerHTML = `<div class="screen has-nav editor">
    <header class="navbar">
      <a class="nav-back" href="#/">${icon('chevron-left')}Сценарії</a>
      <div class="nav-actions">
        <button class="icon-btn" data-act="delete" aria-label="Видалити">${icon('trash')}</button>
      </div>
    </header>
    <input class="editor-title" placeholder="Назва" value="${esc(s.title)}">
    <input class="editor-tags" placeholder="Теги через кому" value="${esc((s.tags || []).join(', '))}">
    <div class="toolbar">
      <button class="tool" data-act="paste">${icon('clipboard')}Вставити</button>
      <button class="tool" data-act="import">${icon('import')}Імпорт .txt</button>
      <button class="tool tool-pause" data-ins="[ПАУЗА]">ПАУЗА</button>
      <button class="tool tool-slow" data-ins="[ПОВІЛЬНІШЕ]">ПОВІЛЬНІШЕ</button>
      <button class="tool tool-em" data-act="emph">**наголос**</button>
    </div>
    <textarea class="editor-text" placeholder="Текст сценарію…&#10;&#10;Порожній рядок розділяє абзаци." spellcheck="true">${esc(s.text)}</textarea>
    <div class="editor-stats"></div>
  </div>
  <div class="action-bar">
    <button class="btn btn-primary" data-act="play">${icon('play')}Суфлер</button>
    <button class="btn btn-tinted" data-act="record">${icon('video')}Запис</button>
  </div>`;

  const titleEl = root.querySelector('.editor-title');
  const tagsEl = root.querySelector('.editor-tags');
  const ta = root.querySelector('.editor-text');
  const statsEl = root.querySelector('.editor-stats');
  let deleted = false;

  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  const updateStats = () => {
    const parsed = parseScript(ta.value);
    const n = parsed.words.length;
    const paras = parsed.paragraphs.filter(p => p.end > p.start).length;
    statsEl.textContent = n ? `${wordsLabel(n)} · ~${fmtReadTime(n, wpm)} читання · абзаців: ${paras}` : '';
    return n;
  };

  const save = async () => {
    if (deleted) return;
    s.title = titleEl.value.trim();
    s.text = ta.value;
    s.tags = [...new Set(tagsEl.value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean))];
    s.words = parseScript(s.text).words.length;
    s.updatedAt = Date.now();
    if (s.title || s.text.trim()) s.draft = false;
    await db.put('scripts', s);
  };
  const saveSoon = debounce(save, 500);

  const insert = (str, selectFrom, selectTo) => {
    ta.focus();
    const start = ta.selectionStart;
    ta.setRangeText(str, start, ta.selectionEnd, 'end');
    if (selectFrom != null) ta.setSelectionRange(start + selectFrom, start + selectTo);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  root.addEventListener('input', () => { grow(); updateStats(); saveSoon(); });

  root.addEventListener('click', async e => {
    const ins = e.target.closest('[data-ins]');
    if (ins) {
      const before = ta.value[ta.selectionStart - 1];
      insert(`${before && !/\s/.test(before) ? ' ' : ''}${ins.dataset.ins} `);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'emph') {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel) insert(`**${sel}**`);
      else insert('**наголос**', 2, 9);
    } else if (act === 'paste') {
      const text = await readClipboard();
      if (text) insert(text);
    } else if (act === 'import') {
      const [file] = await pickFiles('.txt,text/plain');
      if (!file) return;
      const text = await readTextFile(file);
      if (!titleEl.value.trim()) titleEl.value = file.name.replace(/\.[^.]+$/, '');
      insert(text);
    } else if (act === 'delete') {
      if (!(await confirmSheet('Видалити сценарій?'))) return;
      deleted = true;
      await deleteScript(id);
      location.hash = '#/';
    } else if (act === 'play' || act === 'record') {
      await saveSoon.flush();
      if (!updateStats()) { toast('Спочатку додайте текст'); return; }
      location.hash = `#/${act}/${id}`;
    }
  });

  updateStats();
  requestAnimationFrame(grow);
  if (s.draft) titleEl.focus();

  return async () => {
    if (deleted) return;
    await saveSoon.flush();
    if (s.draft && !s.title && !s.text.trim()) await db.del('scripts', id);
  };
}
