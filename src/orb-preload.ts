import { contextBridge, ipcRenderer } from 'electron';

type MascotFrame = { width: number; height: number; data: Uint8ClampedArray; background: string } | null;

contextBridge.exposeInMainWorld('orb', {
    click: () => ipcRenderer.send('orb:click'),
    dragStart: () => ipcRenderer.send('orb:drag-start'),
    dragEnd: () => ipcRenderer.send('orb:drag-end'),
    onMascotFrame: (callback: (frame: MascotFrame) => void) => {
        ipcRenderer.on('mascot:frame', (_event, frame: MascotFrame) => callback(frame));
    },
});
