const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// YouTube (since Jul 2025) rejects embeds without a Referer (error 153).
// file:// sends none, so spoof it via header injection in main.
const APP_REFERER = 'https://uk.co.stubblue.mintmusic/';

// Audio-first app: no need for GPU compositing / VA-API video decode.
// This also silences harmless Intel libva errors (iHD_drv_video.so init failed)
// on machines whose iGPU (e.g. Haswell) needs the i965 driver instead.
app.disableHardwareAcceleration();
// Stop Chromium probing VA-API (the source of the iHD_drv_video.so error);
// software decode is plenty for a 320x200 player.
app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');

let win = null;
let tray = null;
let quitting = false;

// ---- tray prefs (persisted in userData) ----
function prefsPath() { return path.join(app.getPath('userData'), 'tray.json'); }
function loadPrefs() {
  try { return Object.assign({ minimizeToTray: true, closeToTray: false }, JSON.parse(fs.readFileSync(prefsPath(), 'utf8'))); }
  catch { return { minimizeToTray: true, closeToTray: false }; }
}
function savePrefs(p) { try { fs.writeFileSync(prefsPath(), JSON.stringify(p)); } catch {} }

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    backgroundColor: '#0a1931',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'MintMusic'
  });

  win.loadFile('index.html');

  win.on('minimize', () => {
    if (loadPrefs().minimizeToTray) win.hide();
  });
  win.on('close', (e) => {
    if (!quitting && loadPrefs().closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
}

function toggleShow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

function buildTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray.png');
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  } catch (e) {
    console.warn('tray unavailable:', e.message);
    return;
  }
  tray.setToolTip('MintMusic');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleShow },
    { label: 'Play / Pause', click: () => sendMedia('toggle') },
    { label: 'Next track', click: () => sendMedia('next') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', toggleShow);
}

function sendMedia(action) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) { /* keep hidden on tray-only control */ }
  win.webContents.send('media-key', action);
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.googlevideo.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = APP_REFERER;
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  createWindow();
  buildTray();

  // Media keys (Linux: XF86 + generic). Fail silently if taken by system.
  try {
    globalShortcut.register('MediaPlayPause', () => sendMedia('toggle'));
    globalShortcut.register('MediaNextTrack', () => sendMedia('next'));
    globalShortcut.register('MediaPreviousTrack', () => sendMedia('prev'));
    globalShortcut.register('MediaStop', () => sendMedia('pause'));
  } catch {}

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win) { win.show(); }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  // With minimize-to-tray, windows are hidden not closed; quit only when asked.
  if (process.platform !== 'darwin' && (!tray || quitting)) app.quit();
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-url', async (_e, url) => {
  const u = String(url || '');
  if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(u)) await shell.openExternal(u);
});

ipcMain.handle('tray-prefs-get', () => loadPrefs());
ipcMain.handle('tray-prefs-set', (_e, p) => {
  const next = Object.assign(loadPrefs(), p);
  savePrefs(next);
  return next;
});

// ---- keyless YouTube (Innertube) ----
function collectVideos(node, out) {
  if (!node || out.length >= 500) return;
  if (Array.isArray(node)) {
    for (const v of node) { collectVideos(v, out); if (out.length >= 500) return; }
    return;
  }
  if (typeof node === 'object') {
    const vr = node.videoRenderer || node.playlistVideoRenderer;
    if (vr && vr.videoId) {
      const title = vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || 'Unknown';
      const channel = vr.ownerText?.runs?.map(r => r.text).join('')
        || vr.shortBylineText?.runs?.map(r => r.text).join('')
        || vr.shortBylineText?.simpleText || '';
      const dur = vr.lengthText?.simpleText || '';
      const thumbs = vr.thumbnail?.thumbnails || [];
      const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
      out.push({ videoId: vr.videoId, title, channel, duration: dur, thumb });
      return;
    }
    for (const k of Object.keys(node)) { collectVideos(node[k], out); if (out.length >= 500) return; }
  }
}
function findContinuation(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const v of node) { const t = findContinuation(v); if (t) return t; }
    return null;
  }
  if (typeof node === 'object') {
    if (node.continuationCommand && node.continuationCommand.token) return node.continuationCommand.token;
    for (const k of Object.keys(node)) { const t = findContinuation(node[k]); if (t) return t; }
  }
  return null;
}

