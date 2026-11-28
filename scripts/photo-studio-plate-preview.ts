// Local fixture only. Draws a mocked rear shot, blacks out the plate bar,
// and writes the before/after plus a Photo Studio slot card. No network.
import { mkdirSync, writeFileSync } from "node:fs";
import { plateBar } from "../src/lib/photo-studio";
import { decodePng, encodePng, redactPlates } from "../src/lib/photo-studio-redact.server";

const WIDTH = 640;
const HEIGHT = 480;
const PLATE = { x: 220, y: 292, w: 200, h: 56 };

const GLYPHS: Record<string, string[]> = {
  F: ["11110", "10000", "11100", "10000", "10000", "10000", "10000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
};

function setPixel(rgba: Uint8Array, x: number, y: number, rgb: [number, number, number]) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  rgba[i] = rgb[0];
  rgba[i + 1] = rgb[1];
  rgba[i + 2] = rgb[2];
  rgba[i + 3] = 255;
}

function fill(
  rgba: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: [number, number, number],
) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) setPixel(rgba, px, py, rgb);
  }
}

function drawRear(): Uint8Array {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  fill(rgba, 0, 0, WIDTH, HEIGHT, [198, 204, 210]);
  fill(rgba, 0, 300, WIDTH, HEIGHT - 300, [150, 154, 160]);
  fill(rgba, 70, 150, 500, 210, [32, 48, 72]);
  fill(rgba, 150, 168, 340, 70, [18, 28, 44]);
  fill(rgba, 90, 250, 70, 36, [176, 42, 42]);
  fill(rgba, 480, 250, 70, 36, [176, 42, 42]);
  fill(rgba, PLATE.x - 4, PLATE.y - 4, PLATE.w + 8, PLATE.h + 8, [90, 78, 40]);
  fill(rgba, PLATE.x, PLATE.y, PLATE.w, PLATE.h, [240, 208, 86]);
  const text = "FAKE7";
  const scale = 4;
  const glyphW = 5 * scale;
  const gap = 6;
  const textW = text.length * glyphW + (text.length - 1) * gap;
  let cursor = PLATE.x + Math.floor((PLATE.w - textW) / 2);
  const top = PLATE.y + Math.floor((PLATE.h - 7 * scale) / 2);
  for (const ch of text) {
    const rows = GLYPHS[ch];
    for (let gy = 0; gy < rows.length; gy++) {
      for (let gx = 0; gx < rows[gy].length; gx++) {
        if (rows[gy][gx] !== "1") continue;
        fill(rgba, cursor + gx * scale, top + gy * scale, scale, scale, [20, 20, 20]);
      }
    }
    cursor += glyphW + gap;
  }
  return rgba;
}

const dir = "/opt/cursor/artifacts/photo-studio-plate";
mkdirSync(dir, { recursive: true });
const before = drawRear();
const beforePng = await encodePng({ width: WIDTH, height: HEIGHT, rgba: before });
const box = { x: PLATE.x / WIDTH, y: PLATE.y / HEIGHT, w: PLATE.w / WIDTH, h: PLATE.h / HEIGHT };
const painted = await redactPlates(beforePng, "image/png", [box]);
if (!painted.ok) throw new Error("fixture redact failed");
const after = await decodePng(painted.bytes);
if (!after) throw new Error("fixture decode failed");
const bar = plateBar(box);
const sample = async (png: Uint8Array, px: number, py: number) => {
  const img = (await decodePng(png))!;
  const i = (py * img.width + px) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
};
const midX = PLATE.x + Math.floor(PLATE.w / 2);
const midY = PLATE.y + Math.floor(PLATE.h / 2);
const frameX = PLATE.x + 6;
if ((await sample(painted.bytes, midX, midY)).join(",") !== "0,0,0")
  throw new Error("bar did not cover the characters");
const frame = await sample(painted.bytes, frameX, midY);
if (frame[0] < 200) throw new Error("plate frame was covered");
if ((await sample(beforePng, midX, midY)).join(",") === "0,0,0")
  throw new Error("before image was already black");

writeFileSync(`${dir}/rear-before.png`, beforePng);
writeFileSync(`${dir}/rear-after.png`, painted.bytes);

const page = (title: string, body: string) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { margin: 0; background: #fff; color: #111114; font-family: ui-sans-serif, system-ui, sans-serif; }
    h1 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
    .wrap { padding: 24px; }
  </style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;

writeFileSync(
  `${dir}/before-after.html`,
  page(
    "Rear Shot",
    `
  <h1>Mocked Rear Shot</h1>
  <div style="display:flex; gap:24px; align-items:flex-start;">
    <figure style="margin:0;">
      <img src="rear-before.png" width="640" height="480" alt="Before redaction" style="display:block; border:1px solid #EDEDF0;" />
      <figcaption style="margin-top:8px; font-size:12px; color:#55555E;">Before</figcaption>
    </figure>
    <figure style="margin:0;">
      <img src="rear-after.png" width="640" height="480" alt="After the plate bar" style="display:block; border:1px solid #EDEDF0;" />
      <figcaption style="margin-top:8px; font-size:12px; color:#55555E;">After</figcaption>
    </figure>
  </div>
`,
  ),
);

writeFileSync(
  `${dir}/slot.html`,
  page(
    "Photo Studio Slot",
    `
  <div style="width:220px; border:1px solid #EDEDF0; border-radius:6px; padding:8px; background:#fff;">
    <div style="font-size:10px; font-weight:600; letter-spacing:0.12em; color:#9A9AA3;">Rear 3/4</div>
    <div style="aspect-ratio:4/3; display:grid; place-items:center; border-radius:6px; background:#F4F4F6; padding:0 12px; text-align:center; font-size:11px; font-weight:500; line-height:1.35; color:#111114;">Generated Plate Did Not Match</div>
  </div>
`,
  ),
);

console.log(JSON.stringify({ dir, bar, frame }));
