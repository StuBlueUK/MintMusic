const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mintmusic', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, action) => cb(action)),
  searchYouTube: (q) => ipcRenderer.invoke('yt-search', q),
  searchPlaylists: (q) => ipcRenderer.invoke('yt-search-playlists', q),
  importPlaylist: (id) => ipcRenderer.invoke('yt-playlist', id),
  searchYouTubeData: (q) => ipcRenderer.invoke('yt-data-search', q),
  importPlaylistData: (id) => ipcRenderer.invoke('yt-data-playlist', id),
  apiKeyStatus: () => ipcRenderer.invoke('api-key-status'),
  apiKeySet: (key) => ipcRenderer.invoke('api-key-set', key),
  apiKeyClear: () => ipcRenderer.invoke('api-key-clear'),
  exportQueue: (tracks) => ipcRenderer.invoke('save-m3u', tracks),
  getFilePath: (file) => webUtils.getPathForFile(file),
  openUrl: (u) => ipcRenderer.invoke('open-url', u),
  trayPrefsGet: () => ipcRenderer.invoke('tray-prefs-get'),
  trayPrefsSet: (p) => ipcRenderer.invoke('tray-prefs-set', p),
  miniToggle: () => ipcRenderer.invoke('mini-toggle'),
  mprisUpdate: (s) => ipcRenderer.invoke('mpris-update', s),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  updateStatusGet: () => ipcRenderer.invoke('update-status-get'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  }
});
