// Статистика репетицій: підсумок читання, слова-паразити, історія з графіком темпу.
// Верхня частина модуля — чисті функції (тестуються в tests/), далі — UI.

import { db, uid } from './db.js';
import { tokenize } from './matcher.js';
import { icon, esc, fmtClock, fmtDate, wordsLabel, plural } from './ui.js';

export const DEFAULT_WPM = 130;

// «ну, типу, du coup» → [{ label, norms }]
export function parseFillers(str) {
  return String(str).split(',')
    .map(s => s.trim()).filter(Boolean)
    .map(label => ({ label, norms: tokenize(label) }))
    .filter(f => f.norms.length);
}

// Звуки вагання («еее», «ммм») розпізнавач пише з різною кількістю літер — порівнюємо за літерою.
const hesitation = w => (/^(.)\1+$/u.test(w) ? w[0] : null);
const sameWord = (word, filler) =>
  word === filler || (hesitation(filler) !== null && hesitation(filler) === hesitation(word));

export function countFillers(words, fillers) {
  const counts = {};
  for (let i = 0; i < words.length; i++) {
    for (const f of fillers) {
      if (f.norms.every((n, k) => words[i + k] !== undefined && sameWord(words[i + k], n))) {
        counts[f.label] = (counts[f.label] || 0) + 1;
        i += f.norms.length - 1;
        break;
      }
    }
  }
  return counts;
}

// Паразити, сказані понад ті, що є в самому тексті (у сценарії «ну» може стояти навмисно).
export function extraFillers(spoken, scriptRead, fillers) {
  const said = countFillers(spoken, fillers);
  const inText = countFillers(scriptRead, fillers);
  const out = {};
  for (const [k, v] of Object.entries(said)) {
    const n = v - (inText[k] || 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

export function tempo(words, ms) {
  return ms >= 3000 && words > 0 ? Math.round(words / (ms / 60000)) : null;
}

// --- Збереження ---
export async function saveRehearsal(summary) {
  const rec = { id: uid(), date: Date.now(), ...summary };
  await db.put('rehearsals', rec);
  return rec;
}

export async function averageWpm() {
  try {
    const recent = (await db.all('rehearsals'))
      .filter(r => r.wpm > 0)
      .sort((a, b) => b.date - a.date)
      .slice(0, 10);
    if (!recent.length) return DEFAULT_WPM;
    return Math.round(recent.reduce((sum, r) => sum + r.wpm, 0) / recent.length);
  } catch {
    return DEFAULT_WPM;
  }
}

// --- Підсумок ---
const fillerTotal = f => Object.values(f || {}).reduce((a, b) => a + b, 0);

export function summaryHTML(s) {
  const tile = (label, value, sub = '') =>
    `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const fillers = s.fillers;
  const total = fillerTotal(fillers);
  const list = Object.entries(fillers || {}).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="filler">${esc(k)} <b>×${v}</b></span>`).join('');
  return `<div class="stats-grid">
      ${tile('Час', fmtClock(s.durationMs))}
      ${tile('Темп', s.wpm ?? '—', s.wpm ? 'слів/хв' : '')}
      ${tile('Пропущено', s.skipped ?? '—', s.skipped == null ? 'у ручному режимі не рахується' : plural(s.skipped, ['слово', 'слова', 'слів']))}
      ${tile('Паразити', fillers ? total : '—', fillers ? '' : 'лише в голосовому режимі')}
    </div>
    ${list ? `<div class="fillers-list">${list}</div>` : ''}
    <p class="sheet-note">Прочитано ${wordsLabel(s.wordsRead)} з ${s.totalWords}</p>`;
}

// --- Графік темпу (одна серія: лінія + точки, підказка при наведенні) ---
// Діапазон осі з «круглими» поділками: 10, 20, 25, 50 або 100.
function niceScale(values) {
  const lo = Math.max(0, Math.min(...values) - 5), hi = Math.max(...values) + 5;
  const step = [10, 20, 25, 50, 100].find(s => Math.ceil(hi / s) - Math.floor(lo / s) <= 4) ?? 100;
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, ticks };
}

const shortDate = ts => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(ts);

export function drawTempoChart(container, points) {
  const W = Math.max(280, container.clientWidth), H = 200;
  const pad = { l: 36, r: 16, t: 14, b: 26 };
  const { min, max, ticks } = niceScale(points.map(p => p.wpm));
  const x = i => points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.wpm).toFixed(1)}`).join('');
  const last = points.at(-1);

  container.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Темп репетицій, слів за хвилину; остання — ${last.wpm}">
    ${ticks.map(t => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="axis" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <text class="axis" x="${x(0)}" y="${H - 6}" text-anchor="${points.length === 1 ? 'middle' : 'start'}">${shortDate(points[0].date)}</text>
    ${points.length > 1 ? `<text class="axis" x="${x(points.length - 1)}" y="${H - 6}" text-anchor="end">${shortDate(last.date)}</text>` : ''}
    <path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.wpm)}" r="4"/>`).join('')}
    <text class="value" x="${x(points.length - 1)}" y="${y(last.wpm) - 12}" text-anchor="${points.length === 1 ? 'middle' : 'end'}">${last.wpm}</text>
    <line class="cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
    <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
  </svg><div class="chart-tip" hidden></div>`;

  const svg = container.querySelector('svg');
  const tip = container.querySelector('.chart-tip');
  const cross = svg.querySelector('.cross');
  const dots = svg.querySelectorAll('.dot');
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.classList.remove('on')); };
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    const p = points[best];
    cross.setAttribute('x1', x(best));
    cross.setAttribute('x2', x(best));
    cross.setAttribute('visibility', 'visible');
    dots.forEach((d, i) => d.classList.toggle('on', i === best));
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-date">${fmtDate(p.date)}</div><div><b>${p.wpm}</b> слів/хв</div>`;
    const left = Math.min(Math.max(x(best) - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
    tip.style.transform = `translate(${left}px, ${Math.max(0, y(p.wpm) - tip.offsetHeight - 14)}px)`;
  });
  svg.addEventListener('pointerleave', hide);
}

