// Точка входу: завантаження налаштувань і hash-роутинг між екранами.

import { loadSettings, settingsScreen } from './settings.js';
import { libraryScreen, editorScreen } from './library.js';
import { playScreen } from './prompter.js';
import { recordScreen } from './recorder.js';
import { historyScreen } from './stats.js';

const app = document.getElementById('app');

const routes = [
  { re: /^\/?$/, tab: 'library', screen: () => libraryScreen(app) },
  { re: /^\/settings$/, tab: 'settings', screen: () => settingsScreen(app) },
  { re: /^\/script\/([\w-]+)$/, sub: true, screen: id => editorScreen(app, id) },
  { re: /^\/history\/([\w-]+)$/, sub: true, screen: id => historyScreen(app, id) },
  { re: /^\/play\/([\w-]+)$/, full: true, screen: id => playScreen(app, id) },
  { re: /^\/record\/([\w-]+)$/, full: true, screen: id => recordScreen(app, id) },
];

let cleanup = null;
let seq = 0;

async function route() {
  const n = ++seq;
  const path = location.hash.replace(/^#/, '');
  const r = routes.find(x => x.re.test(path)) ?? routes[0];
  const params = (path.match(r.re) || []).slice(1);

  if (cleanup) {
    const c = cleanup;
    cleanup = null;
    try { await c(); } catch (err) { console.error(err); }
  }
  if (n !== seq) return;

  document.body.classList.toggle('fullscreen', !!r.full);
  document.body.classList.toggle('no-tabbar', !!(r.full || r.sub));
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === r.tab));
  app.replaceChildren();
  window.scrollTo(0, 0);

  const c = await r.screen(...params);
  if (n === seq) cleanup = c || null;
  else c?.();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
}

await loadSettings();
window.addEventListener('hashchange', route);
route();
