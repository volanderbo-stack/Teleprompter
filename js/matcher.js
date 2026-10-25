// Зіставлення розпізнаного мовлення зі сценарієм. Чисті функції, без DOM.
//
// Ідея: беремо останні кілька сказаних слів і локально вирівнюємо їх (Сміт—Уотерман)
// із ділянкою сценарію навколо поточної позиції. Кожна точка, де останнє сказане слово
// збіглося зі словом сценарію, — кандидат на нову позицію. Що далі кандидат від поточного
// місця, то сильніший збіг потрібен, щоб туди перескочити; назад — лише за дуже сильного.
// Якщо надійного збігу немає, текст «іде за голосом»: кожне нове сказане слово, що
// починається так само, як одне з найближчих слів сценарію, посуває позицію на нього.

import { normalizeWord } from './markup.js';

export const tokenize = text => String(text).split(/\s+/).map(normalizeWord).filter(Boolean);

const TAIL = 6;          // скільки останніх сказаних слів порівнюємо
const BEHIND = 30;       // вікно пошуку назад
const AHEAD = 80;        // вікно пошуку вперед
const GAP_SPOKEN = 0.4;  // штраф за зайве сказане слово
const GAP_SCRIPT = 0.25; // штраф за слово сценарію, якого розпізнавач не почув (у швидкій мові — часто)
const MISMATCH = -0.5;
const MERGE = 1.6;       // вага збігу «одне сказане = два злиті слова сценарію»
const NEAR = 3;          // «сусідні» слова, куди можна перейти за одним збігом
const MID = 10;          // помірний стрибок уперед: пропущене слово-два у швидкій мові
const TH_NEAR = 0.9;
const TH_MID = 1.7;
const TH_FAR = 2.5;
const TH_BACK = 3.5;
const TH_GLOBAL = 4.5;
const DIST_COST = 0.015;
const WEAK = 0.45;       // збіг лише за початком слова («рухається» ↔ «рухаємо»)
const FOLLOW_LOOK = 3;   // «іти за голосом»: на скільки слів уперед шукати схоже за початком
const FOLLOW_MAX = 6;    // і не далі стількох слів від останнього надійного збігу

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const simCache = new Map();

// Схожість сказаного слова й слова сценарію: 0 (різні) … 1 (однакові).
export function similarity(spoken, script) {
  if (spoken === script) return 1;
  const key = spoken + '|' + script;
  let v = simCache.get(key);
  if (v !== undefined) return v;
  const min = Math.min(spoken.length, script.length);
  if (min <= 2) v = 0;
  else if (spoken.length >= 4 && script.startsWith(spoken)) v = 0.8; // недоговорене проміжне слово
  else {
    const max = Math.max(spoken.length, script.length);
    const r = 1 - levenshtein(spoken, script) / max;
    v = r >= (min <= 3 ? 0.66 : 0.7) ? r : 0;
    // Та сама основа з іншим закінченням («кнопки» → «кнопкам»): розпізнавач часто плутає відмінки.
    if (!v && min >= 4 && commonPrefix(spoken, script) >= Math.max(4, max - 3)) v = 0.7;
    // Розпізнавач почув лише початок слова — слабкий збіг, вирішує контекст.
    if (!v && min >= 4 && commonPrefix(spoken, script) >= 3) v = WEAK;
  }
  if (simCache.size > 50000) simCache.clear();
  simCache.set(key, v);
  return v;
}

