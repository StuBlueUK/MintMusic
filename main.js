const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, session } = require('electron');
const path = require('path');

// YouTube (since Jul 2025) rejects embeds without a Referer (error 153).
// file:// sends none, so spoof it + match origin/widget_referrer in the player.
const APP_REFERER = 'https://uk.co.stubblue.mintmusic/';

// Audio-first app: no need for GPU compositing / VA-API video decode.
// This also silences harmless Intel libva errors (iHD_drv_video.so init failed)
// on machines whose iGPU (e.g. Haswell) needs the i965 driver instead.
app.disableHardwareAcceleration();
// Stop Chromium probing VA-API (the source of the iHD_drv_video.so error);
// software decode is plenty for a 320x200 player.
app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    backgroundColor: '#0a1931',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'MintMusic'
  });

  win.loadFile('index.html');
}

function sendMedia(action) {
  if (win && !win.isDestroyed()) win.webContents.send('media-key', action);
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

  // Media keys (Linux: XF86 + generic). Fail silently if taken by system.
  try {
    globalShortcut.register('MediaPlayPause', () => sendMedia('toggle'));
    globalShortcut.register('MediaNextTrack', () => sendMedia('next'));
    globalShortcut.register('MediaPreviousTrack', () => sendMedia('prev'));
    globalShortcut.register('MediaStop', () => sendMedia('pause'));
  } catch {}

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-url', async (_e, url) => {
  const u = String(url || '');
  if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(u)) await shell.openExternal(u);
});

// Keyless YouTube search via Innertube (public WEB client key — no user API key needed).
// Falls back to Piped public instances if Innertube is blocked.
function collectVideos(node, out) {
  if (!node || out.length >= 20) return;
  if (Array.isArray(node)) {
    for (const v of node) { collectVideos(v, out); if (out.length >= 20) return; }
    return;
  }
  if (typeof node === 'object') {
    if (node.videoRenderer && node.videoRenderer.videoId) {
      const vr = node.videoRenderer;
      const title = vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || 'Unknown';
      const channel = vr.ownerText?.runs?.map(r => r.text).join('') || vr.ownerText?.simpleText || '';
      const dur = vr.lengthText?.simpleText || '';
      const thumbs = vr.thumbnail?.thumbnails || [];
      const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
      out.push({ videoId: vr.videoRenderer?.videoId || vr.videoId, title, channel, duration: dur, thumb });
      return;
    }
    for (const k of Object.keys(node)) { collectVideos(node[k], out); if (out.length >= 20) return; }
  }
}

ipcMain.handle('yt-search', async (_e, query) => {
  const q = String(query || '').slice(0, 100);
  if (!q) return [];
  // 1) Innertube
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
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