// --- Екран історії ---
export async function historyScreen(root, id) {
  const script = await db.get('scripts', id);
  if (!script) { location.replace('#/'); return; }
  const list = (await db.byIndex('rehearsals', 'scriptId', id)).sort((a, b) => a.date - b.date);
  const withTempo = list.filter(r => r.wpm > 0);
  const avg = withTempo.length ? Math.round(withTempo.reduce((s, r) => s + r.wpm, 0) / withTempo.length) : null;

  root.innerHTML = `<div class="screen has-nav history">
    <header class="navbar">
      <a class="nav-back" href="#/script/${id}">${icon('chevron-left')}Сценарій</a>
    </header>
    <h1 class="large-title">Репетиції</h1>
    <p class="subtitle">${esc(script.title || 'Без назви')}</p>
    ${!list.length ? `<div class="empty">${icon('chart')}<p>Ще не було репетицій.<br>Прочитайте сценарій у суфлері й натисніть «Готово».</p>
      <a class="btn btn-primary" href="#/play/${id}">${icon('play')}Почати</a></div>` : `
    <div class="stats-grid stats-grid-3">
      <div class="stat"><div class="stat-label">Остання</div><div class="stat-value">${withTempo.at(-1)?.wpm ?? '—'}</div><div class="stat-sub">слів/хв</div></div>
      <div class="stat"><div class="stat-label">Середній темп</div><div class="stat-value">${avg ?? '—'}</div><div class="stat-sub">слів/хв</div></div>
      <div class="stat"><div class="stat-label">Репетицій</div><div class="stat-value">${list.length}</div></div>
    </div>
    ${withTempo.length ? `<div class="group-title">Темп, слів за хвилину</div><div class="chart-card"><div class="chart-box"></div></div>` : ''}
    <div class="group-title">Усі репетиції</div>
    <div class="group">
      ${list.slice().reverse().map(r => `<div class="row rehearsal">
        <div><div>${fmtDate(r.date)}</div>
          <div class="row-sub">${fmtClock(r.durationMs)} · ${r.mode === 'voice' ? 'голос' : r.mode === 'manual' ? 'вручну' : 'змішано'}${r.skipped ? ` · пропущено ${r.skipped}` : ''}${r.fillers ? ` · паразитів ${fillerTotal(r.fillers)}` : ''}</div></div>
        <div class="row-value"><b>${r.wpm ?? '—'}</b> сл/хв</div>
      </div>`).join('')}
    </div>`}
  </div>`;

  const box = root.querySelector('.chart-box');
  if (!box) return;
  const draw = () => drawTempoChart(box, withTempo);
  draw();
  const ro = new ResizeObserver(() => { if (box.clientWidth && Math.abs(box.clientWidth - box.firstChild.getAttribute('width')) > 4) draw(); });
  ro.observe(box);
  return () => ro.disconnect();
}
