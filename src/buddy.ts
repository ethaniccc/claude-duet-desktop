import { app, BrowserWindow, ipcMain, screen, type Point, type Rectangle, type WebContents } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { bringToFront, foregroundWindow, raiseOnTop, returnTo } from './foreground';

const ORB_SIZE = 72;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 640;
const MIN_PANEL_WIDTH = 340;
const MIN_PANEL_HEIGHT = 460;
const MAX_PANEL_WIDTH = 540;
const MAX_PANEL_HEIGHT = 880;
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
const RAISE_MS = 2000;
const SHRINK_MS = 160;
// Several Duet messages close together play one sound.
const MESSAGE_SOUND_GAP_MS = 3000;
const MESSAGE_SOUND_FILES = ['message.mp3', 'message.wav', 'message.ogg'];
const OPEN_SOUND = path.join(__dirname, '..', 'assets', 'sounds', 'open.wav');
const CLOSE_SOUND = path.join(__dirname, '..', 'assets', 'sounds', 'close.wav');
// The window hides a frame after the shrink ends, so the shrink's last frame is not cut off.
const SHRINK_HIDE_MS = SHRINK_MS + 30;

let orb: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
let panelOpen = false;
let hideTimer: NodeJS.Timeout | undefined;
let previousWindow: number | null = null;
let lastMessageSoundAt = 0;
let mascotFrame: unknown = null;
let panelUrl = '';
let setUpPanel: (contents: WebContents) => void = () => {};
let quitting = false;
let dragTimer: NodeJS.Timeout | undefined;
let resizeTimer: NodeJS.Timeout | undefined;
let raiseTimer: NodeJS.Timeout | undefined;
let panelSize = { width: PANEL_WIDTH, height: PANEL_HEIGHT };
let sentGrip = '';
let shownPlacement: Placement = 'below';

type Size = { width: number; height: number };
type Placement = 'below' | 'above' | 'right' | 'left';
type Grip = { right: boolean; bottom: boolean };
// unclamped is where the panel would sit before the screen edges and rounding move it.
type PanelLayout = { bounds: Rectangle; grip: Grip; placement: Placement; unclamped: Rectangle };

const positionFile = () => path.join(app.getPath('userData'), 'buddy.json');
const sizeFile = () => path.join(app.getPath('userData'), 'panel.json');

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

function loadPanelSize(): void {
    try {
        const { width, height } = JSON.parse(readFileSync(sizeFile(), 'utf8'));
        if (Number.isFinite(width) && Number.isFinite(height)) {
            panelSize = { width: Math.round(clamp(width, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)), height: Math.round(clamp(height, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT)) };
        }
    } catch {
        // No saved size yet, or the file is unreadable: use the default.
    }
}

function savePanelSize(): void {
    try {
        writeFileSync(sizeFile(), JSON.stringify(panelSize));
    } catch (error) {
        console.error('Could not save the chat size', error);
    }
}

// The panel opens below the orb, above it when there is no room below, and beside it when neither fits, so it does not cover the orb.
function choosePlacement(orbBounds: Rectangle, size: Size, area: Rectangle): Placement {
    if (orbBounds.y + orbBounds.height + PANEL_GAP + size.height <= area.y + area.height) {
        return 'below';
    }
    if (orbBounds.y - PANEL_GAP - size.height >= area.y) {
        return 'above';
    }
    const right = orbBounds.x + orbBounds.width + PANEL_GAP + size.width <= area.x + area.width;
    if (right || orbBounds.x - PANEL_GAP - size.width >= area.x) {
        return right ? 'right' : 'left';
    }
    return room('right', orbBounds, area).width >= room('left', orbBounds, area).width ? 'right' : 'left';
}

// The largest panel that fits on the given side of the orb.
function room(placement: Placement, orbBounds: Rectangle, area: Rectangle): Size {
    switch (placement) {
        case 'below':
            return { width: area.width, height: area.y + area.height - (orbBounds.y + orbBounds.height + PANEL_GAP) };
        case 'above':
            return { width: area.width, height: orbBounds.y - PANEL_GAP - area.y };
        case 'right':
            return { width: area.x + area.width - (orbBounds.x + orbBounds.width + PANEL_GAP), height: area.height };
        case 'left':
            return { width: orbBounds.x - PANEL_GAP - area.x, height: area.height };
    }
}

