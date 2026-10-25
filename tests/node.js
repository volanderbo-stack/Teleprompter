// Запуск тестів у Node: `npm test`.
import { tests } from './cases.js';

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`✓ ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${t.name}\n    ${e.message}`);
  }
}
console.log(failed ? `\nПровалено: ${failed} з ${tests.length}` : `\nУсі ${tests.length} тестів пройдено`);
process.exitCode = failed ? 1 : 0;
