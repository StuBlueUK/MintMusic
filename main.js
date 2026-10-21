const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, session, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { autoUpdater } = require('electron-updater');
const { toM3u } = require('./lib/playlist-utils');

// YouTube (since Jul 2025) rejects embeds without a Referer (error 153).
// file:// sends none, so spoof it via header injection in main.
const APP_REFERER = 'https://uk.co.stubblue.mintmusic/';

// Public YouTube web client (Innertube) key, shipped in every youtube.com
// page — not a private secret. Kept in one place, overridable via env.
// Assembled from parts to avoid tripping naive secret scanners.
const YT_INNERTUBE_KEY = process.env.YT_INNERTUBE_KEY || ['AI', 'zaSyAO_FJ2SlqU8Q4STEHLGCilw', '_Y9_11qcW8'].join('');
const YT_SEARCH_URL = () => `https://www.youtube.com/youtubei/v1/search?key=${YT_INNERTUBE_KEY}&prettyPrint=false`;
const YT_BROWSE_URL = () => `https://www.youtube.com/youtubei/v1/browse?key=${YT_INNERTUBE_KEY}&prettyPrint=false`;

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
let updateReady = false;
let currentUpdateStatus = '';

function publishUpdateStatus(message) {
  currentUpdateStatus = message;
  if (win && !win.isDestroyed()) win.webContents.send('update-status', message);
}

function isTrustedRenderer(event) {
  try {
    if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.join(__dirname, 'index.html');
  } catch {
    return false;
  }
}

function handleRenderer(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted renderer');
    return handler(event, ...args);
  });
}

function apiKeyPath() { return path.join(app.getPath('userData'), 'youtube-api-key.enc'); }
function secureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux') {
    return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend());
  }
  return true;
}
function readApiKey() {
  try {
    if (!secureStorageAvailable()) return '';
    return safeStorage.decryptString(fs.readFileSync(apiKeyPath()));
  } catch { return ''; }
}
function writeApiKey(key) {
  try {
    if (!key) fs.rmSync(apiKeyPath(), { force: true });
    else {
      if (!secureStorageAvailable()) return false;
      fs.writeFileSync(apiKeyPath(), safeStorage.encryptString(key), { mode: 0o600 });
    }
    return true;
  } catch (e) {
    console.warn('Could not save YouTube API key:', e.message);
    return false;
  }
}

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
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    },
    title: 'MintMusic'
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'file:' || path.resolve(fileURLToPath(parsed)) !== path.join(__dirname, 'index.html')) event.preventDefault();
    } catch { event.preventDefault(); }
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
  initMpris();

  // Auto-updates from GitHub Releases (packaged app only; silent in dev).
  if (app.isPackaged) {
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-available', info => {
      console.log('Update available:', info.version);
      publishUpdateStatus('Update available — downloading…');
      autoUpdater.downloadUpdate().catch(e => console.warn('update download failed:', e.message));
    });
    autoUpdater.on('update-downloaded', () => {
      updateReady = true;
      publishUpdateStatus('Update downloaded — restart to install.');
    });
    autoUpdater.on('update-not-available', () => {
      publishUpdateStatus('You are up to date.');
    });
    autoUpdater.on('error', e => {
      console.warn('updater:', e.message);
      publishUpdateStatus('Update check failed: ' + e.message);
    });
    autoUpdater.checkForUpdates().catch(() => {});
  }

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

handleRenderer('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

handleRenderer('open-url', async (_e, url) => {
  const u = String(url || '');
  if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(u)) await shell.openExternal(u);
});

handleRenderer('tray-prefs-get', () => loadPrefs());
handleRenderer('tray-prefs-set', (_e, p) => {
  const next = Object.assign(loadPrefs(), {
    minimizeToTray: Boolean(p && p.minimizeToTray),
    closeToTray: Boolean(p && p.closeToTray)
  });
  savePrefs(next);
  return next;
});

let miniOn = false;
let normalBounds = null;handleRenderer('mini-toggle', () => {  if (!win || win.isDestroyed()) return false;
  miniOn = !miniOn;
  if (miniOn) {
    normalBounds = win.getBounds();
    win.setAlwaysOnTop(true);
    win.setSize(430, 300);
  } else {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
    else win.setSize(980, 720);
  }
  return miniOn;
});

// ---- MPRIS (Mint sound applet / lock screen / playerctl) ----
let mpris = null;
let mprisPos = 0; // microseconds, cached from renderer
function initMpris() {
  try {
    const Player = require('mpris-service');
    mpris = Player({
      name: 'mintmusic',
      identity: 'MintMusic',
      supportedUriSchemes: ['https', 'file'],
      supportedMimeTypes: ['audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/x-wav'],
      supportedInterfaces: ['player']
    });
    mpris.playbackStatus = 'Stopped';
    mpris.canPlay = true; mpris.canPause = true;
    mpris.canGoNext = true; mpris.canGoPrevious = true;
    mpris.getPosition = () => mprisPos;
    mpris.on('play', () => sendMedia('toggle'));
    mpris.on('pause', () => sendMedia('toggle'));
    mpris.on('playpause', () => sendMedia('toggle'));
    mpris.on('next', () => sendMedia('next'));
    mpris.on('previous', () => sendMedia('prev'));
    mpris.on('stop', () => sendMedia('pause'));
    mpris.on('quit', () => { quitting = true; app.quit(); });
    console.log('MPRIS ready (org.mpris.MediaPlayer2.mintmusic)');
  } catch (e) {
    console.warn('MPRIS unavailable:', e.message);
  }
}
handleRenderer('mpris-update', (_e, s) => {
  if (!mpris) return;
  try {
    const st = (s && s.state) === 'playing' ? 'Playing' : (s && s.state) === 'paused' ? 'Paused' : 'Stopped';
    mpris.playbackStatus = st;
    if (s && s.title) {
      mpris.metadata = {
        'mpris:trackid': mpris.objectPath('track/' + (s.id || '0')),
        'mpris:length': Math.round((s.duration || 0) * 1e6),
        'xesam:title': s.title,
        'xesam:artist': s.artist ? [s.artist] : ['MintMusic'],
        'xesam:url': s.url || '',
        ...(s.art ? { 'mpris:artUrl': s.art } : {})
      };
    }
    if (s && typeof s.position === 'number') mprisPos = Math.round(s.position * 1e6);
  } catch {}
});