function panelLayout(orbBounds: Rectangle, size: Size, area: Rectangle, placement = choosePlacement(orbBounds, size, area)): PanelLayout {
    // On a small screen no side may have room for the saved size, so the panel is cut to the room on its side rather than cover the orb.
    const space = room(placement, orbBounds, area);
    const width = Math.max(1, Math.min(size.width, area.width, space.width));
    const height = Math.max(1, Math.min(size.height, area.height, space.height));
    const orbCentre = { x: orbBounds.x + orbBounds.width / 2, y: orbBounds.y + orbBounds.height / 2 };
    const positions: Record<Placement, Point> = {
        below: { x: orbCentre.x - width / 2, y: orbBounds.y + orbBounds.height + PANEL_GAP },
        above: { x: orbCentre.x - width / 2, y: orbBounds.y - PANEL_GAP - height },
        right: { x: orbBounds.x + orbBounds.width + PANEL_GAP, y: orbCentre.y - height / 2 },
        left: { x: orbBounds.x - PANEL_GAP - width, y: orbCentre.y - height / 2 },
    };
    const bounds = {
        x: Math.round(clamp(positions[placement].x, area.x, area.x + area.width - width)),
        y: Math.round(clamp(positions[placement].y, area.y, area.y + area.height - height)),
        width,
        height,
    };
    // The resize grip sits on the corner away from the orb, on the side that a screen edge does not pin, so the panel can grow there.
    const vertical = placement === 'below' || placement === 'above';
    const grip = vertical
        ? { right: bounds.x + width / 2 >= orbCentre.x, bottom: placement === 'below' }
        : { right: placement === 'right', bottom: bounds.y + height / 2 >= orbCentre.y };
    return { bounds, grip, placement, unclamped: { ...positions[placement], width, height } };
}

function placePanel(placement?: Placement): PanelLayout | null {
    if (!orb || !panel) {
        return null;
    }
    const orbBounds = orb.getBounds();
    const layout = panelLayout(orbBounds, panelSize, screen.getDisplayMatching(orbBounds).workArea, placement);
    panel.setBounds(layout.bounds);
    shownPlacement = layout.placement;
    const grip = JSON.stringify(layout.grip);
    // During a resize the grip stays where the user holds it, even when a screen edge moves the free corner; it is placed again when the resize ends.
    if (grip !== sentGrip && !resizeTimer) {
        sentGrip = grip;
        panel.webContents.send('panel:grip', layout.grip);
    }
    return layout;
}

// The grip in the page is new after a load or hidden after a close, so its corner is sent again.
function placePanelAndGrip(placement?: Placement): PanelLayout | null {
    sentGrip = '';
    return placePanel(placement);
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
    window.once('ready-to-show', () => {
        window.showInactive();
        raiseOnTop(window);
    });
    return window;
}

