import { ipcRenderer, webFrame } from 'electron';

const FRAME_MS = 33;
const MASCOT_CANVAS = '[data-character] canvas';
const MAX_MASCOT_SIZE = 256;
const PATCH_MS = 100;

// claude.ai stops the mascot once it is at rest while the page is unfocused, and the panel is unfocused whenever it is closed.
// Faking focus would also tell the rest of the page and the server that the user is there, so this instead finds the mascot's drawing object through React's state on its canvas and makes it report that it is never at rest.
const KEEP_MASCOT_MOVING = `
(() => {
    const patched = new WeakSet();
    setInterval(() => {
        for (const canvas of document.querySelectorAll('${MASCOT_CANVAS}')) {
            try {
                const key = Object.keys(canvas).find((name) => name.startsWith('__reactFiber'));
                for (let fiber = key && canvas[key], depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
                    for (let hook = fiber.memoizedState, index = 0; hook && index < 80; index++, hook = hook.next) {
                        try {
                            const drawing = hook.memoizedState?.current;
                            if (drawing && typeof drawing.isAtRest === 'function' && typeof drawing.nextChangeAtMs === 'function' && !patched.has(drawing)) {
                                drawing.isAtRest = () => false;
                                patched.add(drawing);
                            }
                        } catch {
                            // A hook that throws when read is skipped, so the page never sees an error from this.
                        }
                    }
                }
            } catch {
                // A canvas whose React state cannot be read is skipped the same way.
            }
        }
    }, ${PATCH_MS});
})();
`;

// Reading the page's own canvas would create its context if the page has not created one yet, so frames are copied onto a canvas of our own first.
const copy = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });

// undefined until the first check, so a page without a mascot still sends one null.
let lastFrame: Uint8ClampedArray | null | undefined;
let lastBackground = '';

function sameFrame(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function mascotCanvas(): HTMLCanvasElement | null {
    const canvas = document.querySelector<HTMLCanvasElement>(MASCOT_CANVAS);
    const usable = canvas && canvas.width > 0 && canvas.height > 0 && canvas.width <= MAX_MASCOT_SIZE && canvas.height <= MAX_MASCOT_SIZE;
    return usable ? canvas : null;
}

// The orb takes the page background so it matches claude.ai's light or dark theme.
function pageBackground(): string {
    const body = getComputedStyle(document.body).backgroundColor;
    return body === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : body;
}

function sendNoMascot(): void {
    if (lastFrame !== null) {
        lastFrame = null;
        ipcRenderer.send('mascot:frame', null);
    }
}

function sendMascotFrame(): void {
    const canvas = document.body ? mascotCanvas() : null;
    if (!canvas || !copy) {
        sendNoMascot();
        return;
    }
    copy.canvas.width = canvas.width;
    copy.canvas.height = canvas.height;
    copy.drawImage(canvas, 0, 0);
    const { data } = copy.getImageData(0, 0, canvas.width, canvas.height);
    if (!data.some((value, index) => index % 4 === 3 && value > 0)) {
        sendNoMascot();
        return;
    }
    const background = pageBackground();
    if (lastFrame && sameFrame(lastFrame, data) && background === lastBackground) {
        return;
    }
    lastFrame = data;
    lastBackground = background;
    ipcRenderer.send('mascot:frame', { width: canvas.width, height: canvas.height, data, background });
}

void webFrame.executeJavaScript(KEEP_MASCOT_MOVING);
setInterval(sendMascotFrame, FRAME_MS);
