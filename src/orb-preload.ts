import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('orb', {
    click: () => ipcRenderer.send('orb:click'),
    dragStart: () => ipcRenderer.send('orb:drag-start'),
    dragEnd: () => ipcRenderer.send('orb:drag-end'),
});
