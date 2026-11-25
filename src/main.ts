import { app, BrowserWindow, session, shell, type WindowOpenHandlerResponse } from 'electron';

const DUET_URL = 'https://claude.ai/duet';
const APP_HOST = 'claude.ai';

// Sign-in providers that claude.ai sends you to, which must stay inside the app so the login cookie lands in its session. Google is not here because it refuses to sign in embedded browsers.
const AUTH_HOSTS = new Set(['appleid.apple.com']);

const GRANTED_PERMISSIONS = new Set(['notifications', 'media', 'clipboard-sanitized-write']);
const BROWSER_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const RETRY_DELAY_MS = 5000;

let mainWindow: BrowserWindow | null = null;

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

function routeWindowOpen({ url }: { url: string }): WindowOpenHandlerResponse {
    if (staysInApp(url)) {
        return { action: 'allow' };
    }
    openInBrowser(url);
    return { action: 'deny' };
}

function isAllowedPermission(permission: string, origin: string, mediaTypes: string[]): boolean {
    const audioOnly = permission !== 'media' || (mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'));
    return hostOf(origin) === APP_HOST && GRANTED_PERMISSIONS.has(permission) && audioOnly;
}

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Claude Duet',
        autoHideMenuBar: true,
    });

    let retryTimer: NodeJS.Timeout | undefined;
    mainWindow.webContents.on('did-start-navigation', (event) => {
        if (event.isMainFrame && !event.isSameDocument) {
            clearTimeout(retryTimer);
        }
    });
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
        const ERR_ABORTED = -3;
        if (isMainFrame && errorCode !== ERR_ABORTED) {
            retryTimer = setTimeout(() => mainWindow?.loadURL(staysInApp(url) ? url : DUET_URL), RETRY_DELAY_MS);
        }
    });

    mainWindow.on('closed', () => {
        clearTimeout(retryTimer);
        mainWindow = null;
    });

    void mainWindow.loadURL(DUET_URL);
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
    contents.setWindowOpenHandler(routeWindowOpen);

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
            if (contents.getURL() === '' && contents !== mainWindow?.webContents) {
                contents.close();
            }
        }
    });
});

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) {
            createWindow();
            return;
        }
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    });

    app.whenReady().then(() => {
        restrictSession();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
