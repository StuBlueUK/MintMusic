const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mintmusic', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, action) => cb(action))
});
