import { app, BrowserWindow, ipcMain, screen, type Point, type Rectangle, type WebContents } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { bringToFront, foregroundWindow, returnTo } from './foreground';

const ORB_SIZE = 72;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 640;
const PANEL_GAP = 8;
const PANEL_RADIUS = 16;
// Windows 10 does not round the corners of frameless windows, so the page is clipped to rounded corners inside a transparent window.
// claude.ai puts its background on body, which the browser would paint over the whole window, so html gets an invisible background of its own and body is clipped instead.
// The page's own scrollbar is hidden because it would draw square edges outside the rounded corners.
const ROUNDED_PAGE_CSS = `html { background-color: rgba(0, 0, 0, 0.004) !important; scrollbar-width: none !important; } body { clip-path: inset(0 round ${PANEL_RADIUS}px) !important; }`;
const DRAG_FRAME_MS = 16;
const BLUR_SETTLE_MS = 100;
const ORB_RELOAD_DELAY_MS = 5000;
const WAKE_MS = 250;
const SHRINK_MS = 160;
// Several Duet messages close together play one sound.
const SOUND_GAP_MS = 3000;
const SOUND_FILES = ['message.mp3', 'message.wav', 'message.ogg'];
// The window hides a frame after the shrink ends, so the shrink's last frame is not cut off.
const SHRINK_HIDE_MS = SHRINK_MS + 30;

let orb: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
let panelOpen = false;
let hideTimer: NodeJS.Timeout | undefined;
let previousWindow: number | null = null;
let lastSoundAt = 0;
let mascotFrame: unknown = null;
let panelUrl = '';
let setUpPanel: (contents: WebContents) => void = () => {};
let quitting = false;
let dragTimer: NodeJS.Timeout | undefined;

const positionFile = () => path.join(app.getPath('userData'), 'buddy.json');

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function orbBoundsAt(x: number, y: number): Rectangle {
    return { x: Math.round(x), y: Math.round(y), width: ORB_SIZE, height: ORB_SIZE };
}

function keepOnScreen(bounds: Rectangle): Rectangle {
    const area = screen.getDisplayMatching(bounds).workArea;
    return orbBoundsAt(clamp(bounds.x, area.x, area.x + area.width - ORB_SIZE), clamp(bounds.y, area.y, area.y + area.height - ORB_SIZE));
}

function startingOrbBounds(): Rectangle {
    try {
        const { x, y } = JSON.parse(readFileSync(positionFile(), 'utf8'));
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return keepOnScreen(orbBoundsAt(x, y));
        }
    } catch {
        // No saved position yet, or the file is unreadable: use the default.
    }
    const area = screen.getPrimaryDisplay().workArea;
    return orbBoundsAt(area.x + area.width - ORB_SIZE - 24, area.y + area.height - ORB_SIZE - 24);
}

function saveOrbPosition(bounds: Rectangle): void {
    try {
        writeFileSync(positionFile(), JSON.stringify({ x: bounds.x, y: bounds.y }));
    } catch (error) {
        console.error('Could not save the orb position', error);
    }
}

// The panel opens below the orb, above it when there is no room below, and beside it when neither fits, so it does not cover the orb.
function panelBounds(orbBounds: Rectangle): Rectangle {
    const area = screen.getDisplayMatching(orbBounds).workArea;
    const height = Math.min(PANEL_HEIGHT, area.height);
    const below = orbBounds.y + orbBounds.height + PANEL_GAP;
    const above = orbBounds.y - PANEL_GAP - height;
    let x = orbBounds.x + orbBounds.width / 2 - PANEL_WIDTH / 2;
    let y: number;
    if (below + height <= area.y + area.height) {
        y = below;
    } else if (above >= area.y) {
        y = above;
    } else {
        const right = orbBounds.x + orbBounds.width + PANEL_GAP;
        x = right + PANEL_WIDTH <= area.x + area.width ? right : orbBounds.x - PANEL_GAP - PANEL_WIDTH;
        y = orbBounds.y + orbBounds.height / 2 - height / 2;
    }
    return {
        x: Math.round(clamp(x, area.x, area.x + area.width - PANEL_WIDTH)),
        y: Math.round(clamp(y, area.y, area.y + area.height - height)),
        width: PANEL_WIDTH,
        height,
    };
}

