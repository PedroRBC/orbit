import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

// Procedência: glifo Lucide "Orbit" (ISC, mesmo da barra lateral) nas cores do tema (--ground, --accent).
// Rode `npx tsx scripts/pwa-icons.ts` após mudar a marca; os PNGs gerados são versionados.
const glyph = `<circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M10.4 21.9a10 10 0 0 0 9.941-15.416"/><path d="M13.5 2.1a10 10 0 0 0-9.841 15.416"/>`;
// scale: glifo ocupa ~12,7 unidades de raio a partir do centro; maskable fica dentro do círculo seguro de 40%.
const icon = (size: number, { radius, scale }: { radius: number; scale: number }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="#101521"/><g transform="translate(256 256) scale(${scale}) translate(-12 -12)" fill="none" stroke="#c5b7f7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
const outputs = [
  { file: "public/icons/icon-192.png", size: 192, radius: 112, scale: 14 },
  { file: "public/icons/icon-512.png", size: 512, radius: 112, scale: 14 },
  { file: "public/icons/maskable-512.png", size: 512, radius: 0, scale: 12 },
  { file: "src/app/apple-icon.png", size: 180, radius: 0, scale: 14 },
];
await mkdir("public/icons", { recursive: true });
await writeFile("src/app/icon.svg", icon(64, { radius: 112, scale: 14 }) + "\n");
const browser = await chromium.launch();
try {
  for (const { file, size, ...shape } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${icon(size, shape)}</body></html>`);
    await page.screenshot({ path: file, omitBackground: true });
    await page.close();
  }
} finally { await browser.close(); }
console.log("Ícones do PWA gerados.");