// Чи схоже сказане слово на слово сценарію хоча б початком (для «іти за голосом»).
export function sameStart(spoken, script) {
  if (spoken.length < 3 || script.length < 3) return false; // «і», «на», «що» є в будь-якій мові
  return similarity(spoken, script) > 0 || commonPrefix(spoken, script) >= 3;
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Чи є сказане слово двома словами сценарію, злитими докупи. Лише цілком: недоговорене
// «програму» не повинно зійти за «програму вона».
function mergeSimilarity(spoken, a, b) {
  const both = a + b;
  if (spoken === both) return 1;
  if (spoken === a || spoken === b) return 0;
  if (Math.abs(spoken.length - both.length) > 2) return 0;
  const r = 1 - levenshtein(spoken, both) / Math.max(spoken.length, both.length);
  // «прокручується» схоже і на «прокручується в» — але це просто перше слово, не злиття.
  return r >= 0.8 && r > similarity(spoken, a) && r > similarity(spoken, b) ? r : 0;
}

// Короткі слова («і», «в», «на») зустрічаються всюди — вони важать менше.
const weightOf = word => (word.length <= 2 ? 0.6 : 1);

// Вирівнює хвіст мовлення з ділянкою сценарію [lo, hi).
// Повертає кандидатів { end, score, matched } — кінцеві позиції, де збіглося останнє (чи передостаннє) слово хвоста.
// Крім звичайних кроків, одне сказане слово може відповідати двом злитим словам сценарію
// (у швидкій мові розпізнавач склеює: «натиснітьтут»).
export function alignTail(tail, script, lo, hi) {
  const k = tail.length, m = hi - lo;
  if (!k || m <= 0) return [];
  const H = Array.from({ length: k + 1 }, () => new Float32Array(m + 1));
  const P = Array.from({ length: k + 1 }, () => new Uint8Array(m + 1)); // 0 стоп, 1 діагональ, 2 вгору, 3 вліво, 4 злиття
  const G = Array.from({ length: k + 1 }, () => new Float32Array(m + 1)); // схожість на кроці 1/4
  for (let i = 1; i <= k; i++) {
    for (let j = 1; j <= m; j++) {
      const w = script[lo + j - 1];
      const sim = similarity(tail[i - 1], w);
      let best = 0, dir = 0, gain = 0;
      const diag = H[i - 1][j - 1] + (sim > 0 ? sim * weightOf(w) : MISMATCH);
      if (diag > best) { best = diag; dir = 1; gain = sim; }
      if (j >= 2 && tail[i - 1].length >= 5) {
        const ms = mergeSimilarity(tail[i - 1], script[lo + j - 2], w);
        const merge = H[i - 1][j - 2] + ms * MERGE;
        if (ms > 0 && merge > best) { best = merge; dir = 4; gain = ms; }
      }
      const up = H[i - 1][j] - GAP_SPOKEN;
      if (up > best) { best = up; dir = 2; gain = 0; }
      const left = H[i][j - 1] - GAP_SCRIPT;
      if (left > best) { best = left; dir = 3; gain = 0; }
      H[i][j] = best;
      P[i][j] = dir;
      G[i][j] = gain;
    }
  }
  const out = [];
  const isMatch = (i, j) => (P[i][j] === 1 || P[i][j] === 4) && G[i][j] > 0;
  for (let j = 1; j <= m; j++) {
    // Кандидат — збіг останнього сказаного слова; або передостаннього, якщо останнє розпізнане хибно
    // (наприкінці фрази інакше довелося б чекати, поки людина заговорить знову).
    let i = k;
    if (!isMatch(k, j)) {
      if (k < 3 || P[k][j] !== 2 || !isMatch(k - 1, j)) continue;
      i = k - 1;
    }
    const matched = [];
    let jj = j;
    while (i > 0 && jj > 0 && P[i][jj]) {
      const d = P[i][jj];
      if (d === 1) { if (G[i][jj] > 0) matched.push(lo + jj - 1); i--; jj--; }
      else if (d === 4) { matched.push(lo + jj - 1, lo + jj - 2); i--; jj -= 2; }
      else if (d === 2) i--;
      else jj--;
    }
    out.push({ end: lo + j - 1, score: H[k][j], matched });
  }
  return out;
}

// Стежить за позицією читача в сценарії.
export class Tracker {
  constructor(scriptNorms) {
    this.script = scriptNorms;
    this.pos = 0;              // індекс наступного слова, яке треба прочитати
    this.sure = 0;             // позиція після останнього надійного збігу (pos може бути попереду — «за голосом»)
    this.read = new Set();     // слова сценарію, які розпізнавач справді почув
    this.ignoreBefore = 0;     // сказане до цього індексу не враховуємо (після ручного переходу)
    this.followed = 0;         // сказані слова до цього індексу вже використані для «за голосом»
    this.lastCount = 0;
  }

  // Ручний перехід: забуваємо старий хвіст мовлення, щоб він не тягнув позицію назад.
  reset(pos) {
    this.pos = this.sure = Math.max(0, Math.min(pos, this.script.length));
    this.ignoreBefore = this.followed = this.lastCount;
  }

  // spoken — усі нормалізовані сказані слова сесії (фінальні + проміжні). Повертає нову позицію.
  update(spoken) {
    this.lastCount = spoken.length;
    // Проміжний результат може «схуднути» (два слова злились в одне) — не даємо хвосту зникнути.
    if (this.ignoreBefore > spoken.length) this.ignoreBefore = spoken.length;
    if (this.followed > spoken.length) this.followed = spoken.length;
    const tail = spoken.slice(Math.max(this.ignoreBefore, spoken.length - TAIL));
    if (!tail.length || !this.script.length) return this.pos;
    const sureEnd = this.sure - 1; // останнє надійно прочитане слово
    const front = this.pos - 1;    // де читач, імовірно, зараз (з урахуванням «за голосом»)

    const pick = (lo, hi, global) => {
      let best = null;
      for (const c of alignTail(tail, this.script, lo, hi)) {
        const back = c.end < sureEnd;
        const ahead = c.end - front;
        let need;
        if (global) need = TH_GLOBAL;
        else if (c.end === sureEnd) need = 0;
        else if (back) need = TH_BACK;
        else if (ahead <= NEAR) need = TH_NEAR;
        else if (ahead <= MID) need = TH_MID;
        else need = TH_FAR;
        if (back && tail.length < 4) continue;
        if (c.score < need) continue;
        const adj = c.score - DIST_COST * Math.abs(ahead);
        if (!best || adj > best.adj) best = { ...c, adj };
      }
      return best;
    };

    const lo = Math.max(0, this.sure - BEHIND);
    const hi = Math.min(this.script.length, this.pos + AHEAD);
    let best = pick(lo, hi, false);
    if (!best && tail.length >= 5 && (lo > 0 || hi < this.script.length)) best = pick(0, this.script.length, true);
    // Збіг на вже відомому слові нічого нового не каже — тоді лишаємо змогу йти за голосом.
    if (best && best.end !== sureEnd) {
      best.matched.forEach(i => this.read.add(i));
      this.pos = this.sure = best.end + 1;
      this.followed = spoken.length;
    } else {
      this.follow(spoken);
    }
    return this.pos;
  }

  // Розпізнавач не вловив слово чи перекрутив кілька — не стоїмо, а йдемо за новими словами.
  follow(spoken) {
    for (let i = Math.max(this.followed, this.ignoreBefore); i < spoken.length; i++) {
      const w = spoken[i];
      for (let j = this.pos; j < Math.min(this.script.length, this.pos + FOLLOW_LOOK); j++) {
        if (j - this.sure >= FOLLOW_MAX) break;
        if (sameStart(w, this.script[j])) { this.read.add(j); this.pos = j + 1; break; }
      }
    }
    this.followed = spoken.length;
  }

  // Пропущені слова: серії з 3+ непочутих слів до поточної позиції.
  // Одне-два непочуті слова поспіль — найчастіше помилка розпізнавача, а не пропуск.
  skipped(upTo = this.pos) {
    let total = 0, run = 0;
    for (let i = 0; i < upTo; i++) {
      if (this.read.has(i)) { if (run >= 3) total += run; run = 0; }
      else run++;
    }
    return total + (run >= 3 ? run : 0);
  }
}