function createOrb(): BrowserWindow {
    const window = new BrowserWindow({
        ...startingOrbBounds(),
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        hasShadow: false,
        webPreferences: { preload: path.join(__dirname, 'orb-preload.js') },
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
        if (dragTimer) {
            endDrag();
        }
        setTimeout(() => window.isDestroyed() || window.reload(), ORB_RELOAD_DELAY_MS);
    });
    // The panel sends a frame only when the mascot changes, so a reloaded orb gets the last one.
    window.webContents.on('did-finish-load', () => window.webContents.send('mascot:frame', mascotFrame));
    keepOnTop(window);
    void window.loadFile(path.join(__dirname, '..', 'static', 'orb.html'));
    window.once('ready-to-show', () => window.showInactive());
    return window;
}

function createPanel(): BrowserWindow {
    const window = new BrowserWindow({
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        title: 'Claude Duet',
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: true,
        backgroundColor: '#00000000',
        // The orb shows the mascot that this page draws, so the page must keep drawing while the panel is hidden.
        webPreferences: { preload: path.join(__dirname, 'panel-preload.js'), backgroundThrottling: false },
    });
    keepOnTop(window);
    window.webContents.on('dom-ready', () => void window.webContents.insertCSS(ROUNDED_PAGE_CSS));
    window.webContents.on('did-finish-load', () => {
        if (!panelOpen) {
            window.webContents.send('panel:closed', null, 0);
        }
        wakeClosedPanel(window);
    });
    window.webContents.on('render-process-gone', showLogoOnOrb);

    window.on('close', (event) => {
        if (!quitting) {
            event.preventDefault();
            hidePanel();
        }
    });

    // A page script can close the window without a close event, so the next show builds a new panel.
    window.on('closed', () => {
        if (panel === window) {
            panel = null;
            panelOpen = false;
            showLogoOnOrb();
        }
    });

    setUpPanel(window.webContents);
    void window.loadURL(panelUrl);
    return window;
}

function sendToOrb(frame: unknown): void {
    if (orb && !orb.isDestroyed()) {
        orb.webContents.send('mascot:frame', frame);
    }
}

function showLogoOnOrb(): void {
    mascotFrame = null;
    sendToOrb(null);
}

function offScreenBounds(): Rectangle {
    const displays = screen.getAllDisplays();
    const left = Math.min(...displays.map(({ bounds }) => bounds.x));
    const top = Math.min(...displays.map(({ bounds }) => bounds.y));
    return { x: left - PANEL_WIDTH - 100, y: top, width: PANEL_WIDTH, height: PANEL_HEIGHT };
}

// claude.ai draws nothing in a hidden window until the window has been shown since its page loaded, so a page that loads while the panel is closed is shown off every display for a moment.
// Only on Windows: Wayland ignores the position and could flash the panel on screen, and macOS may not count an off-screen window as shown.
function wakeClosedPanel(window: BrowserWindow): void {
    if (panelOpen || process.platform !== 'win32') {
        return;
    }
    clearTimeout(hideTimer);
    window.setBounds(offScreenBounds());
    window.showInactive();
    setTimeout(() => {
        if (!panelOpen && !window.isDestroyed()) {
            window.hide();
        }
    }, WAKE_MS);
}

// Electron puts an always-on-top window of the default level just behind the taskbar, so it falls out of the topmost band whenever the taskbar itself is not topmost; it does not do this for the 'screen-saver' level.
function keepOnTop(window: BrowserWindow): void {
    if (process.platform === 'win32') {
        window.setAlwaysOnTop(true, 'screen-saver');
    }
}

function descendants(window: BrowserWindow): BrowserWindow[] {
    return window.getChildWindows().flatMap((child) => [child, ...descendants(child)]);
}

// Popups belong to the always-on-top panel or to another popup, so they would stay on top of every app if they did not hide with it.
function hidePanel(): void {
    if (!panelOpen || !panel) {
        return;
    }
    panelOpen = false;
    for (const child of descendants(panel)) {
        child.hide();
    }
    const window = panel;
    window.webContents.send('panel:closed', orbOrigin(window.getBounds()), SHRINK_MS);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (!panelOpen && !window.isDestroyed()) {
            // Focus goes back to the window the user came from only when the app still has it, not when the user already clicked somewhere else.
            const giveFocusTo = BrowserWindow.getFocusedWindow() ? previousWindow : null;
            previousWindow = null;
            window.hide();
            returnTo(giveFocusTo);
        }
    }, SHRINK_HIDE_MS);
}

// The orb's centre in the panel page's coordinates.
function orbOrigin(panelArea: Rectangle): Point | null {
    if (!orb || orb.isDestroyed()) {
        return null;
    }
    const orbBounds = orb.getBounds();
    return { x: orbBounds.x + orbBounds.width / 2 - panelArea.x, y: orbBounds.y + orbBounds.height / 2 - panelArea.y };
}

