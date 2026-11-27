import type { BrowserWindow } from 'electron';
import { previousApp, returnToApp } from './mac-focus';

const SW_RESTORE = 9;
const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const VK_F24 = 0x87;
const KEYEVENTF_KEYUP = 0x2;
const TASKBAR_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

type Api = {
    getForegroundWindow: () => number;
    getWindowThreadId: (window: number) => number;
    getClassName: (window: number) => string;
    setForegroundWindow: (window: number) => number;
    showWindowAsync: (window: number, command: number) => number;
    isWindow: (window: number) => number;
    isIconic: (window: number) => number;
    keybdEvent: (key: number, scan: number, flags: number, extra: number) => void;
    setWindowPos: (window: number, after: number, x: number, y: number, width: number, height: number, flags: number) => number;
    currentThreadId: () => number;
};

let api: Api | null | undefined;

function load(): Api | null {
    if (api !== undefined) {
        return api;
    }
    if (process.platform !== 'win32') {
        return (api = null);
    }
    try {
        const koffi = require('koffi');
        const user = koffi.load('user32.dll');
        const kernel = koffi.load('kernel32.dll');
        const getWindowThreadProcessId = user.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, void *pid)');
        const getClassName = user.func('int __stdcall GetClassNameW(intptr_t hWnd, void *name, int size)');
        api = {
            getForegroundWindow: user.func('intptr_t __stdcall GetForegroundWindow()'),
            getWindowThreadId: (window) => getWindowThreadProcessId(window, null),
            getClassName: (window) => {
                const name = Buffer.alloc(512);
                const length = getClassName(window, name, name.length / 2);
                return name.toString('utf16le', 0, length * 2);
            },
            setForegroundWindow: user.func('int __stdcall SetForegroundWindow(intptr_t hWnd)'),
            showWindowAsync: user.func('int __stdcall ShowWindowAsync(intptr_t hWnd, int nCmdShow)'),
            isWindow: user.func('int __stdcall IsWindow(intptr_t hWnd)'),
            isIconic: user.func('int __stdcall IsIconic(intptr_t hWnd)'),
            keybdEvent: user.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'),
            setWindowPos: user.func('int __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'),
            currentThreadId: kernel.func('uint32_t __stdcall GetCurrentThreadId()'),
        };
    } catch (error) {
        console.error('Could not load the Windows focus functions, so the chat may not get the keyboard', error);
        api = null;
    }
    return api;
}

function handleOf(window: BrowserWindow): number {
    return Number(window.getNativeWindowHandle().readBigInt64LE(0));
}

// Windows does not let a background app take keyboard focus from the app in front, so a game like Minecraft would keep getting the keys after the chat opens.
// Windows lifts that lock for the process that sent the last input, so a press of F24, a key that few apps use, comes first.
// AttachThreadInput also works, but it waits on the front app and froze our windows while a game was busy.
function activate(api: Api, target: number): void {
    if (api.getForegroundWindow() === target) {
        return;
    }
    api.keybdEvent(VK_F24, 0, 0, 0);
    api.keybdEvent(VK_F24, 0, KEYEVENTF_KEYUP, 0);
    api.setForegroundWindow(target);
}

// The window in front now, or null when it is one of ours, the taskbar, or the focus functions are not available.
// On macOS, the process id of the last other app in front.
export function foregroundWindow(): number | null {
    if (process.platform === 'darwin') {
        return previousApp();
    }
    const api = load();
    if (!api) {
        return null;
    }
    const front = api.getForegroundWindow();
    if (!front || api.getWindowThreadId(front) === api.currentThreadId() || TASKBAR_CLASSES.has(api.getClassName(front))) {
        return null;
    }
    return front;
}

// Puts the window at the top of the always-on-top windows without giving it focus.
export function raiseOnTop(window: BrowserWindow): void {
    const api = load();
    if (api && !window.isDestroyed()) {
        api.setWindowPos(handleOf(window), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    }
}

export function bringToFront(window: BrowserWindow): void {
    const api = load();
    if (api) {
        activate(api, handleOf(window));
    }
}

export function returnTo(handle: number | null): void {
    if (process.platform === 'darwin') {
        returnToApp(handle);
        return;
    }
    const api = load();
    if (!api || !handle || !api.isWindow(handle)) {
        return;
    }
    // A fullscreen game often minimizes itself when it loses focus, and SetForegroundWindow does not restore a minimized window.
    // ShowWindowAsync does not wait for the game, which can be too busy to answer.
    if (api.isIconic(handle)) {
        api.showWindowAsync(handle, SW_RESTORE);
    }
    activate(api, handle);
}
