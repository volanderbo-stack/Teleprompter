// Рендер тексту суфлера і прокрутка. Prompter знає лише про позицію (індекс слова)
// і зсув тексту; звідки береться позиція — ручна швидкість чи голос — вирішує екран.

import { db } from './db.js';
import { parseScript } from './markup.js';
import { settings, saveSettings, prompterView } from './settings.js';
import { icon, esc, clamp, isSheetOpen, toast } from './ui.js';

export function renderParsed({ paragraphs }) {
  return paragraphs.map(p => `<p>${p.items.map(it => {
    if (it.type === 'br') return '<br>';
    const sp = it.space ? ' ' : '';
    if (it.type === 'mark') return `${sp}<span class="mk mk-${it.kind}">${esc(it.text.slice(1, -1).trim())}</span>`;
    const cls = (it.type === 'word' ? 'w' : '') + (it.emph ? ' em' : '');
    return `${sp}<span class="${cls.trim()}">${esc(it.text)}</span>`;
  }).join('')}</p>`).join('');
}

export class Prompter {
  constructor(host, text, view) {
    this.host = host;
    this.parsed = parseScript(text);
    this.words = this.parsed.words;
    this.paraStarts = this.parsed.paragraphs.filter(p => p.end > p.start).map(p => p.start);
    this.pos = 0;
    this.y = this.targetY = 0;
    this.playing = false;
    this.mode = 'manual';
    this.wpm = 130;
    this.activeMs = 0;
    this.dragging = false;
    this.curIdx = -1;
    this.onPos = this.onEnd = this.onSeek = this.onTap = null;

    host.innerHTML = `<div class="pr-viewport"><div class="pr-band"></div><div class="pr-focus"></div>
      <div class="pr-text">${renderParsed(this.parsed)}</div></div>`;
    this.viewport = host.querySelector('.pr-viewport');
    this.textEl = host.querySelector('.pr-text');
    this.wordEls = [...this.textEl.querySelectorAll('.w')];
    this.applyView(view);
    this.bindInput();
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.viewport);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  applyView(v) {
    this.view = v;
    // Змінні ставимо на весь екран суфлера, щоб їх бачили і кнопки керування.
    const st = (this.host.closest('.pr-screen') ?? this.host).style;
    st.setProperty('--pr-size', `${v.fontSize}px`);
    st.setProperty('--pr-lh', v.lineHeight);
    st.setProperty('--pr-width', `${v.textWidth}%`);
    st.setProperty('--pr-focus', `${v.focus}%`);
    st.setProperty('--pr-bg', v.bg);
    st.setProperty('--pr-fg', v.fg);
    st.setProperty('--pr-cur', v.cur);
    st.setProperty('--pr-em', v.em);
    this.mirrorY = v.mirrorY;
    this.viewport.style.transform = `scale(${v.mirrorX ? -1 : 1}, ${v.mirrorY ? -1 : 1})`;
    this.measure();
  }

  // Кешуємо вертикальні центри слів, щоб не чіпати layout у кожному кадрі.
  measure() {
    this.focusPx = this.viewport.clientHeight * this.view.focus / 100;
    this.lineH = parseFloat(getComputedStyle(this.textEl).lineHeight) || this.view.fontSize * this.view.lineHeight;
    this.centers = this.wordEls.map(el => Math.round(el.offsetTop + el.offsetHeight / 2));
    this.minY = (this.centers[0] ?? 0) - this.focusPx;
    this.maxY = (this.centers.at(-1) ?? 0) - this.focusPx;
    this.wordsPerLine = Math.max(1, this.words.length / Math.max(1, new Set(this.centers).size));
    this.targetY = this.y = this.yForWord(this.pos);
    this.render();
  }

  yForWord(i) {
    if (!this.centers.length) return 0;
    return this.centers[clamp(i, 0, this.centers.length - 1)] - this.focusPx;
  }

