import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MAX_IMAGE_MB, MAX_PDF_MB } from "../src/lib/image-optimize";
import {
  ACCEPTED_EXTS,
  BLUR_BELOW,
  DARK_BELOW,
  MIN_SHORT_EDGE,
  PRECHECK_TIP,
  TYPE_BLOCK_MESSAGE,
  UPLOAD_PRECHECK_ENABLED,
  assertUploadPrecheckEnabled,
  evaluateUpload,
  imageWarnings,
  laplacianVariance,
  limitMbForExt,
  meanLuma,
  recognizedExt,
  reviewUpload,
  uploadDecision,
  type ImageStats,
} from "../src/lib/upload-precheck";

const lib = readFileSync("src/lib/upload-precheck.ts", "utf8");
const capture = readFileSync("src/components/site/DocumentCapture.tsx", "utf8");
const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
const notice = readFileSync("src/components/site/UploadPrecheckNotice.tsx", "utf8");
const upload = readFileSync("src/lib/applicant-upload.ts", "utf8");
const request = readFileSync("src/lib/applications.functions.ts", "utf8");
const limits = readFileSync("supabase/migrations/20260927020000_applicant_upload_limits.sql", "utf8");

function flagValue(source: string): string | null {
  return source.match(/const UPLOAD_PRECHECK_ENABLED: boolean = (false|true)/)?.[1] ?? null;
}

const MB = 1024 * 1024;
const sharp: ImageStats = { width: 1200, height: 1600, meanLuma: 180, sharpness: 400 };

function file(name: string, type: string, size: number) {
  return { name, type, size };
}