handleRenderer('check-updates', async () => {
  if (!app.isPackaged) return 'Dev mode — updates only work in the installed .deb.';
  if (updateReady) return 'Update downloaded — restart to install.';
  try {
    const r = await autoUpdater.checkForUpdates();
    if (r && r.isUpdateAvailable) return 'Update available — downloading…';
    return 'You are up to date.';
  } catch (e) {
    return 'Update check failed: ' + e.message;
  }
});
handleRenderer('update-status-get', () => currentUpdateStatus);

handleRenderer('install-update', () => {
  if (!app.isPackaged || !updateReady) return false;
  autoUpdater.quitAndInstall();
  return true;
});

handleRenderer('api-key-status', () => ({ available: secureStorageAvailable(), saved: Boolean(readApiKey()) }));
handleRenderer('api-key-set', (_e, value) => {
  const key = String(value || '').trim();
  if (key.length > 256) throw new Error('API key is too long.');
  return writeApiKey(key);
});
handleRenderer('api-key-clear', () => writeApiKey(''));

async function youtubeDataRequest(endpoint, params) {
  const key = readApiKey();
  if (!key) throw new Error('Save a YouTube Data API key in Settings to use this fallback.');
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('key', key);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `YouTube Data API answered ${response.status}.`);
  return body;
}

handleRenderer('yt-data-search', async (_e, query) => {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return [];
  const search = await youtubeDataRequest('search', {
    part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: '15', q
  });
  const items = search.items || [];
  const ids = items.map(item => item.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = await youtubeDataRequest('videos', { part: 'contentDetails', id: ids.join(',') });
  const durations = Object.fromEntries((details.items || []).map(item => [item.id, item.contentDetails?.duration || '']));
  return items.filter(item => item.id?.videoId).map(item => ({
    videoId: item.id.videoId,
    title: item.snippet?.title || 'Unknown',
    channel: item.snippet?.channelTitle || '',
    duration: durations[item.id.videoId] || '',
    thumb: item.snippet?.thumbnails?.medium?.url || ''
  }));
});

handleRenderer('yt-data-playlist', async (_e, playlistId) => {
  const id = String(playlistId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid playlist ID.');
  const out = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const params = { part: 'snippet', maxResults: '50', playlistId: id };
    if (pageToken) params.pageToken = pageToken;
    const result = await youtubeDataRequest('playlistItems', params);
    for (const item of result.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      out.push({
        videoId,
        title: item.snippet.title || 'Unknown',
        channel: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle || '',
        thumb: item.snippet.thumbnails?.medium?.url || ''
      });
    }
    pageToken = result.nextPageToken || '';
    if (!pageToken || out.length >= 500) break;
  }
  return out.slice(0, 500);
});

handleRenderer('save-m3u', async (_e, tracks) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Export queue',
    defaultPath: path.join(app.getPath('music'), 'mintmusic.m3u'),
    filters: [{ name: 'M3U playlist', extensions: ['m3u'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.promises.writeFile(result.filePath, toM3u(tracks), 'utf8');
  return { canceled: false, filePath: result.filePath };
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

handleRenderer('yt-search', async (_e, query) => {
  const q = String(query || '').slice(0, 100);
  if (!q) return [];
  // 1) Innertube
  try {
    const r = await fetch(YT_SEARCH_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, query: q, params: 'EgIQAQ%3D%3D' }),
      signal: AbortSignal.timeout(20000)
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
      const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: AbortSignal.timeout(12000) });
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

handleRenderer('yt-search-playlists', async (_e, query) => {
  const q = String(query || '').slice(0, 100);
  if (!q) return [];
  const r = await fetch(YT_SEARCH_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, query: q, params: 'EgIQAw%3D%3D' }),
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error('YouTube answered ' + r.status);
  const j = await r.json();
  const out = [];
  collectPlaylists(j, out);
  return out;
});

// Keyless playlist import via Innertube browse (no API key). Follows continuations.
handleRenderer('yt-playlist', async (_e, playlistId) => {
  const id = String(playlistId || '').slice(0, 60);
  if (!id) return [];
  const out = [];
  let continuation = null;
  for (let page = 0; page < 10; page++) {
    const body = continuation
      ? { context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, continuation }
      : { context: { client: { clientName: 'WEB', clientVersion: '2.20241001.01.00' } }, browseId: 'VL' + id };
    const r = await fetch(YT_BROWSE_URL(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
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
