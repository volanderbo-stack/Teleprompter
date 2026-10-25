// Обгортка над Web Speech API: безперервне розпізнавання з автоперезапуском і сторожем.
// Віддає назовні масив нормалізованих слів (усі фінальні за сесію + поточні проміжні)
// і сирий текст поточного запуску — щоб показати людині, що саме почуто.

import { tokenize } from './matcher.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = () => !!SR;

const FATAL = {
  'not-allowed': 'Немає доступу до мікрофона — дозвольте його в налаштуваннях браузера',
  'service-not-allowed': 'Розпізнавання мови недоступне в цьому браузері',
  'language-not-supported': 'Ця мова не підтримується розпізнавачем браузера',
};
// Ці помилки часто разові (збій мережі, мікрофон на мить зайнятий) — пробуємо ще, але не безкінечно.
const RETRYABLE = {
  network: 'Для розпізнавання мови потрібен інтернет',
  'audio-capture': 'Мікрофон не знайдено або він зайнятий іншим застосунком',
};

const WATCHDOG_MS = 7000; // Chrome іноді мовчки перестає надсилати результати — тоді перезапускаємо

export class SpeechListener {
  constructor({ lang, onWords, onState, onError }) {
    this.lang = lang;
    this.onWords = onWords;
    this.onState = onState;
    this.onError = onError;
    this.active = false;
    this.committed = [];   // фінальні слова попередніх запусків
    this.current = null;   // { final, interim } поточного запуску
    this.quickFails = 0;
    this.errors = [];
  }

  get finalWords() { return this.committed.concat(this.current?.final ?? []); }
  get words() { return this.committed.concat(this.current?.final ?? [], this.current?.interim ?? []); }

  start() {
    if (this.active) return;
    this.active = true;
    this.quickFails = 0;
    this.safeLaunch();
  }

  stop() {
    this.active = false;
    clearTimeout(this.restartTimer);
    clearInterval(this.watchdog);
    try { this.rec?.stop(); } catch { /* вже зупинено */ }
  }

  launch() {
    if (!this.active) return;
    const rec = new SR();
    const session = { final: [], interim: [] };
    this.rec = rec;
    this.current = session;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const startedAt = Date.now();
    this.lastEvent = Date.now();

    rec.onstart = () => { this.lastEvent = Date.now(); this.onState?.('listening'); };
    rec.onresult = e => {
      this.lastEvent = Date.now();
      // Перераховуємо всю сесію: Safari і Chrome по-різному виставляють resultIndex.
      const fin = [], tmp = [];
      for (const r of e.results) (r.isFinal ? fin : tmp).push(...tokenize(r[0].transcript));
      session.final = fin;
      session.interim = tmp;
      const text = Array.from(e.results, r => r[0].transcript).join(' ');
      if (rec === this.rec) this.onWords?.(this.words, text);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (FATAL[e.error]) return this.fail(FATAL[e.error]);
      if (RETRYABLE[e.error]) {
        const now = Date.now();
        this.errors = this.errors.filter(t => now - t < 15000).concat(now);
        if (this.errors.length >= 4) this.fail(RETRYABLE[e.error]);
      }
    };
    rec.onend = () => {
      // Слова цього запуску (включно з недоговореними) переходять у постійний список.
      this.committed.push(...session.final, ...session.interim);
      session.final = [];
      session.interim = [];
      if (rec !== this.rec) return;
      this.current = null;
      clearInterval(this.watchdog);
      if (!this.active) { this.onState?.('stopped'); return; }
      // Браузери самі зупиняють розпізнавання після паузи чи ~60 с — одразу перезапускаємо.
      this.onState?.('restarting');
      this.quickFails = Date.now() - startedAt < 1000 ? this.quickFails + 1 : 0;
      if (this.quickFails > 6) {
        this.fail('Розпізнавання постійно зупиняється — перейшли в ручний режим');
        return;
      }
      this.restartTimer = setTimeout(() => this.safeLaunch(), this.quickFails ? 250 * this.quickFails : 0);
    };

    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (rec === this.rec && this.active && Date.now() - this.lastEvent > WATCHDOG_MS) {
        this.lastEvent = Date.now();
        try { rec.abort(); } catch { /* onend перезапустить */ }
      }
    }, 1000);

    rec.start();
  }

  safeLaunch() {
    try {
      this.launch();
    } catch {
      // Попередній запуск ще не відпустив мікрофон — пробуємо трохи пізніше.
      this.restartTimer = setTimeout(() => this.safeLaunch(), 300);
    }
  }

  fail(msg) {
    this.active = false;
    clearInterval(this.watchdog);
    try { this.rec?.abort(); } catch { /* немає */ }
    this.onError?.(msg);
  }
}
