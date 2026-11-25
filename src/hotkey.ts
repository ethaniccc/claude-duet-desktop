import { uIOhook, UiohookKey } from 'uiohook-napi';

const DOUBLE_TAP_MS = 400;
const ALT_KEYS = new Set<number>([UiohookKey.Alt, UiohookKey.AltRight]);

// Electron's global shortcuts cannot use a modifier key on its own, so this listens through a system keyboard hook and only keeps the timing of Alt presses.
// A tap is a short Alt press with no other key or mouse button while it is held, and any other key or click between two taps cancels the pair, so Alt+Tab and Alt+click never count.
export function onDoubleAlt(callback: () => void): void {
    let heldAlt: number | null = null;
    let pressedAt = 0;
    let usedWithOtherKey = false;
    let otherKeyDown = false;
    let lastTapAt = 0;

    const cancel = () => {
        usedWithOtherKey ||= heldAlt !== null;
        lastTapAt = 0;
    };

    uIOhook.on('mousedown', cancel);

    uIOhook.on('keydown', ({ keycode, ctrlKey, shiftKey }) => {
        // F24 is the key the app presses itself to move the focus, so it does not cancel a tap.
        if (keycode === UiohookKey.F24) {
            return;
        }
        if (!ALT_KEYS.has(keycode)) {
            otherKeyDown = true;
            cancel();
            return;
        }
        // Alt repeats only while it is the last key pressed, so an Alt press after another key is a new press whose release the hook missed.
        if (heldAlt === null || otherKeyDown) {
            heldAlt = keycode;
            pressedAt = Date.now();
            usedWithOtherKey = ctrlKey || shiftKey;
            otherKeyDown = false;
        } else if (keycode !== heldAlt) {
            usedWithOtherKey = true;
        }
    });

    uIOhook.on('keyup', ({ keycode }) => {
        if (!ALT_KEYS.has(keycode) || heldAlt === null) {
            return;
        }
        heldAlt = null;
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

    try {
        uIOhook.start();
    } catch (error) {
        console.error('Could not start the keyboard hook, so double Alt does not open the chat', error);
    }
}

export function stopHotkey(): void {
    uIOhook.stop();
}
