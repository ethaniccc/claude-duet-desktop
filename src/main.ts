import { app, BrowserWindow, Menu, nativeImage, session, shell, Tray, type NativeImage, type WebContents, type WindowOpenHandlerResponse } from 'electron';
import path from 'node:path';
import { createBuddy, isPanel, showBuddy, toggleChat, toggleOrb } from './buddy';
import { registerEmojiScheme, useAppleEmoji } from './emoji';
import { onDoubleAlt, stopHotkey } from './hotkey';

const DUET_URL = 'https://claude.ai/duet';
const APP_HOST = 'claude.ai';

// Sign-in providers that claude.ai sends you to, which must stay inside the app so the login cookie lands in its session. Google is not here because it refuses to sign in embedded browsers.
const AUTH_HOSTS = new Set(['appleid.apple.com']);

const GRANTED_PERMISSIONS = new Set(['notifications', 'media', 'clipboard-sanitized-write']);
const BROWSER_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const RETRY_DELAY_MS = 5000;
const MAX_CRASH_DELAY_MS = 5 * 60 * 1000;

// Kept in a module variable so the tray icon is not garbage collected.
let tray: Tray | null = null;

function hostOf(url: string): string | null {
    if (!URL.canParse(url)) {
        return null;
    }
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname : null;
}

function staysInApp(url: string): boolean {
    const host = hostOf(url);
    return host === APP_HOST || (host !== null && AUTH_HOSTS.has(host));
}

function openInBrowser(url: string): void {
    if (URL.canParse(url) && BROWSER_PROTOCOLS.has(new URL(url).protocol)) {
        void shell.openExternal(url);
    }
}

// A popup is a child of the window that opened it, so it shows above the always-on-top panel.
function routeWindowOpen(opener: WebContents, url: string): WindowOpenHandlerResponse {
    if (staysInApp(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { parent: BrowserWindow.fromWebContents(opener) ?? undefined } };
    }
    openInBrowser(url);
    return { action: 'deny' };
}

function isAllowedPermission(permission: string, origin: string, mediaTypes: string[]): boolean {
    const audioOnly = permission !== 'media' || (mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'));
    return hostOf(origin) === APP_HOST && GRANTED_PERMISSIONS.has(permission) && audioOnly;
}

function retryFailedLoads(contents: WebContents): void {
    let retryTimer: NodeJS.Timeout | undefined;
    contents.on('did-start-navigation', (event) => {
        if (event.isMainFrame && !event.isSameDocument) {
            clearTimeout(retryTimer);
        }
    });
    contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
        const ERR_ABORTED = -3;
        if (isMainFrame && errorCode !== ERR_ABORTED) {
            retryTimer = setTimeout(() => contents.loadURL(staysInApp(url) ? url : DUET_URL), RETRY_DELAY_MS);
        }
    });
    // A page that crashes on every load is reloaded less and less often, and back at the normal delay once it has stayed up for 5 minutes.
    let crashDelay = RETRY_DELAY_MS;
    let reloadedAt = 0;
    contents.on('render-process-gone', () => {
        if (Date.now() - reloadedAt > MAX_CRASH_DELAY_MS) {
            crashDelay = RETRY_DELAY_MS;
        }
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            reloadedAt = Date.now();
            contents.reload();
        }, crashDelay);
        crashDelay = Math.min(crashDelay * 2, MAX_CRASH_DELAY_MS);
    });
    contents.on('destroyed', () => clearTimeout(retryTimer));
}

// Electron reads .ico files only on Windows.
function trayIcon(): NativeImage | string {
    const assets = path.join(__dirname, '..', 'assets');
    if (process.platform === 'win32') {
        return path.join(assets, 'claude.ico');
    }
    return nativeImage.createFromPath(path.join(assets, 'claude.png')).resize({ width: 16, height: 16 });
}

function createTray(): void {
    tray = new Tray(trayIcon());
    tray.setToolTip('Claude Duet');
    tray.on('click', toggleOrb);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Claude Duet', click: showBuddy },
        { label: 'Show or hide the orb', click: toggleOrb },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
    ]));
}

function restrictSession(): void {
    // claude.ai's sign-in page and its captcha treat a user agent that names Electron as an embedded browser, so send the plain Chrome user agent.
    const appToken = ` ${app.getName().replace(/\s/g, '')}/${app.getVersion()}`;
    app.userAgentFallback = app.userAgentFallback.replace(appToken, '').replace(/ Electron\/\S+/, '');

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
        callback(isAllowedPermission(permission, details.requestingUrl, mediaTypes));
    });

    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
        return isAllowedPermission(permission, requestingOrigin, details.mediaType ? [details.mediaType] : []);
    });
}

app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => routeWindowOpen(contents, url));

    contents.on('will-navigate', (event) => {
        if (!staysInApp(event.url)) {
            event.preventDefault();
            openInBrowser(event.url);
        }
    });

    contents.on('will-redirect', (event) => {
        if (event.isMainFrame && !staysInApp(event.url)) {
            event.preventDefault();
            openInBrowser(event.url);
            if (contents.getURL() === '' && !isPanel(contents)) {
                contents.close();
            }
        }
    });
});

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', showBuddy);
    registerEmojiScheme();

    app.whenReady().then(() => {
        restrictSession();
        createBuddy(DUET_URL, (contents) => {
            retryFailedLoads(contents);
            useAppleEmoji(contents);
        });
        createTray();
        onDoubleAlt(toggleChat);
        app.on('will-quit', stopHotkey);
        app.on('activate', showBuddy);
    });
}