function createPanel(): BrowserWindow {
    const window = new BrowserWindow({
        ...panelSize,
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
    window.webContents.on('did-navigate', endResize);
    window.webContents.on('did-finish-load', () => {
        if (panelOpen) {
            placePanelAndGrip();
        } else {
            window.webContents.send('panel:closed', null, 0);
        }
        wakeClosedPanel(window);
    });
    window.webContents.on('render-process-gone', () => {
        endResize();
        showLogoOnOrb();
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

function playSound(file: string): void {
    if (orb && !orb.isDestroyed()) {
        orb.webContents.send('sound:play', pathToFileURL(file).href);
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
    return { x: left - panelSize.width - 100, y: top, ...panelSize };
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

// On Windows, Electron puts an always-on-top window of the default level just behind the taskbar, so it falls out of the topmost band whenever the taskbar itself is not topmost; it does not do this for the 'screen-saver' level.
// On macOS the windows show on every desktop and over full-screen apps, such as a game. The app hides its Dock icon at start, so Electron does not switch the process type here, which would hide the windows and the Dock for a moment on each call.
function keepOnTop(window: BrowserWindow): void {
    if (process.platform === 'win32') {
        window.setAlwaysOnTop(true, 'screen-saver');
    } else if (process.platform === 'darwin') {
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
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
    endResize();
    playSound(CLOSE_SOUND);
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
    const bounds = placePanelAndGrip()?.bounds ?? panel.getBounds();
    panel.show();
    raiseOnTop(panel);
    bringToFront(panel);
    if (opening) {
        playSound(OPEN_SOUND);
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
        if (panelOpen) {
            placePanel();
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
    if (panelOpen) {
        placePanel();
    } else if (process.platform === 'darwin') {
        // A drag on the orb makes this app the front app, so the keyboard goes back to the app the user was in.
        returnTo(foregroundWindow());
    }
    saveOrbPosition(bounds);
}

function stopResize(): void {
    clearInterval(resizeTimer);
    resizeTimer = undefined;
}

// The size that puts the grip corner nearest the point the user drags, for each axis in turn, with the panel kept on the side of the orb where the resize started.
// Sizes that put the corner on the same pixel are told apart by where the corner would be before screen edges and rounding, so both ends can be reached and an edge does not snap the panel to the maximum.
function sizeUnderCursor(orbBounds: Rectangle, area: Rectangle, placement: Placement, grip: Grip, target: Point): Size {
    const space = room(placement, orbBounds, area);
    const nearest = (min: number, max: number, current: number, distance: (value: number) => [number, number]): number => {
        let best = max < min ? current : clamp(current, min, max);
        let [bestDistance, bestUnclamped] = distance(best);
        for (let value = min; value <= max; value++) {
            const [valueDistance, valueUnclamped] = distance(value);
            if (valueDistance < bestDistance || (valueDistance === bestDistance && valueUnclamped < bestUnclamped)) {
                best = value;
                bestDistance = valueDistance;
                bestUnclamped = valueUnclamped;
            }
        }
        return best;
    };
    const corner = (bounds: Rectangle) => ({ x: grip.right ? bounds.x + bounds.width : bounds.x, y: grip.bottom ? bounds.y + bounds.height : bounds.y });
    const gripAt = (size: Size) => {
        const { bounds, unclamped } = panelLayout(orbBounds, size, area, placement);
        return { shown: corner(bounds), unclamped: corner(unclamped) };
    };
    const maxWidth = Math.min(MAX_PANEL_WIDTH, space.width);
    const maxHeight = Math.min(MAX_PANEL_HEIGHT, space.height);
    const width = nearest(MIN_PANEL_WIDTH, maxWidth, panelSize.width, (value) => {
        const { shown, unclamped } = gripAt({ width: value, height: panelSize.height });
        return [Math.abs(shown.x - target.x), Math.abs(unclamped.x - target.x)];
    });
    const height = nearest(MIN_PANEL_HEIGHT, maxHeight, panelSize.height, (value) => {
        const { shown, unclamped } = gripAt({ width, height: value });
        return [Math.abs(shown.y - target.y), Math.abs(unclamped.y - target.y)];
    });
    return { width, height };
}

// Windows cannot resize a transparent window from its edges, so the page has its own grip, and the app follows the cursor while the grip is dragged.
function startResize(): void {
    if (!orb || !panelOpen) {
        return;
    }
    stopResize();
    const orbBounds = orb.getBounds();
    const area = screen.getDisplayMatching(orbBounds).workArea;
    const { bounds, placement, grip } = panelLayout(orbBounds, panelSize, area, shownPlacement);
    // The user holds the grip a few pixels inside the panel's corner, so the corner keeps that offset from the cursor.
    const start = screen.getCursorScreenPoint();
    const offset = { x: start.x - (grip.right ? bounds.x + bounds.width : bounds.x), y: start.y - (grip.bottom ? bounds.y + bounds.height : bounds.y) };
    let last = start;
    resizeTimer = setInterval(() => {
        if (!orb || !panelOpen) {
            endResize();
            return;
        }
        const point = screen.getCursorScreenPoint();
        if (point.x === last.x && point.y === last.y) {
            return;
        }
        last = point;
        panelSize = sizeUnderCursor(orbBounds, area, placement, grip, { x: point.x - offset.x, y: point.y - offset.y });
        placePanel(placement);
    }, DRAG_FRAME_MS);
}

function endResize(): void {
    if (resizeTimer) {
        stopResize();
        savePanelSize();
        if (panelOpen) {
            placePanelAndGrip(shownPlacement);
        }
    }
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

    // The message sound plays only when the user is not looking at the chat.
    ipcMain.on('duet:new-message', (event) => {
        const looking = panelOpen && BrowserWindow.getFocusedWindow() !== null;
        if (!isPanel(event.sender) || looking || Date.now() - lastMessageSoundAt < MESSAGE_SOUND_GAP_MS) {
            return;
        }
        const sound = MESSAGE_SOUND_FILES.map((name) => path.join(__dirname, '..', 'sounds', name)).find((file) => existsSync(file));
        if (sound) {
            lastMessageSoundAt = Date.now();
            playSound(sound);
        }
    });

    ipcMain.on('panel:resize-start', (event) => {
        if (isPanel(event.sender)) {
            startResize();
        }
    });
    ipcMain.on('panel:resize-end', (event) => {
        if (isPanel(event.sender)) {
            endResize();
        }
    });

    ipcMain.on('mascot:frame', (event, frame) => {
        if (isPanel(event.sender)) {
            mascotFrame = frame;
            sendToOrb(frame);
        }
    });
}

// Windows has left the orb marked always-on-top but stacked below normal windows even at the 'screen-saver' level, and other apps' always-on-top windows can cover it, so the visible orb and the open panel are put back on top on a timer.
function keepRaised(): void {
    raiseTimer = setInterval(() => {
        if (orb && !orb.isDestroyed() && orb.isVisible()) {
            raiseOnTop(orb);
        }
        if (panel && !panel.isDestroyed() && panelOpen) {
            raiseOnTop(panel);
        }
    }, RAISE_MS);
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
    loadPanelSize();
    listenToOrb();
    hidePanelWhenAppLosesFocus();
    keepRaised();
    orb = createOrb();
    panel = createPanel();
    app.on('before-quit', () => {
        quitting = true;
        stopDrag();
        endResize();
        clearInterval(raiseTimer);
    });
}

export function showBuddy(): void {
    if (orb) {
        orb.showInactive();
        raiseOnTop(orb);
    }
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
        raiseOnTop(orb);
    }
}