ipcMain.handle('yt-search', async (_e, query) => {
  const q = String(query || '').slice(0, 100);
  if (!q) return [];
  // 1) Innertube
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?key=' + ['AI', 'zaSyAO_FJ2SlqU8Q4STEHLGCilw', '_Y9_11qcW8'].join('') + '&prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, query: q, params: 'EgIQAQ%3D%3D' })
    });
    if (r.ok) {
      const j = await r.json();
      const out = [];
      collectVideos(j, out);
      if (out.length) return out.slice(0, 15);
    }
  } catch {}
  // 2) Piped fallback instances
  const instances = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api-piped.mha.fi'];
  for (const base of instances) {
    try {
      const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`);
      if (!r.ok) continue;
      const j = await r.json();
      const items = (j.items || j).filter(i => i.url && i.url.includes('/watch'));
      if (items.length) {
        return items.slice(0, 15).map(i => ({
          videoId: (i.url.match(/v=([^&]+)/) || [])[1] || i.url,
          title: i.title || 'Unknown',
          channel: i.uploaderName || '',
          duration: i.duration ? new Date(i.duration * 1000).toISOString().slice(11, 19).replace(/^00:/, '') : '',
          thumb: i.thumbnail || ''
        }));
      }
    } catch {}
  }
  throw new Error('Keyless search failed (network blocked?). Add a Data API key in Settings as backup.');
});

// Keyless playlist discovery: search filter type=playlist, collect playlistRenderers.
function collectPlaylists(node, out) {
  if (!node || out.length >= 20) return;
  if (Array.isArray(node)) {
    for (const v of node) { collectPlaylists(v, out); if (out.length >= 20) return; }
    return;
  }
  if (typeof node === 'object') {
    const pl = node.playlistRenderer;
    if (pl && pl.playlistId) {
      const title = pl.title?.simpleText || pl.title?.runs?.map(r => r.text).join('') || 'Untitled';
      const channel = pl.shortBylineText?.simpleText || pl.shortBylineText?.runs?.map(r => r.text).join('') || '';
      const count = pl.videoCountText?.simpleText || pl.videoCount || '';
      const thumbs = pl.thumbnails?.[0]?.thumbnails || pl.thumbnail?.thumbnails || [];
      const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
      out.push({ playlistId: pl.playlistId, title, channel, count, thumb });
      return;
    }
    for (const k of Object.keys(node)) { collectPlaylists(node[k], out); if (out.length >= 20) return; }
  }
}

ipcMain.handle('yt-search-playlists', async (_e, query) => {
  const q = String(query || '').slice(0, 100);
  if (!q) return [];
  const r = await fetch('https://www.youtube.com/youtubei/v1/search?key=' + ['AI', 'zaSyAO_FJ2SlqU8Q4STEHLGCilw', '_Y9_11qcW8'].join('') + '&prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, query: q, params: 'EgIQAw%3D%3D' })
  });
  if (!r.ok) throw new Error('YouTube answered ' + r.status);
  const j = await r.json();
  const out = [];
  collectPlaylists(j, out);
  return out;
});

// Keyless playlist import via Innertube browse (no API key). Follows continuations.
ipcMain.handle('yt-playlist', async (_e, playlistId) => {
  const id = String(playlistId || '').slice(0, 60);
  if (!id) return [];
  const out = [];
  let continuation = null;
  for (let page = 0; page < 10; page++) {
    const body = continuation
      ? { context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, continuation }
      : { context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, browseId: 'VL' + id };
    const r = await fetch('https://www.youtube.com/youtubei/v1/browse?key=' + ['AI', 'zaSyAO_FJ2SlqU8Q4STEHLGCilw', '_Y9_11qcW8'].join('') + '&prettyPrint=false', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('YouTube answered ' + r.status);
    const j = await r.json();
    const before = out.length;
    collectVideos(j, out);
    if (out.length === before && page === 0) throw new Error('Playlist not found, private, or empty.');
    continuation = findContinuation(j);
    if (!continuation || out.length >= 500) break;
  }
  return out;
});
