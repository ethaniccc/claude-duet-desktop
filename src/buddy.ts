import { app, BrowserWindow, ipcMain, screen, type Point, type Rectangle, type WebContents } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ORB_SIZE = 72;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 640;
const PANEL_GAP = 8;
const DRAG_FRAME_MS = 16;
const BLUR_SETTLE_MS = 100;
const ORB_RELOAD_DELAY_MS = 5000;

let orb: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
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
    });

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
        }
    });

    setUpPanel(window.webContents);
    void window.loadURL(panelUrl);
    return window;
}

function descendants(window: BrowserWindow): BrowserWindow[] {
    return window.getChildWindows().flatMap((child) => [child, ...descendants(child)]);
}

// Popups belong to the always-on-top panel or to another popup, so they would stay on top of every app if they did not hide with it.
function hidePanel(): void {
    if (!panel) {
        return;
    }
    for (const child of descendants(panel)) {
        child.hide();
    }
    panel.hide();
}

function showPanel(): void {
    if (!orb) {
        return;
    }
    panel ??= createPanel();
    panel.setBounds(panelBounds(orb.getBounds()));
    panel.show();
    for (const child of descendants(panel)) {
        child.showInactive();
    }
    panel.focus();
}

function togglePanel(): void {
    if (panel?.isVisible()) {
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
        if (panel?.isVisible()) {
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
    if (panel?.isVisible()) {
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
