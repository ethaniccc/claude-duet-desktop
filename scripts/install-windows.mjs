// Builds "Claude Duet Desktop" into out/, installs it for this Windows user, and adds it to the Start menu. Run it with `npm run install-windows`, which compiles the TypeScript first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const NAME = 'Claude Duet Desktop';
const EXE = `${NAME}.exe`;

if (process.platform !== 'win32') {
    console.error('This script builds the Windows app only.');
    process.exit(1);
}
const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', NAME);
const SHORTCUT = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`);

if (execFileSync('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/NH'], { encoding: 'utf8' }).includes(EXE)) {
    console.error(`Quit ${NAME} first, so the running app is not replaced.`);
    process.exit(1);
}

const { packager } = await import('@electron/packager');
const [built] = await packager({
    dir: '.',
    name: NAME,
    platform: 'win32',
    arch: process.arch,
    out: 'out',
    overwrite: true,
    icon: 'assets/icon.ico',
    asar: false,
    win32metadata: { FileDescription: NAME, ProductName: NAME },
    // The app reads only fonts/apple-emoji.ttf, so the Apple Color Emoji.ttc it is made from stays out.
    ignore: [/^\/(src|scripts|sounds)(\/|$)/, /^\/fonts\/(?!apple-emoji\.ttf$)/, /^\/tsconfig\.json$/],
});

// The new copy and the old app trade places by rename, which fails before it changes anything when a file in the old app is in use, so a failure leaves the old app whole.
const staged = `${INSTALLED}.new`;
const old = `${INSTALLED}.old`;
rmSync(staged, { recursive: true, force: true });
rmSync(old, { recursive: true, force: true });
cpSync(built, staged, { recursive: true });
if (existsSync(INSTALLED)) {
    renameSync(INSTALLED, old);
}
renameSync(staged, INSTALLED);
rmSync(old, { recursive: true, force: true });

// The paths go through environment variables, so PowerShell does not read anything in them as code.
const makeShortcut = '$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SHORTCUT); $shortcut.TargetPath = $env:TARGET; $shortcut.WorkingDirectory = $env:FOLDER; $shortcut.Save()';
execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', makeShortcut], {
    env: { ...process.env, SHORTCUT, TARGET: path.join(INSTALLED, EXE), FOLDER: INSTALLED },
    stdio: 'inherit',
});
console.log(`Installed ${INSTALLED}`);