function showPanel(): void {
    if (!orb) {
        return;
    }
    clearTimeout(hideTimer);
    panel ??= createPanel();
    const opening = !panelOpen;
    if (opening) {
        // When the chat reopens during the shrink, the chat itself is in front, so the window it was first opened from is kept.
        previousWindow = foregroundWindow() ?? previousWindow;
    }
    panelOpen = true;
    const bounds = panelBounds(orb.getBounds());
    panel.setBounds(bounds);
    panel.show();
    bringToFront(panel);
    if (opening) {
        panel.webContents.send('panel:open', orbOrigin(bounds));
    }
    for (const child of descendants(panel)) {
        child.showInactive();
    }
    panel.focus();
}

function togglePanel(): void {
    if (panelOpen) {
        hidePanel();
    } else {
        showPanel();
    }
}

function stopDrag(): void {
    clearInterval(dragTimer);
    dragTimer = undefined;
}

function startDrag(): void {
    if (!orb) {
        return;
    }
    stopDrag();
    const cursor = screen.getCursorScreenPoint();
    const start = orb.getBounds();
    const offset = { x: cursor.x - start.x, y: cursor.y - start.y };
    let last: Point = cursor;
    dragTimer = setInterval(() => {
        if (!orb?.isVisible()) {
            stopDrag();
            return;
        }
        const point = screen.getCursorScreenPoint();
        if (point.x === last.x && point.y === last.y) {
            return;
        }
        last = point;
        // setPosition grows the window a little on each call on a scaled display, so give the size every time.
        orb.setBounds(orbBoundsAt(point.x - offset.x, point.y - offset.y));
        if (panel && panelOpen) {
            panel.setBounds(panelBounds(orb.getBounds()));
        }
    }, DRAG_FRAME_MS);
}

function endDrag(): void {
    if (!orb) {
        return;
    }
    stopDrag();
    const bounds = keepOnScreen(orb.getBounds());
    orb.setBounds(bounds);
    if (panel && panelOpen) {
        panel.setBounds(panelBounds(bounds));
    }
    saveOrbPosition(bounds);
}

function listenToOrb(): void {
    const handlers: Record<string, () => void> = {
        'orb:click': togglePanel,
        'orb:drag-start': startDrag,
        'orb:drag-end': endDrag,
    };
    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.on(channel, (event) => {
            if (orb && event.sender === orb.webContents) {
                handler();
            }
        });
    }

    // The sound plays only when the user is not looking at the chat.
    ipcMain.on('duet:new-message', (event) => {
        const looking = panelOpen && BrowserWindow.getFocusedWindow() !== null;
        if (!isPanel(event.sender) || looking || Date.now() - lastSoundAt < SOUND_GAP_MS) {
            return;
        }
        const sound = SOUND_FILES.map((name) => path.join(__dirname, '..', 'sounds', name)).find((file) => existsSync(file));
        if (sound && orb && !orb.isDestroyed()) {
            lastSoundAt = Date.now();
            orb.webContents.send('sound:play', pathToFileURL(sound).href);
        }
    });

    ipcMain.on('mascot:frame', (event, frame) => {
        if (isPanel(event.sender)) {
            mascotFrame = frame;
            sendToOrb(frame);
        }
    });
}

// The panel hides once focus leaves every app window, including popups the panel opened.
function hidePanelWhenAppLosesFocus(): void {
    app.on('browser-window-blur', () => {
        setTimeout(() => {
            if (!BrowserWindow.getFocusedWindow()) {
                hidePanel();
            }
        }, BLUR_SETTLE_MS);
    });
}

export function isPanel(contents: WebContents): boolean {
    return panel !== null && contents === panel.webContents;
}

export function createBuddy(url: string, setUp: (contents: WebContents) => void): void {
    panelUrl = url;
    setUpPanel = setUp;
    listenToOrb();
    hidePanelWhenAppLosesFocus();
    orb = createOrb();
    panel = createPanel();
    app.on('before-quit', () => {
        quitting = true;
        stopDrag();
    });
}

export function showBuddy(): void {
    orb?.showInactive();
    showPanel();
}

export function toggleChat(): void {
    if (panelOpen) {
        hidePanel();
    } else {
        showBuddy();
    }
}

export function toggleOrb(): void {
    if (!orb) {
        return;
    }
    if (orb.isVisible()) {
        stopDrag();
        hidePanel();
        orb.hide();
    } else {
        orb.showInactive();
    }
}
