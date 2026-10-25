// Розбір тексту сценарію: абзаци, слова, службові позначки [..] і **наголос**.
// Модуль без DOM — його тестують у tests/.

// Нормалізація для порівняння: нижній регістр, без діакритики, апострофів і пунктуації.
// Діакритику прибираємо з обох боків (сценарій і розпізнаний текст), тож й/и, é/e вважаються однаковими.
export function normalizeWord(s) {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]|[ʹ-ʼ]/gu, ''); // ʼ — «літера-модифікатор», прибираємо явно
}

export function markKind(tok) {
  const t = tok.toUpperCase();
  if (/ПАУЗ|PAUSE/.test(t)) return 'pause';
  if (/ПОВІЛЬН|SLOW|LENT/.test(t)) return 'slow';
  return 'other';
}

const TOKEN = /\n|[^\S\n]+|\*\*|\[[^\]\n]*\]|[^\s*[]+|[*[]/gu;

// Повертає { paragraphs: [{ items, start, end }], words: [{ text, norm, para }] }.
// items: word | mark | text | br; поле space означає пробіл перед елементом.
export function parseScript(text) {
  const paragraphs = [];
  const words = [];
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n[^\S\n]*\n\s*/);
  for (const block of blocks) {
    const src = block.trim();
    if (!src) continue;
    const para = { items: [], start: words.length, end: 0 };
    let emph = false;
    let space = false;
    for (const [tok] of src.matchAll(TOKEN)) {
      if (tok === '\n') { para.items.push({ type: 'br' }); space = false; continue; }
      if (!tok.trim()) { space = true; continue; }
      if (tok === '**') { emph = !emph; continue; }
      if (tok.length > 2 && tok[0] === '[' && tok.at(-1) === ']') {
        para.items.push({ type: 'mark', text: tok, kind: markKind(tok), space });
      } else {
        const norm = normalizeWord(tok);
        if (norm) {
          para.items.push({ type: 'word', text: tok, index: words.length, emph, space });
          words.push({ text: tok, norm, para: paragraphs.length });
        } else {
          para.items.push({ type: 'text', text: tok, emph, space });
        }
      }
      space = false;
    }
    para.end = words.length;
    paragraphs.push(para);
  }
  return { paragraphs, words };
}

// Текст без розмітки — для прев'ю в бібліотеці.
export function plainText(text) {
  return String(text).replace(/\*\*/g, '').replace(/\[[^\]\n]*\]/g, '').replace(/\s+/g, ' ').trim();
}
