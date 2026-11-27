let lastOtherApp: number | null = null;
let activateApp: ((pid: number) => void) | null = null;

// A click or drag on the orb makes this app the front app on macOS, so the app the user came from is the last other app that came to the front.
// Electron cannot tell which app is in front or bring a given app to the front, so this calls AppKit through the Objective-C runtime.
export function trackFrontApp(): void {
    if (process.platform !== 'darwin' || activateApp) {
        return;
    }
    try {
        const koffi = require('koffi');
        const objc = koffi.load('/usr/lib/libobjc.A.dylib');
        const getClass = objc.func('void *objc_getClass(const char *name)');
        const selector = objc.func('void *sel_registerName(const char *name)');
        const allocateClass = objc.func('void *objc_allocateClassPair(void *superclass, const char *name, size_t extraBytes)');
        const registerClass = objc.func('void objc_registerClassPair(void *cls)');
        const Handler = koffi.proto('void ActivationHandler(void *self, void *cmd, void *notification)');
        const addMethod = objc.func('bool class_addMethod(void *cls, void *name, ActivationHandler *imp, const char *types)');
        // objc_msgSend must be declared with the exact argument types of each method it calls.
        const send = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
        const sendGetInt = objc.func('objc_msgSend', 'int', ['void *', 'void *']);
        const sendWithPointer = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
        const sendWithString = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']);
        const sendWithInt = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'int']);
        const sendWithLong = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'uint64_t']);
        const addObserver = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *', 'void *', 'void *', 'void *']);

        const nsString = (text: string) => sendWithString(getClass('NSString'), selector('stringWithUTF8String:'), text);
        const remember = (app: unknown) => {
            const pid = app ? sendGetInt(app, selector('processIdentifier')) : process.pid;
            if (pid !== process.pid) {
                lastOtherApp = pid;
            }
        };
        const workspace = send(getClass('NSWorkspace'), selector('sharedWorkspace'));
        remember(send(workspace, selector('frontmostApplication')));

        const onActivation = koffi.register((_self: unknown, _cmd: unknown, notification: unknown) => {
            remember(sendWithPointer(send(notification, selector('userInfo')), selector('objectForKey:'), nsString('NSWorkspaceApplicationKey')));
        }, koffi.pointer(Handler));
        const observerClass = allocateClass(getClass('NSObject'), 'DuetActivationObserver', 0);
        if (!observerClass) {
            throw new Error('The class DuetActivationObserver already exists');
        }
        addMethod(observerClass, selector('appActivated:'), onActivation, 'v@:@');
        registerClass(observerClass);
        const observer = send(send(observerClass, selector('alloc')), selector('init'));
        addObserver(send(workspace, selector('notificationCenter')), selector('addObserver:selector:name:object:'), observer, selector('appActivated:'), nsString('NSWorkspaceDidActivateApplicationNotification'), null);

        activateApp = (pid) => {
            const app = sendWithInt(getClass('NSRunningApplication'), selector('runningApplicationWithProcessIdentifier:'), pid);
            if (app) {
                sendWithLong(app, selector('activateWithOptions:'), 0);
            }
        };
    } catch (error) {
        console.error('Could not watch the front app, so the keyboard does not go back to the previous app', error);
    }
}

export function previousApp(): number | null {
    return lastOtherApp;
}

export function returnToApp(pid: number | null): void {
    if (pid) {
        activateApp?.(pid);
    }
}
