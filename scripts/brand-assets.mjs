// Generates every logo and icon the app uses from the one transparent source logo.
// Run: npm run brand:assets   (re-run whenever assets/brand/brandchilly-logo-transparent.png changes)
//
//   public/assets/images/brandchilly-logo.webp   full logo for the UI (transparent)
//   public/favicon.ico, favicon-32x32.png        browser tab: the chilli mark (transparent)
//   public/pwa-*.png, maskable-icon-512x512.png  installed app icons: chilli on Ink
//   public/apple-touch-icon-180x180.png          iPhone home screen: chilli on Ink
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { root } from './lib/migrated-db.mjs';

const SRC = join(root, 'assets', 'brand', 'brandchilly-logo-transparent.png');
const PUB = join(root, 'public');
const INK = { r: 10, g: 10, b: 10, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// 1. Full logo for the UI: trimmed, 720px wide (2x the largest display size), transparent WebP.
await sharp(SRC).trim().resize({ width: 720 }).webp({ quality: 92, alphaQuality: 100 }).toFile(join(PUB, 'assets', 'images', 'brandchilly-logo.webp'));

// 2. The chilli mark. It sits above "Brand" (top-left of the artwork); its pixels are strongly
//    coloured while the "Brand" outline is white/grey, so keep only saturated pixels.
const meta = await sharp(SRC).metadata();
const box = {
  left: Math.round(meta.width * 0.17),
  top: Math.round(meta.height * 0.11),
  width: Math.round(meta.width * 0.29),
  height: Math.round(meta.height * 0.46),
};
const { data, info } = await sharp(SRC).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
// Pale (low-colour) or already-transparent pixels are "background". Only background reachable
// from the edge of the crop is removed, so the chilli's own white shine highlights survive.
const { width: W, height: H } = info;
const pale = (p) => {
  const i = p * 4;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  return data[i + 3] < 16 || Math.max(r, g, b) - Math.min(r, g, b) < 45;
};
const seen = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const p = stack.pop();
  if (seen[p] || !pale(p)) continue;
  seen[p] = 1;
  data[p * 4 + 3] = 0;
  const x = p % W;
  if (x > 0) stack.push(p - 1);
  if (x < W - 1) stack.push(p + 1);
  if (p >= W) stack.push(p - W);
  if (p < W * (H - 1)) stack.push(p + W);
}
const chilli = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .trim()
  .png()
  .toBuffer();

// Square icon: the chilli centred on a canvas, `fill` = share of the canvas it occupies.
async function icon(size, { background, fill }) {
  const inner = Math.round(size * fill);
  const mark = await sharp(chilli).resize({ width: inner, height: inner, fit: 'inside' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

writeFileSync(join(PUB, 'favicon-32x32.png'), await icon(32, { background: CLEAR, fill: 1 }));
writeFileSync(join(PUB, 'pwa-64x64.png'), await icon(64, { background: INK, fill: 0.8 }));
writeFileSync(join(PUB, 'pwa-192x192.png'), await icon(192, { background: INK, fill: 0.8 }));
writeFileSync(join(PUB, 'pwa-512x512.png'), await icon(512, { background: INK, fill: 0.8 }));
// Maskable icons get cropped to a circle/squircle: keep the mark inside the 60% safe zone.
writeFileSync(join(PUB, 'maskable-icon-512x512.png'), await icon(512, { background: INK, fill: 0.6 }));
writeFileSync(join(PUB, 'apple-touch-icon-180x180.png'), await icon(180, { background: INK, fill: 0.75 }));

// favicon.ico with 16, 32 and 48 px PNG images inside (ICO allows PNG payloads).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => icon(s, { background: CLEAR, fill: 1 })));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0);
  e.writeUInt8(s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(join(PUB, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));

// Transparent chilli mark for compact UI spots (BrandLogo showWordmark={false}).
await sharp(await icon(128, { background: CLEAR, fill: 1 })).webp({ quality: 92, alphaQuality: 100 }).toFile(join(PUB, 'assets', 'images', 'brandchilly-mark.webp'));

// A large preview to eyeball the chilli cut-out.
writeFileSync(join(root, 'assets', 'brand', 'chilli-mark-preview.png'), await icon(256, { background: CLEAR, fill: 1 }));
console.log('Brand assets written.');
