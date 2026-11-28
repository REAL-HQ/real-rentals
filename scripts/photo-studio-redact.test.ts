import { describe, expect, test } from "bun:test";
import { plateBar } from "../src/lib/photo-studio";
import { decodePng, encodePng, redactPlates } from "../src/lib/photo-studio-redact.server";

describe("plate redaction", () => {
  test("the black bar covers the character band and leaves the plate frame", async () => {
    const width = 100;
    const height = 40;
    const rgba = new Uint8Array(width * height * 4);
    const plate = { x: 20, y: 10, w: 60, h: 20 };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const onPlate =
          x >= plate.x && x < plate.x + plate.w && y >= plate.y && y < plate.y + plate.h;
        const i = (y * width + x) * 4;
        rgba[i] = onPlate ? 240 : 30;
        rgba[i + 1] = onPlate ? 210 : 40;
        rgba[i + 2] = onPlate ? 60 : 80;
        rgba[i + 3] = 255;
      }
    }
    const box = {
      x: plate.x / width,
      y: plate.y / height,
      w: plate.w / width,
      h: plate.h / height,
    };
    const painted = await redactPlates(await encodePng({ width, height, rgba }), "image/png", [
      box,
    ]);
    expect(painted.ok).toBe(true);
    if (!painted.ok) return;
    const img = await decodePng(painted.bytes);
    expect(img).not.toBeNull();
    if (!img) return;
    const bar = plateBar(box);
    const onBar = (px: number, py: number) => {
      const fx = (px + 0.5) / width;
      const fy = (py + 0.5) / height;
      return fx >= bar.x && fy >= bar.y && fx < bar.x + bar.w && fy < bar.y + bar.h;
    };
    const centerX = plate.x + Math.floor(plate.w / 2);
    const centerY = plate.y + Math.floor(plate.h / 2);
    expect(onBar(centerX, centerY)).toBe(true);
    const mid = (centerY * width + centerX) * 4;
    expect([img.rgba[mid], img.rgba[mid + 1], img.rgba[mid + 2]]).toEqual([0, 0, 0]);
    const frameX = plate.x + 1;
    expect(onBar(frameX, centerY)).toBe(false);
    const frame = (centerY * width + frameX) * 4;
    expect([img.rgba[frame], img.rgba[frame + 1], img.rgba[frame + 2]]).toEqual([240, 210, 60]);
    expect(painted.bars).toEqual([bar]);
  });
});
