/**
 * The public gallery route must not send the phone's Exif. GPS lives in the
 * APP1 segment, so a JPEG that contains a GPS IFD has to come back without
 * those bytes, with only the orientation tag left when the photo needs it.
 *
 * Run: node --experimental-strip-types scripts/jpeg-metadata.test.mjs
 */
import assert from "node:assert/strict";
import { stripJpegMetadata } from "../src/lib/jpeg-metadata.ts";

const GPS_NEEDLE = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const XMP_GPS = "exif:GPSLongitude>87.6298W";
const COMMENT_GPS = "shot near 41.8781139,-87.6297998";
const THUMB_GPS = "THUMBGPS";
const MPF_GPS = "EMBEDDED-GPS-41.8781139";

function concat(...parts) {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text) {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function segment(marker, payload) {
  const out = new Uint8Array(4 + payload.length);
  const length = payload.length + 2;
  out[0] = 0xff;
  out[1] = marker;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  out.set(payload, 4);
  return out;
}

function u16(value, little) {
  return little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
}

function u32(value, little) {
  return little
    ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
    : [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Exif APP1 whose IFD0 points at a GPS IFD. The latitude minutes numerator is DE AD BE EF. */
function exifWithGps(little, orientation) {
  const ifd0 = 8;
  const gpsAt = ifd0 + 2 + 2 * 12 + 4;
  const dataAt = gpsAt + 2 + 2 * 12 + 4;
  const tiff = new Uint8Array(dataAt + 24);
  tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  tiff.set(u16(0x002a, little), 2);
  tiff.set(u32(ifd0, little), 4);
  tiff.set(u16(2, little), ifd0);

  let entry = ifd0 + 2;
  tiff.set(u16(0x0112, little), entry);
  tiff.set(u16(3, little), entry + 2);
  tiff.set(u32(1, little), entry + 4);
  tiff.set(u16(orientation, little), entry + 8);

  entry += 12;
  tiff.set(u16(0x8825, little), entry);
  tiff.set(u16(4, little), entry + 2);
  tiff.set(u32(1, little), entry + 4);
  tiff.set(u32(gpsAt, little), entry + 8);

  tiff.set(u16(2, little), gpsAt);
  let gps = gpsAt + 2;
  tiff.set(u16(0x0001, little), gps);
  tiff.set(u16(2, little), gps + 2);
  tiff.set(u32(2, little), gps + 4);
  tiff[gps + 8] = 0x4e; // N
  gps += 12;
  tiff.set(u16(0x0002, little), gps);
  tiff.set(u16(5, little), gps + 2);
  tiff.set(u32(3, little), gps + 4);
  tiff.set(u32(dataAt, little), gps + 8);

  tiff.set(u32(41, little), dataAt);
  tiff.set(u32(1, little), dataAt + 4);
  tiff.set(GPS_NEEDLE, dataAt + 8);
  tiff.set(u32(100, little), dataAt + 12);
  tiff.set(u32(1, little), dataAt + 20);

  return segment(0xe1, concat(ascii("Exif\0\0"), tiff));
}

function phoneJpeg({ little = true, orientation = 6, xmpOrientation = null } = {}) {
  const jfif = new Uint8Array(14 + THUMB_GPS.length);
  jfif.set(ascii("JFIF\0"), 0);
  jfif[5] = 1;
  jfif[6] = 1;
  jfif[9] = 72;
  jfif[11] = 72;
  jfif[12] = 2;
  jfif[13] = 1;
  jfif.set(ascii(THUMB_GPS), 14);

  const xmp = ascii(
    `http://ns.adobe.com/xap/1.0/\0<tiff:Orientation>${xmpOrientation ?? orientation}</tiff:Orientation><${XMP_GPS}</${XMP_GPS}>`,
  );
  const icc = concat(ascii("ICC_PROFILE\0"), new Uint8Array([1, 1, 9, 8, 7]));
  const adobe = ascii("Adobe\0");
  const adobePad = new Uint8Array(12);
  adobePad.set(adobe, 0);
  const entropy = new Uint8Array([0xa5, 0x5a, 0xff, 0x00, 0xd0, 0x3c]);

  return concat(
    new Uint8Array([0xff, 0xd8]),
    exifWithGps(little, orientation),
    segment(0xe1, xmp),
    segment(0xfe, ascii(COMMENT_GPS)),
    segment(0xe0, jfif),
    segment(0xe2, icc),
    segment(0xe2, ascii(`MPF\0${MPF_GPS}`)),
    segment(0xee, adobePad),
    segment(0xdb, new Uint8Array([0, 1, 2, 3])),
    segment(0xc0, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    segment(0xda, new Uint8Array([1, 0, 0, 0, 0, 0])),
    entropy,
    new Uint8Array([0xff, 0xd9]),
  );
}

function app1Payloads(jpeg) {
  const found = [];
  let i = 2;
  while (i + 4 < jpeg.length) {
    if (jpeg[i] !== 0xff) break;
    while (i < jpeg.length && jpeg[i] === 0xff) i += 1;
    const marker = jpeg[i];
    i += 1;
    if (marker === 0xda || marker === 0xd9) break;
    const length = (jpeg[i] << 8) | jpeg[i + 1];
    const payload = jpeg.slice(i + 2, i + length);
    if (marker === 0xe1) found.push(payload);
    i += length;
  }
  return found;
}

function readU16(bytes, offset, little) {
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset, little) {
  const value = little
    ? bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
  return value >>> 0;
}

function ifd0Tags(app1) {
  assert.equal(String.fromCharCode(...app1.subarray(0, 6)), "Exif\0\0");
  const tiff = app1.subarray(6);
  const little = tiff[0] === 0x49;
  const ifd0 = readU32(tiff, 4, little);
  const count = readU16(tiff, ifd0, little);
  const tags = [];
  for (let n = 0; n < count; n++) {
    const at = ifd0 + 2 + n * 12;
    tags.push({ tag: readU16(tiff, at, little), value: readU16(tiff, at + 8, little) });
  }
  return tags;
}

function includesBytes(haystack, needle) {
  const text = Buffer.from(haystack).toString("latin1");
  return text.includes(Buffer.from(needle).toString("latin1"));
}

function includesText(haystack, text) {
  return Buffer.from(haystack).toString("latin1").includes(text);
}

const original = phoneJpeg();
assert.equal(includesBytes(original, GPS_NEEDLE), true, "fixture really contains the GPS rational");
const before = app1Payloads(original);
assert.ok(before.length >= 1);
assert.ok(
  ifd0Tags(before[0]).some((entry) => entry.tag === 0x8825),
  "fixture IFD0 points at a GPS IFD",
);

const cleaned = stripJpegMetadata(original);
assert.ok(cleaned, "a phone JPEG is still servable after the metadata is removed");
assert.equal(
  includesBytes(original, GPS_NEEDLE),
  true,
  "stripping does not rewrite the stored original",
);
assert.equal(includesBytes(cleaned, GPS_NEEDLE), false, "GPS rational is gone");
assert.equal(includesText(cleaned, XMP_GPS), false, "XMP GPS is gone");
assert.equal(includesText(cleaned, COMMENT_GPS), false, "comment GPS is gone");
assert.equal(includesText(cleaned, THUMB_GPS), false, "JFIF thumbnail is gone");
assert.equal(includesText(cleaned, MPF_GPS), false, "embedded MPF preview is gone");
assert.equal(includesText(cleaned, "ICC_PROFILE"), true, "the color profile stays");
assert.equal(includesText(cleaned, "JFIF"), true, "the JFIF header stays");

const kept = app1Payloads(cleaned);
assert.equal(kept.length, 1);
assert.equal(kept[0].length, 32, "the remaining Exif is the one-tag orientation segment");
assert.deepEqual(ifd0Tags(kept[0]), [{ tag: 0x0112, value: 6 }]);
assert.equal(includesBytes(cleaned, new Uint8Array([0xa5, 0x5a, 0xff, 0x00, 0xd0, 0x3c])), true);

const turned = stripJpegMetadata(phoneJpeg({ little: false, orientation: 8 }));
assert.ok(turned);
assert.equal(includesBytes(turned, GPS_NEEDLE), false);
assert.deepEqual(ifd0Tags(app1Payloads(turned)[0]), [{ tag: 0x0112, value: 8 }]);

const upright = stripJpegMetadata(phoneJpeg({ orientation: 1 }));
assert.ok(upright);
assert.equal(includesBytes(upright, GPS_NEEDLE), false);
assert.equal(app1Payloads(upright).length, 0, "orientation 1 needs no Exif tag");

const xmpOnly = concat(
  new Uint8Array([0xff, 0xd8]),
  segment(
    0xe1,
    ascii(`http://ns.adobe.com/xap/1.0/\0<tiff:Orientation>3</tiff:Orientation><${XMP_GPS}</`),
  ),
  segment(0xda, new Uint8Array([1, 0, 0, 0, 0, 0])),
  new Uint8Array([0x11, 0xff, 0xd9]),
);
const fromXmp = stripJpegMetadata(xmpOnly);
assert.ok(fromXmp);
assert.equal(includesText(fromXmp, XMP_GPS), false);
assert.deepEqual(ifd0Tags(app1Payloads(fromXmp)[0]), [{ tag: 0x0112, value: 3 }]);

const exifWins = stripJpegMetadata(phoneJpeg({ orientation: 6, xmpOrientation: 3 }));
assert.deepEqual(ifd0Tags(app1Payloads(exifWins)[0]), [{ tag: 0x0112, value: 6 }]);

assert.equal(stripJpegMetadata(ascii("\x89PNG\r\n\x1a\n")), null);
assert.equal(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
assert.equal(
  stripJpegMetadata(
    concat(
      new Uint8Array([0xff, 0xd8]),
      segment(0xc8, new Uint8Array([1, 2])),
      new Uint8Array([0xff, 0xd9]),
    ),
  ),
  null,
);

console.log("PASS jpeg metadata strip removes GPS and keeps orientation");