  // Перше слово рядка, що зараз на лінії читання.
  wordAtY(y) {
    const c = this.centers;
    if (!c.length) return 0;
    const line = y + this.focusPx + this.lineH * 0.3;
    let lo = 0, hi = c.length - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= line) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    while (found > 0 && c[found - 1] === c[found]) found--;
    return found;
  }

  setPos(p, { scroll = true } = {}) {
    p = clamp(p, 0, this.words.length);
    const els = this.wordEls;
    if (p > this.pos) for (let i = this.pos; i < p; i++) els[i].classList.add('read');
    else for (let i = p; i < this.pos; i++) els[i].classList.remove('read');
    this.pos = p;
    els[this.curIdx]?.classList.remove('cur');
    this.curIdx = this.mode === 'voice' && p < els.length ? p : -1;
    els[this.curIdx]?.classList.add('cur');
    if (scroll && !this.dragging) this.targetY = this.yForWord(p);
    this.onPos?.(p);
  }

  setMode(mode) {
    this.mode = mode;
    this.setPos(this.pos, { scroll: false });
  }

  pxPerSec() {
    return (this.wpm / this.wordsPerLine) * this.lineH / 60;
  }

  play() { if (this.words.length) this.playing = true; }
  pause() { this.playing = false; }

  paraIndex() {
    let k = 0;
    this.paraStarts.forEach((s, i) => { if (s <= this.pos) k = i; });
    return k;
  }

  nextPara() {
    const p = this.paraStarts[this.paraIndex() + 1];
    if (p != null) this.jumpTo(p);
  }

  prevPara() {
    const k = this.paraIndex();
    const start = this.paraStarts[k] ?? 0;
    this.jumpTo(this.pos - start > 2 || k === 0 ? start : this.paraStarts[k - 1]);
  }

  jumpTo(p) {
    this.setPos(p, { scroll: false });
    this.targetY = this.yForWord(p);
    this.onSeek?.(p);
  }

  seekToFocus() {
    const p = this.wordAtY(this.targetY);
    this.setPos(p, { scroll: this.mode === 'voice' });
    this.onSeek?.(p);
  }

  bindInput() {
    const vp = this.viewport;
    let start = null;
    vp.addEventListener('pointerdown', e => {
      if (e.button) return;
      start = { y: e.clientY, target: this.targetY, moved: false };
    });
    vp.addEventListener('pointermove', e => {
      if (!start) return;
      const dy = (e.clientY - start.y) * (this.mirrorY ? -1 : 1);
      if (!start.moved && Math.abs(dy) > 8) {
        start.moved = true;
        this.dragging = true;
        vp.setPointerCapture?.(e.pointerId);
      }
      if (start.moved) this.targetY = this.y = clamp(start.target - dy, this.minY, this.maxY);
    });
    vp.addEventListener('pointerup', () => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      this.dragging = false;
      if (moved) this.seekToFocus(); else this.onTap?.();
    });
    vp.addEventListener('pointercancel', () => { start = null; this.dragging = false; });
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      this.targetY = clamp(this.targetY + e.deltaY * (this.mirrorY ? -1 : 1), this.minY, this.maxY);
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => this.seekToFocus(), 200);
    }, { passive: false });
  }

  tick = t => {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.playing) {
      this.activeMs += dt * 1000;
      if (this.mode === 'manual' && !this.dragging) {
        this.targetY += this.pxPerSec() * dt;
        if (this.targetY >= this.maxY) {
          this.targetY = this.maxY;
          this.playing = false;
          this.setPos(this.words.length, { scroll: false });
          this.onEnd?.();
        }
      }
    }
    if (!this.dragging) {
      this.y += (this.targetY - this.y) * (1 - Math.exp(-dt * 9));
      if (Math.abs(this.targetY - this.y) < 0.2) this.y = this.targetY;
    }
    this.render();
    if (this.mode === 'manual' && this.pos < this.words.length) {
      const p = this.wordAtY(this.y);
      if (p !== this.pos) this.setPos(p, { scroll: false });
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  render() {
    if (this.renderedY === this.y) return;
    this.renderedY = this.y;
    this.textEl.style.transform = `translate3d(0, ${-this.y}px, 0)`;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    clearTimeout(this.wheelTimer);
  }
}

// --- Утримання екрана увімкненим ---
let wakeLock = null;
let wantAwake = false;
export async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* браузер може відмовити — не критично */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake) keepAwake(true);
});

