// Обгортка над Web Speech API: безперервне розпізнавання з автоперезапуском.
// Віддає назовні масив нормалізованих слів: усі фінальні за сесію + поточні проміжні.

import { tokenize } from './matcher.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = () => !!SR;

const FATAL = {
  'not-allowed': 'Немає доступу до мікрофона — дозвольте його в налаштуваннях браузера',
  'service-not-allowed': 'Розпізнавання мови недоступне в цьому браузері',
  'audio-capture': 'Мікрофон не знайдено або він зайнятий іншим застосунком',
  network: 'Для розпізнавання мови потрібен інтернет',
  'language-not-supported': 'Ця мова не підтримується розпізнавачем браузера',
};

export class SpeechListener {
  constructor({ lang, onWords, onState, onError }) {
    this.lang = lang;
    this.onWords = onWords;
    this.onState = onState;
    this.onError = onError;
    this.active = false;
    this.committed = [];   // фінальні слова попередніх запусків
    this.sessionFinal = [];
    this.interim = [];
    this.quickFails = 0;
  }

  get finalWords() { return this.committed.concat(this.sessionFinal); }
  get words() { return this.committed.concat(this.sessionFinal, this.interim); }

  start() {
    if (this.active) return;
    this.active = true;
    this.quickFails = 0;
    this.launch();
  }

  stop() {
    this.active = false;
    clearTimeout(this.restartTimer);
    try { this.rec?.stop(); } catch { /* вже зупинено */ }
  }

  launch() {
    const rec = new SR();
    this.rec = rec;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const startedAt = Date.now();

    rec.onstart = () => this.onState?.('listening');
    rec.onresult = e => {
      // Перераховуємо всю сесію: Safari і Chrome по-різному виставляють resultIndex.
      const fin = [], tmp = [];
      for (const r of e.results) (r.isFinal ? fin : tmp).push(...tokenize(r[0].transcript));
      this.sessionFinal = fin;
      this.interim = tmp;
      this.onWords?.(this.words);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (FATAL[e.error]) {
        this.active = false;
        this.onError?.(e.error, FATAL[e.error]);
      }
    };
    rec.onend = () => {
      this.committed.push(...this.sessionFinal, ...this.interim);
      this.sessionFinal = [];
      this.interim = [];
      if (rec !== this.rec) return;
      if (!this.active) { this.onState?.('stopped'); return; }
      // Браузери самі зупиняють розпізнавання після паузи чи ~60 с — перезапускаємо.
      this.quickFails = Date.now() - startedAt < 1000 ? this.quickFails + 1 : 0;
      if (this.quickFails > 5) {
        this.active = false;
        this.onError?.('restart', 'Розпізнавання постійно зупиняється — перейшли в ручний режим');
        return;
      }
      this.restartTimer = setTimeout(() => {
        if (!this.active) return;
        try { this.launch(); } catch { this.active = false; this.onState?.('stopped'); }
      }, 150 * this.quickFails);
    };
    rec.start();
  }
}
