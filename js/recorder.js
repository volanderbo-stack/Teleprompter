// Запис відео: фронтальна камера + напівпрозорий суфлер угорі. У файл потрапляє лише камера і звук.

import { PromptSession, bindControls, loadPlayable, modeSwitchHTML, panelHTML } from './prompter.js';
import { settings } from './settings.js';
import { icon, esc, sheet, toast, fmtClock, isSheetOpen } from './ui.js';
import { summaryHTML } from './stats.js';
import { db } from './db.js';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType() {
  if (!window.MediaRecorder) return null;
  return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
}

const CAMERA_ERRORS = {
  NotAllowedError: 'Немає доступу до камери або мікрофона. Дозвольте їх у налаштуваннях браузера.',
  NotFoundError: 'Камеру не знайдено.',
  NotReadableError: 'Камера зайнята іншим застосунком.',
  OverconstrainedError: 'Камера не підтримує потрібний режим.',
};

export class Recorder {
  constructor(stream) {
    this.stream = stream;
    this.mime = pickMimeType();
    this.chunks = [];
  }

  start() {
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.startedAt = Date.now();
  }

  stop() {
    return new Promise(resolve => {
      if (!this.rec || this.rec.state === 'inactive') { resolve(null); return; }
      this.rec.onstop = () => {
        const type = this.rec.mimeType || this.mime || 'video/webm';
        resolve(new Blob(this.chunks, { type: type.split(';')[0] }));
      };
      this.rec.stop();
    });
  }

  get recording() { return this.rec?.state === 'recording'; }
}

function fileName(title, blob) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  const safe = (title || 'video').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 40) || 'video';
  return `${safe}_${stamp}.${ext}`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try {
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') toast('Не вдалося поділитися — спробуйте «Зберегти»');
    return false;
  }
}

const canShareFiles = blob =>
  !!navigator.canShare?.({ files: [new File([blob], 'v', { type: blob.type })] });

// --- Збереження в обрану папку (File System Access API: Chrome і Edge на комп'ютері) ---
export const folderSupported = () => 'showDirectoryPicker' in window;

export const getVideoFolder = () => db.get('kv', 'videoFolder').catch(() => null);
export const forgetVideoFolder = () => db.del('kv', 'videoFolder');

export async function chooseVideoFolder() {
  const dir = await window.showDirectoryPicker({ id: 'suffler-videos', mode: 'readwrite', startIn: 'videos' });
  await db.put('kv', dir, 'videoFolder');
  return dir;
}

// Після перезапуску браузера доступ до папки треба підтвердити ще раз (запит покаже браузер).
async function canWrite(dir) {
  const opts = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  return (await dir.requestPermission(opts)) === 'granted';
}

async function writeFile(fileHandle, blob) {
  const w = await fileHandle.createWritable();
  await w.write(blob);
  await w.close();
}

async function saveToFolder(dir, name, blob) {
  if (!(await canWrite(dir))) throw new Error('Немає дозволу на запис у папку');
  await writeFile(await dir.getFileHandle(name, { create: true }), blob);
}

async function saveAs(blob, name) {
  const ext = name.split('.').pop();
  const fh = await window.showSaveFilePicker({
    suggestedName: name, id: 'suffler-videos', startIn: 'videos',
    types: [{ description: 'Відео', accept: { [blob.type]: [`.${ext}`] } }],
  });
  await writeFile(fh, blob);
  return fh.name;
}

