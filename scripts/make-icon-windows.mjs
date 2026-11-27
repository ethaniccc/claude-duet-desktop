// Makes assets/icon.ico from assets/icon.svg. Run it with `npx electron scripts/make-icon-windows.mjs`: Electron draws the SVG, because Windows has no tool that does.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const root = path.join(import.meta.dirname, '..');

// Each size is drawn from the SVG itself rather than scaled down from a large picture, so the small sizes stay sharp.
function drawSizes(svg) {
    return `(async () => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,${svg.toString('base64')}';
        await image.decode();
        return ${JSON.stringify(SIZES)}.map((size) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            canvas.getContext('2d').drawImage(image, 0, 0, size, size);
            return canvas.toDataURL('image/png').split(',')[1];
        });
    })()`;
}

// An .ico file is a list of sizes followed by one PNG for each size. A size of 256 is written as 0.
function packIco(pngs) {
    const header = Buffer.alloc(6 + 16 * pngs.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(pngs.length, 4);
    let offset = header.length;
    pngs.forEach(({ size, png }, index) => {
        const entry = 6 + 16 * index;
        header.writeUInt8(size % 256, entry);
        header.writeUInt8(size % 256, entry + 1);
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(png.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += png.length;
    });
    return Buffer.concat([header, ...pngs.map(({ png }) => png)]);
}

app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false });
    await window.loadURL('about:blank');
    const svg = readFileSync(path.join(root, 'assets', 'icon.svg'));
    const pngs = await window.webContents.executeJavaScript(drawSizes(svg));
    writeFileSync(path.join(root, 'assets', 'icon.ico'), packIco(pngs.map((png, index) => ({ size: SIZES[index], png: Buffer.from(png, 'base64') }))));
    console.log('Wrote assets/icon.ico');
    app.quit();
}).catch((error) => {
    console.error(error);
    app.exit(1);
});
