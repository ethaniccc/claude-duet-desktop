import { ipcMain, net, protocol, session, type WebContents } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Made by scripts/apple-emoji.py from the user's own copy of Apple Color Emoji, which Apple's licence keeps out of the repo.
const FONT_FILE = path.join(__dirname, '..', 'fonts', 'apple-emoji.ttf');
const SCHEME = 'duet-emoji';
const FONT_URL = `${SCHEME}://font/apple-emoji.ttf`;
const PAGE_ORIGIN = 'https://claude.ai';
// ASCII is left out, so the font never draws a digit, # or *.
const EMOJI_RANGE = 'U+A9, U+AE, U+200D, U+203C, U+2049, U+20E3, U+2122, U+2139, U+2194-21AA, U+231A-2328, U+23CF-23FA, U+24C2, U+25AA-25FE, U+2600-27BF, U+2934-2935, U+2B05-2B55, U+3030, U+303D, U+3297, U+3299, U+FE0F, U+1F000-1FAFF, U+E0020-E007F';
// Several rules that start loading the font at the same time each load their own copy, so the font is loaded once before the first rules go in.
const LOAD_FONT = `new FontFace('duet-emoji', 'url("${FONT_URL}")').load().then(() => true, () => false)`;
const MAX_FACES = 200;
const DESCRIPTOR = /^[\w\s.%-]{1,40}$/;

type Face = { family: string; weight: string; style: string; stretch: string };

function isFace(value: unknown): value is Face {
    const face = value as Face;
    return typeof face?.family === 'string' && face.family.length <= 100 && [face.weight, face.style, face.stretch].every((descriptor) => typeof descriptor === 'string' && DESCRIPTOR.test(descriptor));
}

// The copy takes the weight, style and stretch of the font it joins, because the browser picks a face by those before it looks at the characters.
function fontFaceRule(face: Face): string {
    const family = face.family.replace(/^["']|["']$/g, '').replace(/[^\p{L}\p{N} _-]/gu, (character) => `\\${character.codePointAt(0)!.toString(16)} `);
    return `@font-face { font-family: "${family}"; src: url("${FONT_URL}"); unicode-range: ${EMOJI_RANGE}; font-weight: ${face.weight}; font-style: ${face.style}; font-stretch: ${face.stretch}; }`;
}

// Must run before the app is ready. The scheme skips claude.ai's Content Security Policy, which allows fonts only from claude.ai.
export function registerEmojiScheme(): void {
    protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, corsEnabled: true, bypassCSP: true } }]);
}

// claude.ai's font lists name no emoji font, so the Apple font is added under the name of each font the page has, limited to emoji, and gives the characters that font does not have.
export function useAppleEmoji(contents: WebContents): void {
    if (!existsSync(FONT_FILE)) {
        return;
    }
    if (!session.defaultSession.protocol.isProtocolHandled(SCHEME)) {
        session.defaultSession.protocol.handle(SCHEME, async (request) => {
            if (request.url !== FONT_URL || request.headers.get('origin') !== PAGE_ORIGIN) {
                return new Response(null, { status: 404 });
            }
            const font = await net.fetch(pathToFileURL(FONT_FILE).href);
            return new Response(font.body, { headers: { 'content-type': 'font/ttf', 'access-control-allow-origin': PAGE_ORIGIN } });
        });
    }

    let added = new Set<string>();
    let fontLoaded: Promise<boolean> | null = null;
    contents.on('did-navigate', () => {
        added = new Set();
        fontLoaded = null;
    });
    const addFaces = (event: Electron.IpcMainEvent, faces: unknown) => {
        if (event.sender !== contents || !Array.isArray(faces)) {
            return;
        }
        // webContents.executeJavaScript waits until the whole page has loaded, and the frame's does not.
        fontLoaded ??= contents.mainFrame.executeJavaScript(LOAD_FONT).then((loaded) => loaded === true, () => false);
        const loading = fontLoaded;
        void loading.then((loaded) => {
            // A navigation while the font loaded means these faces belong to the page before.
            if (!loaded || loading !== fontLoaded) {
                return;
            }
            const rules = [...new Set(faces.slice(0, MAX_FACES).filter(isFace).map(fontFaceRule))].filter((rule) => !added.has(rule)).slice(0, MAX_FACES - added.size);
            if (rules.length > 0) {
                rules.forEach((rule) => added.add(rule));
                void contents.insertCSS(rules.join('\n'));
            }
        });
    };
    ipcMain.on('emoji:faces', addFaces);
    contents.once('destroyed', () => ipcMain.removeListener('emoji:faces', addFaces));
}