describe("upload pre-check flag", () => {
  it("is off, declared only in the lib, and leaves the upload call unchanged", async () => {
    assert.equal(UPLOAD_PRECHECK_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(capture), null);
    assert.equal(flagValue(wizard), null);
    assert.throws(() => assertUploadPrecheckEnabled(), /Upload pre-check is not enabled/);
    await assert.rejects(
      () => reviewUpload(new File([], "licence.jpg", { type: "image/jpeg" })),
      /Upload pre-check is not enabled/,
    );

    const review = lib.slice(lib.indexOf("export async function reviewUpload"));
    const body = review.slice(review.indexOf("{") + 1).trim();
    assert.equal(body.split("\n")[0]?.trim(), "assertUploadPrecheckEnabled();");
    assert.ok(review.indexOf("assertUploadPrecheckEnabled()") < review.indexOf("measureImage("));

    for (const source of [capture, wizard]) {
      assert.match(source, /import \{ UPLOAD_PRECHECK_ENABLED \} from "@\/lib\/upload-precheck"/);
      assert.doesNotMatch(source, /from "@\/components\/site\/UploadPrecheckNotice"/);
      const ask = source.slice(source.indexOf("async function askOverride"));
      assert.ok(ask.indexOf("UPLOAD_PRECHECK_ENABLED !== true") < ask.indexOf('import("@/components/site/UploadPrecheckNotice")'));
      const gate = source.slice(source.indexOf("UPLOAD_PRECHECK_ENABLED === true"));
      assert.ok(gate.indexOf('import("@/lib/upload-precheck")') > 0);
      assert.ok(gate.indexOf('import("@/lib/upload-precheck")') < gate.indexOf("uploadApplicantFile("));
    }

    assert.equal(capture.split("uploadApplicantFile({ token, kind, file })").length - 1, 1);
    assert.equal(wizard.split('uploadApplicantFile({ token, kind: "trip_history", file })').length - 1, 1);
    assert.match(upload, /uploadToSignedUrl\(slot\.path, slot\.uploadToken, file/);
    assert.match(upload, /if \(file\.size > limit \* 1024 \* 1024\) throw new UploadTooLarge\(limit\)/);
    assert.doesNotMatch(lib, /uploadApplicantFile\(|requestUploadUrl\(|supabase|uploadToSignedUrl|esign|\.insert\(|\.update\(|\.delete\(/);
    assert.doesNotMatch(notice, /uploadApplicantFile|supabase|uppercase/);
    assert.match(notice, /Upload Anyway/);
    assert.match(notice, /Choose Another/);
    assert.match(notice, /min-h-11/);
    assert.match(notice, /Photo Quality/);
  });
});

describe("upload pre-check type and size", () => {
  it("blocks a type or a size the current upload would not keep, and lets the allowlist through", () => {
    assert.deepEqual([...ACCEPTED_EXTS], ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"]);
    assert.match(request, /ext: z\.enum\(\["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"\]\)/);
    assert.match(limits, /file_size_limit = 26214400/);
    assert.equal(MAX_IMAGE_MB, 15);
    assert.equal(MAX_PDF_MB, 25);
    assert.equal(MAX_PDF_MB * MB, 26214400);
    assert.equal(limitMbForExt("jpg"), MAX_IMAGE_MB);
    assert.equal(limitMbForExt("png"), MAX_IMAGE_MB);
    assert.equal(limitMbForExt("heic"), MAX_IMAGE_MB);
    assert.equal(limitMbForExt("pdf"), MAX_PDF_MB);
    assert.match(lib, /file\.size > limitMb \* 1024 \* 1024/);

    assert.equal(recognizedExt("licence.jpg", "image/jpeg"), "jpg");
    assert.equal(recognizedExt("licence.png", "image/png"), "png");
    assert.equal(recognizedExt("licence.HEIC", ""), "heic");
    assert.equal(recognizedExt("card.pdf", "application/pdf"), "pdf");
    assert.equal(recognizedExt("shot.webp", "image/webp"), "webp");
    assert.equal(recognizedExt("shot.heif", "image/heif"), "heif");
    assert.equal(recognizedExt("clip.gif", "image/gif"), null);
    assert.equal(recognizedExt("notes.txt", "text/plain"), null);

    const gif = evaluateUpload(file("clip.gif", "image/gif", 1000), sharp);
    assert.equal(gif.blocked, true);
    assert.equal(gif.blockReason, "type");
    assert.equal(gif.blockMessage, TYPE_BLOCK_MESSAGE);
    assert.equal(uploadDecision(gif, true), "stop");

    const jpeg = evaluateUpload(file("licence.jpg", "image/jpeg", MAX_IMAGE_MB * MB), sharp);
    assert.equal(jpeg.blocked, false);
    assert.equal(jpeg.warnings.length, 0);
    const jpegOver = evaluateUpload(file("licence.jpg", "image/jpeg", MAX_IMAGE_MB * MB + 1), sharp);
    assert.equal(jpegOver.blocked, true);
    assert.equal(jpegOver.blockReason, "size");
    assert.match(jpegOver.blockMessage ?? "", /under 15 MB/);

    const pdf = evaluateUpload(file("card.pdf", "application/pdf", MAX_PDF_MB * MB), {
      width: 10,
      height: 10,
      meanLuma: 0,
      sharpness: 0,
    });
    assert.equal(pdf.blocked, false);
    assert.equal(pdf.warnings.length, 0);
    const pdfOver = evaluateUpload(file("card.pdf", "", MAX_PDF_MB * MB + 1), null);
    assert.equal(pdfOver.blockReason, "size");
    assert.match(pdfOver.blockMessage ?? "", /under 25 MB/);

    const png = evaluateUpload(file("card.png", "image/png", 2000), sharp);
    const heic = evaluateUpload(file("card.HEIC", "", 2000), null);
    assert.equal(png.blocked, false);
    assert.equal(heic.blocked, false);
    assert.equal(heic.warnings.length, 0);
  });
});

describe("upload pre-check warnings", () => {
  it("warns on a small, dark, or blurry photo and still allows the upload", () => {
    const flat = new Array(16).fill(0);
    assert.equal(meanLuma(flat), 0);
    assert.equal(laplacianVariance(flat, 4, 4), 0);
    const edge = [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255];
    assert.ok(laplacianVariance(edge, 4, 4) > BLUR_BELOW);

    const small = imageWarnings({ width: MIN_SHORT_EDGE - 1, height: 2000, meanLuma: 180, sharpness: 400 });
    assert.deepEqual(small.map((w) => w.code), ["resolution"]);
    const dark = imageWarnings({ width: 1200, height: 1600, meanLuma: DARK_BELOW - 1, sharpness: 400 });
    assert.deepEqual(dark.map((w) => w.code), ["dark"]);
    const blurry = imageWarnings({ width: 1200, height: 1600, meanLuma: 180, sharpness: BLUR_BELOW - 1 });
    assert.deepEqual(blurry.map((w) => w.code), ["blur"]);
    assert.equal(
      imageWarnings({ width: MIN_SHORT_EDGE, height: MIN_SHORT_EDGE, meanLuma: DARK_BELOW, sharpness: BLUR_BELOW }).length,
      0,
    );

    const warned = evaluateUpload(file("licence.jpg", "image/jpeg", 400_000), {
      width: 320,
      height: 240,
      meanLuma: 8,
      sharpness: 0,
    });
    assert.equal(warned.blocked, false);
    assert.deepEqual(warned.warnings.map((w) => w.code), ["resolution", "dark", "blur"]);
    assert.deepEqual(warned.tips, [PRECHECK_TIP]);
    assert.equal(PRECHECK_TIP, "Retake in good light, all four corners visible");
    assert.equal(uploadDecision(warned, false), "stop");
    assert.equal(uploadDecision(warned, true), "upload");

    const clean = evaluateUpload(file("licence.jpg", "image/jpeg", 400_000), sharp);
    assert.equal(clean.blocked, false);
    assert.equal(clean.warnings.length, 0);
    assert.equal(uploadDecision(clean, false), "upload");
  });
});