// Шторка з готовим відео. Повертає 'again' | 'done'.
async function videoSheet(blob, title, extraHTML = '') {
  const url = URL.createObjectURL(blob);
  const name = fileName(title, blob);
  const share = canShareFiles(blob);
  const mb = (blob.size / 1048576).toFixed(1);
  let folder = folderSupported() ? await getVideoFolder() : null;
  let savedNote = '';

  for (;;) {
    const actions = [];
    if (folderSupported()) {
      if (folder) {
        actions.push({ label: `Зберегти в «${folder.name}»`, value: 'folder', icon: 'import', style: 'btn-primary' });
        actions.push({ label: 'Зберегти як…', value: 'saveas', style: 'btn-tinted' });
      } else {
        actions.push({ label: 'Вибрати папку і зберегти', value: 'pick', icon: 'import', style: 'btn-primary' });
        actions.push({ label: 'Завантажити', value: 'download', style: 'btn-tinted' });
      }
    } else {
      actions.push({ label: 'Зберегти відео', value: 'download', icon: 'import', style: 'btn-primary' });
    }
    if (share) actions.push({ label: 'Поділитися / у Фото', value: 'share', icon: 'share', style: 'btn-tinted' });
    actions.push({ label: 'Записати ще раз', value: 'again', icon: 'video', style: 'btn-tinted' });
    actions.push({ label: 'Готово', value: 'done', style: 'btn-plain' });

    const choice = await sheet({
      title: 'Відео готове',
      html: `<video class="rec-result" src="${url}" controls playsinline></video>
        <p class="sheet-note">${esc(name)} · ${mb} МБ${savedNote ? ` · <b>${esc(savedNote)}</b>` : ''}</p>${extraHTML}`,
      actions,
    });
    try {
      if (choice === 'pick') {
        folder = await chooseVideoFolder();
        await saveToFolder(folder, name, blob);
        savedNote = `збережено в «${folder.name}»`;
        continue;
      }
      if (choice === 'folder') {
        await saveToFolder(folder, name, blob);
        savedNote = `збережено в «${folder.name}»`;
        continue;
      }
      if (choice === 'saveas') { savedNote = `збережено як «${await saveAs(blob, name)}»`; continue; }
      if (choice === 'download') { downloadBlob(blob, name); savedNote = 'завантажено'; continue; }
      if (choice === 'share') { if (await shareFile(blob, name)) savedNote = 'надіслано'; continue; }
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Не вдалося зберегти: ${e.message}`, 4000);
      continue;
    }
    if (!savedNote) {
      const sure = await sheet({
        title: 'Відео не збережене',
        actions: [
          { label: 'Не зберігати', value: true, style: 'btn-danger' },
          { label: 'Назад', value: false, style: 'btn-plain' },
        ],
      });
      if (!sure) continue;
    }
    URL.revokeObjectURL(url);
    return choice === 'again' ? 'again' : 'done';
  }
}

// Окремі налаштування тексту для запису: блок біля камери, вузький, щоб очі не бігали.
const REC_PANEL = [
  ['recFontSize', 'Розмір шрифту', 18, 72, 1, 'px'],
  ['recWidth', 'Ширина тексту', 20, 100, 1, '%'],
  ['recFocus', 'Лінія читання від верху', 5, 60, 1, '%'],
  ['recHeight', 'Висота блоку тексту', 15, 80, 1, '%'],
  ['recOpacity', 'Затемнення фону', 0, 90, 1, '%'],
];

const recView = () => ({
  customColors: true, bgColor: '#000000', textColor: '#ffffff',
  mirrorX: false, mirrorY: false,
  fontSize: settings.recFontSize, textWidth: settings.recWidth, focus: settings.recFocus,
});

// --- Екран запису ---
export async function recordScreen(root, id) {
  const script = await loadPlayable(id);
  if (!script) return;

  root.innerHTML = `<div class="pr-screen rec-screen">
    <video class="rec-video" playsinline muted autoplay></video>
    <div class="rec-overlay"><div class="pr-host"></div></div>
    <div class="pr-bottom rec-bottom">
      <div class="rec-bar">
        <button class="pr-btn pr-sm" data-act="exit" aria-label="Закрити">${icon('close')}</button>
        ${modeSwitchHTML()}
        <div class="rec-timer"><span class="rec-dot"></span><span class="rec-time">0:00</span></div>
        <button class="pr-btn pr-sm pr-aa" data-act="panel" aria-label="Вигляд тексту">Aa</button>
      </div>
      <div class="pr-mic"></div>
      <div class="pr-transport">
        <button class="pr-btn" data-act="prev" aria-label="Попередній абзац">${icon('para-back')}</button>
        <button class="pr-btn pr-play pr-play-sm" data-act="toggle" aria-label="Текст: старт / пауза">${icon('play')}</button>
        <button class="rec-btn" data-act="record" aria-label="Почати запис"><span></span></button>
        <button class="pr-btn" data-act="next" aria-label="Наступний абзац">${icon('para-fwd')}</button>
      </div>
    </div>
    ${panelHTML(REC_PANEL)}
    <div class="rec-count" hidden></div>
    <div class="rec-error" hidden></div>
  </div>`;

  const screen = root.querySelector('.rec-screen');
  const $ = s => screen.querySelector(s);
  const video = $('.rec-video');
  const session = new PromptSession(screen, script, recView);
  let stream = null, recorder = null, timer = null, countdown = null, closed = false;

  const exit = () => { location.hash = `#/script/${id}`; };
  session.onFinish = () => {}; // текст закінчився — запис триває, доки його не зупинять
  const unbind = bindControls(screen, session, {
    exit, finish: exit, panel: REC_PANEL, fontKey: 'recFontSize',
    onView: () => {
      screen.style.setProperty('--rec-h', `${settings.recHeight}%`);
      screen.style.setProperty('--rec-op', settings.recOpacity / 100);
    },
  });

  const showError = msg => {
    const el = $('.rec-error');
    el.hidden = false;
    el.innerHTML = `${icon('video')}<p>${esc(msg)}</p><button class="btn btn-primary" data-act="exit">Назад</button>`;
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Цей браузер не підтримує доступ до камери. Відкрийте застосунок через https або localhost.');
  } else if (pickMimeType() === null) {
    showError('Цей браузер не вміє записувати відео (немає MediaRecorder).');
  } else {
    try {
      stream = await openCamera();
      if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      recorder = new Recorder(stream);
    } catch (e) {
      showError(CAMERA_ERRORS[e.name] || `Не вдалося увімкнути камеру: ${e.message}`);
    }
  }

  const setRecording = on => {
    screen.classList.toggle('recording', on);
    $('.rec-btn').setAttribute('aria-label', on ? 'Зупинити запис' : 'Почати запис');
    clearInterval(timer);
    $('.rec-time').textContent = '0:00';
    if (on) timer = setInterval(() => { $('.rec-time').textContent = fmtClock(Date.now() - recorder.startedAt); }, 250);
  };

  const startCountdown = () => new Promise(resolve => {
    const el = $('.rec-count');
    let n = 3;
    el.hidden = false;
    const step = () => {
      if (closed) { el.hidden = true; resolve(false); return; }
      if (n === 0) { el.hidden = true; countdown = null; resolve(true); return; }
      el.textContent = n;
      el.classList.remove('pop');
      void el.offsetWidth; // перезапуск анімації
      el.classList.add('pop');
      n--;
      countdown = setTimeout(step, 1000);
    };
    step();
  });

  const toggleRecording = async () => {
    if (!recorder || countdown) return;
    if (recorder.recording) {
      const blob = await recorder.stop();
      session.pause();
      setRecording(false);
      const sum = await session.record();
      if (!blob || !blob.size) { toast('Запис порожній'); return; }
      const next = await videoSheet(blob, script.title, sum ? `<div class="sheet-stats">${summaryHTML(sum)}</div>` : '');
      if (next === 'done') exit();
      else session.restart();
      return;
    }
    session.pause();
    if (!(await startCountdown())) return;
    recorder.start();
    setRecording(true);
    session.play();
  };

  screen.addEventListener('click', e => {
    if (e.target.closest('[data-act="record"]')) toggleRecording();
  });
  const onKey = e => {
    if ((e.key === 'r' || e.key === 'к') && !e.repeat && !isSheetOpen() && !e.target.closest?.('input, textarea')) toggleRecording();
  };
  window.addEventListener('keydown', onKey);

  return async () => {
    closed = true;
    clearTimeout(countdown);
    clearInterval(timer);
    window.removeEventListener('keydown', onKey);
    if (recorder?.recording) await recorder.stop();
    stream?.getTracks().forEach(t => t.stop());
    unbind();
    session.destroy();
  };
}
