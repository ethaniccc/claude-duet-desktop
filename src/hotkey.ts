import { systemPreferences } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';

const DOUBLE_TAP_MS = 400;
const TRUST_CHECK_MS = 1000;
const MAC = process.platform === 'darwin';
// On macOS the tap key is Command, which sits next to the space bar where Alt sits on other keyboards.
const TAP_KEYS = new Set<number>(MAC ? [UiohookKey.Meta, UiohookKey.MetaRight] : [UiohookKey.Alt, UiohookKey.AltRight]);

function startHook(): void {
    try {
        uIOhook.start();
    } catch (error) {
        console.error('Could not start the keyboard hook, so a double tap does not open the chat', error);
    }
}

// On macOS the hook cannot start until the user allows the app under Accessibility, so it starts as soon as they do, without a restart.
function startHookWhenTrusted(): void {
    if (!MAC || systemPreferences.isTrustedAccessibilityClient(true)) {
        startHook();
        return;
    }
    const timer = setInterval(() => {
        if (systemPreferences.isTrustedAccessibilityClient(false)) {
            clearInterval(timer);
            startHook();
        }
    }, TRUST_CHECK_MS);
}

// Electron's global shortcuts cannot use a modifier key on its own, so this listens through a system keyboard hook and only keeps the timing of the tap key, Alt or Command on macOS.
// A tap is a short press with no other key or mouse button while it is held, and any other key or click between two taps cancels the pair, so Alt+Tab, Command+Tab and a click while the key is held never count.
export function onDoubleTap(callback: () => void): void {
    let heldKey: number | null = null;
    let pressedAt = 0;
    let usedWithOtherKey = false;
    let otherKeyDown = false;
    let lastTapAt = 0;

    const cancel = () => {
        usedWithOtherKey ||= heldKey !== null;
        lastTapAt = 0;
    };

    uIOhook.on('mousedown', cancel);

    uIOhook.on('keydown', ({ keycode, ctrlKey, shiftKey, altKey }) => {
        // F24 is the key the app presses itself to move the focus, so it does not cancel a tap.
        if (keycode === UiohookKey.F24) {
            return;
        }
        if (!TAP_KEYS.has(keycode)) {
            otherKeyDown = true;
            cancel();
            return;
        }
        // A held key repeats only while it is the last key pressed, so a tap key press after another key is a new press whose release the hook missed.
        if (heldKey === null || otherKeyDown) {
            heldKey = keycode;
            pressedAt = Date.now();
            usedWithOtherKey = ctrlKey || shiftKey || (MAC && altKey);
            otherKeyDown = false;
        } else if (keycode !== heldKey) {
            usedWithOtherKey = true;
        }
    });

    uIOhook.on('keyup', ({ keycode }) => {
        if (!TAP_KEYS.has(keycode) || heldKey === null) {
            return;
        }
        heldKey = null;
        const now = Date.now();
        if (usedWithOtherKey || now - pressedAt > DOUBLE_TAP_MS) {
            lastTapAt = 0;
        } else if (now - lastTapAt <= DOUBLE_TAP_MS) {
            lastTapAt = 0;
            callback();
        } else {
            lastTapAt = now;
        }
    });

    startHookWhenTrusted();
}

export function stopHotkey(): void {
    uIOhook.stop();
}
