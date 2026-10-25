// Тести для чистих модулів: matcher.js, markup.js (і stats.js після етапу 4).
// Запуск: відкрити tests/index.html через локальний сервер або `npm test`.

import { Tracker, tokenize, similarity } from '../js/matcher.js';
import { parseScript, normalizeWord } from '../js/markup.js';

export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (actual, expected, msg = '') => {
  if (actual !== expected) throw new Error(`${msg} очікували ${JSON.stringify(expected)}, отримали ${JSON.stringify(actual)}`);
};
const ok = (v, msg) => { if (!v) throw new Error(msg); };

const trackerFor = text => new Tracker(parseScript(text).words.map(w => w.norm));

// Імітує розпізнавач: слова надходять по одному, довгі спершу приходять недоговореними.
function speak(tr, heard, phrase) {
  for (const w of tokenize(phrase)) {
    if (w.length > 5) tr.update([...heard, w.slice(0, 4)]);
    heard.push(w);
    tr.update(heard);
  }
  return tr.pos;
}

const S1 = 'Сьогодні я розповім вам про нашу нову програму.';         // 8 слів
const S2 = 'Вона допомагає людям вчитися швидше і краще.';            // 7 слів
const S3 = 'Почнемо з короткої історії створення проєкту.';           // 6 слів
const SCRIPT = `${S1} ${S2}\n\n${S3}`;

// --- matcher ---
test('точне читання доходить до кінця без пропусків', () => {
  const tr = trackerFor(SCRIPT);
  eq(speak(tr, [], `${S1} ${S2} ${S3}`), 21);
  eq(tr.skipped(), 0, 'пропущено:');
});

test('пропущене речення: суфлер перескакує і рахує пропуск', () => {
  const tr = trackerFor(SCRIPT);
  const heard = [];
  eq(speak(tr, heard, S1), 8);
  eq(speak(tr, heard, S3), 21);
  eq(tr.skipped(), 7, 'пропущено:');
});

test('переставлені слова не збивають позицію', () => {
  const tr = trackerFor('Швидка бура лисиця стрибає через лінивого пса.');
  eq(speak(tr, [], 'бура швидка лисиця стрибає через лінивого пса'), 7);
});

test('слова-паразити між словами не заважають', () => {
  const tr = trackerFor(SCRIPT);
  eq(speak(tr, [], 'ну сьогодні я ееее розповім вам типу про нашу ну нову програму'), 8);
});

test('апострофи різних видів вважаються однаковими', () => {
  const tr = trackerFor('М\'ята пам’ять і об\'єм');
  eq(speak(tr, [], 'мʼята пам\'ять і обʼєм'), 4);
});

test('сторонні слова не рухають текст', () => {
  const tr = trackerFor(SCRIPT);
  const heard = [];
  speak(tr, heard, S1);
  eq(speak(tr, heard, 'погода сьогодні чудова але трохи холодно'), 8);
});

test('помилки розпізнавача (схожі слова) прощаються', () => {
  const tr = trackerFor(SCRIPT);
  eq(speak(tr, [], 'сьогодні я розповім вам про нашу нові програма'), 8);
});

test('ручний перехід: старе мовлення не тягне назад', () => {
  const tr = trackerFor(SCRIPT);
  const heard = [];
  speak(tr, heard, S1);
  tr.reset(15);
  eq(tr.update(heard), 15, 'після reset:');
  eq(speak(tr, heard, S3), 21);
});

test('перечитування попереднього речення повертає назад', () => {
  const tr = trackerFor(SCRIPT);
  const heard = [];
  speak(tr, heard, `${S1} ${S2}`);
  speak(tr, heard, 'вона допомагає людям вчитися');
  eq(tr.pos, 12, 'після повтору:');
});

test('повтори одного слова поспіль', () => {
  const tr = trackerFor('Це дуже дуже добре');
  const heard = [];
  eq(speak(tr, heard, 'це дуже'), 2);
  eq(speak(tr, heard, 'дуже'), 3);
  eq(speak(tr, heard, 'добре'), 4);
});

test('французька: апострофи й діакритика', () => {
  const tr = trackerFor("Bonjour à tous, aujourd'hui je vais vous parler de l'économie.");
  eq(speak(tr, [], "bonjour à tous aujourd'hui je vais vous parler de l'economie"), 10);
});

test('далекий стрибок поза вікном пошуку', () => {
  const filler = 'Цей абзац просто заповнює місце в тексті сценарію. '.repeat(12);
  const target = 'Наприкінці подякуємо глядачам за увагу й терпіння.';
  const tr = trackerFor(`${S1}\n\n${filler}\n\n${target}`);
  const heard = [];
  speak(tr, heard, S1);
  eq(speak(tr, heard, target), tr.script.length);
});

test('схожість: короткі слова лише точно', () => {
  eq(similarity('на', 'не'), 0);
  ok(similarity('програма', 'програму') > 0.7, 'програма ≈ програму');
  ok(similarity('теле', 'телесуфлер') > 0, 'недоговорене слово');
});

// --- markup ---
test('позначки не рахуються як слова', () => {
  const p = parseScript('Привіт [ПАУЗА] світ [ПОВІЛЬНІШЕ] знову');
  eq(p.words.length, 3);
  const marks = p.paragraphs[0].items.filter(i => i.type === 'mark').map(i => i.kind);
  eq(marks.join(','), 'pause,slow');
});

test('**наголос** охоплює кілька слів', () => {
  const items = parseScript('це **дуже важливо** так').paragraphs[0].items.filter(i => i.type === 'word');
  eq(items.map(i => i.emph ? 1 : 0).join(''), '0110');
});

test('абзаци і переноси рядків', () => {
  const p = parseScript('А б\nв\n\n\nГ д');
  eq(p.paragraphs.length, 2);
  eq(p.paragraphs[1].start, 3);
  ok(p.paragraphs[0].items.some(i => i.type === 'br'), 'є перенос рядка');
});

test('пунктуація окремо не є словом, пробіли зберігаються', () => {
  const p = parseScript('Так — **ні**, звісно');
  eq(p.words.length, 3);
  const comma = p.paragraphs[0].items.find(i => i.text === ',');
  ok(comma && !comma.space, 'кома без пробілу перед нею');
});

test('нормалізація слова', () => {
  eq(normalizeWord('Пам’ять!'), normalizeWord('памʼять'));
  eq(normalizeWord("L'Économie"), 'leconomie');
});

// --- stats ---
test('слова-паразити: прості, багатослівні й звуки вагання', async () => {
  const { countFillers, parseFillers } = await import('../js/stats.js');
  const f = parseFillers('ну, типу, ееее, du coup');
  const c = countFillers(tokenize('ну я типу думаю еее що ну du coup так'), f);
  eq(JSON.stringify(c), JSON.stringify({ 'ну': 2, 'типу': 1, 'ееее': 1, 'du coup': 1 }));
});

test('паразити, які є в самому тексті, не рахуються', async () => {
  const { extraFillers, parseFillers } = await import('../js/stats.js');
  const f = parseFillers('ну');
  const out = extraFillers(tokenize('ну що ж ну почнемо'), tokenize('ну що ж почнемо'), f);
  eq(out['ну'], 1);
});

test('темп: слова за хвилину', async () => {
  const { tempo } = await import('../js/stats.js');
  eq(tempo(130, 60000), 130);
  eq(tempo(10, 1000), null);
});
