// Builds "Claude Duet Desktop.app" into out/ and installs it to /Applications, so it opens from Spotlight. Run it with `npm run install-mac`, which compiles the TypeScript first.
import { execFileSync, spawnSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const NAME = 'Claude Duet Desktop';
const INSTALLED = path.join('/Applications', `${NAME}.app`);

if (process.platform !== 'darwin') {
    console.error('This script builds the macOS app only.');
    process.exit(1);
}
if (spawnSync('pgrep', ['-f', `${INSTALLED}/Contents/MacOS/`]).status === 0) {
    console.error(`Quit ${NAME} first, so the running app is not replaced.`);
    process.exit(1);
}

const { packager } = await import('@electron/packager');
const [built] = await packager({
    dir: '.',
    name: NAME,
    platform: 'darwin',
    arch: process.arch,
    out: 'out',
    overwrite: true,
    icon: 'assets/icon.icns',
    appBundleId: 'io.github.ethaniccc.claude-duet-desktop',
    asar: false,
    // The app has no Dock icon, and this keeps macOS from showing one for a moment at start.
    extendInfo: { LSUIElement: true },
    ignore: [/^\/(src|scripts|sounds|fonts)(\/|$)/, /^\/tsconfig\.json$/],
});
const app = path.join(built, `${NAME}.app`);
// Packaging changes the app's Info.plist and icon, which breaks Electron's signature, so the app is signed again with a local signature.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
// The copy goes next to the old app first, so a failed copy leaves the old app in place.
const staged = `${INSTALLED}.new`;
rmSync(staged, { recursive: true, force: true });
execFileSync('ditto', [app, staged], { stdio: 'inherit' });
rmSync(INSTALLED, { recursive: true, force: true });
renameSync(staged, INSTALLED);
console.log(`Installed ${INSTALLED}`);
