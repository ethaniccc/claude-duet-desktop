import type { BrowserWindow } from 'electron';

const MOVE_TO_ACTIVE_SPACE = 1n << 1n;
const FULL_SCREEN_AUXILIARY = 1n << 8n;

// macOS can keep the chat on one desktop even when it is set to show on all of them, so on macOS it moves to the desktop the user is on each time it opens, also over full-screen apps.
// Electron's panel class adds "show on all desktops" to every collectionBehavior it sets, so this calls NSWindow's own setter through the Objective-C runtime.
// After this, an Electron call that sets collectionBehavior again, such as setAlwaysOnTop or setVisibleOnAllWorkspaces, makes macOS end the app, since a window cannot both join all desktops and move to the active one.
export function moveToActiveDesktop(window: BrowserWindow): void {
    if (process.platform !== 'darwin') {
        return;
    }
    try {
        const koffi = require('koffi');
        const objc = koffi.load('/usr/lib/libobjc.A.dylib');
        const getClass = objc.func('void *objc_getClass(const char *name)');
        const selector = objc.func('void *sel_registerName(const char *name)');
        const ObjcSuper = koffi.struct({ receiver: 'void *', superClass: 'void *' });
        const send = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
        const sendSuperWithUInt64 = objc.func('objc_msgSendSuper', 'void', [koffi.pointer(ObjcSuper), 'void *', 'uint64_t']);
        const view = window.getNativeWindowHandle().readBigUInt64LE(0);
        const nsWindow = send(view, selector('window'));
        sendSuperWithUInt64({ receiver: nsWindow, superClass: getClass('NSWindow') }, selector('setCollectionBehavior:'), MOVE_TO_ACTIVE_SPACE | FULL_SCREEN_AUXILIARY);
    } catch (error) {
        console.error('Could not make the chat move to the current desktop', error);
    }
}
