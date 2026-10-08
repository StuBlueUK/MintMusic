const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mintmusic', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, action) => cb(action)),
  searchYouTube: (q) => ipcRenderer.invoke('yt-search', q),
  importPlaylist: (id) => ipcRenderer.invoke('yt-playlist', id),
  openUrl: (u) => ipcRenderer.invoke('open-url', u)
});