// --- Екран суфлера ---
export async function playScreen(root, id) {
  const script = await db.get('scripts', id);
  if (!script) { location.hash = '#/'; return; }
  if (!parseScript(script.text).words.length) {
    toast('Сценарій порожній — додайте текст');
    location.replace(`#/script/${id}`);
    return;
  }

  root.innerHTML = `<div class="pr-screen">
    <div class="pr-host"></div>
    <div class="pr-top">
      <button class="pr-btn pr-sm" data-act="exit" aria-label="Закрити">${icon('close')}</button>
      <div class="pr-mid"><span class="pr-progress">0%</span></div>
      <div class="pr-right">
        <button class="pr-btn pr-sm" data-act="font-down" aria-label="Менший шрифт">${icon('font-down')}</button>
        <button class="pr-btn pr-sm" data-act="font-up" aria-label="Більший шрифт">${icon('font-up')}</button>
        <button class="pr-pill" data-act="finish">Готово</button>
      </div>
    </div>
    <div class="pr-bottom">
      <div class="pr-speed">
        <button class="pr-btn pr-sm" data-act="slower" aria-label="Повільніше">${icon('minus')}</button>
        <span class="pr-speed-val"></span>
        <button class="pr-btn pr-sm" data-act="faster" aria-label="Швидше">${icon('plus')}</button>
      </div>
      <div class="pr-transport">
        <button class="pr-btn" data-act="prev" aria-label="Попередній абзац">${icon('para-back')}</button>
        <button class="pr-btn pr-play" data-act="toggle" aria-label="Старт / пауза">${icon('play')}</button>
        <button class="pr-btn" data-act="next" aria-label="Наступний абзац">${icon('para-fwd')}</button>
      </div>
    </div>
  </div>`;

  const screen = root.querySelector('.pr-screen');
  const pr = new Prompter(screen.querySelector('.pr-host'), script.text, prompterView());
  pr.wpm = settings.manualWpm;
  const $ = s => screen.querySelector(s);

  const sync = () => {
    $('.pr-play').innerHTML = icon(pr.playing ? 'pause' : 'play');
    screen.classList.toggle('playing', pr.playing);
    $('.pr-speed-val').textContent = `${pr.wpm} сл/хв`;
    keepAwake(pr.playing);
  };
  const toggle = () => { pr.playing ? pr.pause() : pr.play(); sync(); };
  const speed = d => {
    pr.wpm = clamp(pr.wpm + d, 40, 300);
    saveSettings({ manualWpm: pr.wpm });
    sync();
  };
  const font = d => {
    saveSettings({ fontSize: clamp(settings.fontSize + d, 24, 120) });
    pr.applyView(prompterView());
  };
  const exit = () => { location.hash = `#/script/${id}`; };
  const finish = () => { pr.pause(); sync(); exit(); };

  pr.onTap = toggle;
  pr.onPos = p => { $('.pr-progress').textContent = `${Math.round(p / pr.words.length * 100)}%`; };
  pr.onEnd = () => { sync(); setTimeout(finish, 800); };

  // Елементи керування тьмяніють під час читання і проявляються від дотику.
  let uiTimer;
  const wake = () => {
    screen.classList.add('ui-on');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => screen.classList.remove('ui-on'), 2500);
  };
  screen.addEventListener('pointermove', wake);
  screen.addEventListener('pointerdown', wake);

  screen.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const actions = {
      exit, finish, toggle,
      prev: () => pr.prevPara(), next: () => pr.nextPara(),
      slower: () => speed(-10), faster: () => speed(10),
      'font-down': () => font(-4), 'font-up': () => font(4),
    };
    actions[act]?.();
  });

  const onKey = e => {
    if (isSheetOpen() || e.target.closest?.('input, textarea, select')) return;
    switch (e.key) {
      case ' ': case 'Enter': case 'MediaPlayPause': toggle(); break;
      case 'ArrowDown': case 'PageDown': pr.nextPara(); break;
      case 'ArrowUp': case 'PageUp': pr.prevPara(); break;
      case 'ArrowRight': speed(10); break;
      case 'ArrowLeft': speed(-10); break;
      case 'Escape': exit(); break;
      default: return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  sync();

  return () => {
    window.removeEventListener('keydown', onKey);
    clearTimeout(uiTimer);
    pr.destroy();
    keepAwake(false);
  };
}
