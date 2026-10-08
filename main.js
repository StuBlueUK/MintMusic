const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');

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
