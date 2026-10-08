const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mintmusic', {
  pickFolder: () => ipcRenderer.invoke('pick-folder')
});
