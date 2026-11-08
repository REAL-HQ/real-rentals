/**
 * Fleet Inbox thumbnails: bounded, cached, permission-preserving previews and
 * the rendered row thumbnail / lightbox. No browser, no storage, no writes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewStore, canThumb, previewKind, typeLabel, THUMB_MAX_BYTES } from "../src/lib/fleet-file-preview";
import { FleetFileThumb, FleetFileLightbox } from "../src/components/admin/FleetFilePreview";

const tick = () => new Promise((r) => setTimeout(r, 0));
const b64 = btoa("img");
function deferredFetcher() {
  const calls: string[] = [];
  const pending: Record<string, { res: () => void; rej: (e: Error) => void }> = {};
  const fetcher = (id: string) => new Promise<{ base64: string; mimeType: string }>((res, rej) => {
    calls.push(id);
    pending[id] = { res: () => res({ base64: b64, mimeType: "image/jpeg" }), rej };
  });
  return { calls, pending, fetcher };
}
const urls = () => { const made: string[] = []; const revoked: string[] = []; let n = 0; return { made, revoked, make: () => { const u = `blob:${++n}`; made.push(u); return u; }, revoke: (u: string) => revoked.push(u) }; };

describe("file kinds", () => {
  test("JPEG/PNG/WebP thumb; PDF, video, HEIC and unknown get honest type tiles", () => {
    expect(previewKind("image/jpeg", "IMG_0120.jpeg")).toBe("image");
    expect(previewKind("image/png", "a.png")).toBe("image");
    expect(previewKind("image/webp", "a.webp")).toBe("image");
    expect(previewKind("application/pdf", "reg.pdf")).toBe("pdf");
    expect(previewKind("video/mp4", "walk.mp4")).toBe("video");
    expect(previewKind("image/heic", "IMG_1.HEIC")).toBe("heic");
    expect(previewKind("application/octet-stream", "IMG_1.heic")).toBe("heic");
    expect(previewKind("application/zip", "x.zip")).toBe("other");
    expect(typeLabel("other", "x.zip")).toBe("ZIP");
    expect(canThumb({ document_id: "d", mime_type: "image/jpeg", file_name: "a.jpg", size_bytes: THUMB_MAX_BYTES + 1 })).toBe(false);
    expect(canThumb({ document_id: null, mime_type: "image/jpeg", file_name: "a.jpg" })).toBe(false);
    expect(canThumb({ document_id: "d", mime_type: "image/heic", file_name: "a.heic" })).toBe(false);
  });
});

describe("PreviewStore", () => {
  test("bounded concurrency, one fetch per document, cached", async () => {
    const f = deferredFetcher(); const u = urls();
    const st = new PreviewStore(f.fetcher, u.make, u.revoke, 2);
    for (const id of ["a", "b", "c", "d", "a"]) st.request(id);
    expect(f.calls).toEqual(["a", "b"]);
    expect(st.inFlight).toBe(2);
    f.pending.a.res(); await tick();
    expect(f.calls).toEqual(["a", "b", "c"]);
    expect(st.get("a")).toEqual({ state: "ready", url: "blob:1" });
    st.request("a"); await tick();
    expect(f.calls.filter((x) => x === "a").length).toBe(1);
  });
  test("forbidden is restricted (no retry loop); other errors can retry", async () => {
    const f = deferredFetcher(); const u = urls();
    const st = new PreviewStore(f.fetcher, u.make, u.revoke, 2);
    st.request("fin"); st.request("bad");
    f.pending.fin.rej(new Error("Forbidden: this original contains financial details")); f.pending.bad.rej(new Error("File unavailable")); await tick();
    expect(st.get("fin")?.state).toBe("restricted");
    expect(st.get("bad")?.state).toBe("error");
    st.request("fin"); st.request("bad");
    expect(f.calls).toEqual(["fin", "bad", "bad"]);
  });
  test("dispose revokes every object URL and ignores late responses", async () => {
    const f = deferredFetcher(); const u = urls();
    const st = new PreviewStore(f.fetcher, u.make, u.revoke, 2);
    st.request("a"); st.request("b");
    f.pending.a.res(); await tick();
    st.dispose();
    f.pending.b.res(); await tick();
    expect(u.revoked).toEqual(["blob:1"]);
    expect(u.made).toEqual(["blob:1"]);
    st.request("c");
    expect(f.calls).toEqual(["a", "b"]);
  });
});

function fakeStore(states: Record<string, any>) {
  return { get: (id: string) => states[id], subscribe: () => () => {}, request() {} } as any;
}
const row = (id: string, over: any = {}) => ({ id, document_id: `doc-${id}`, mime_type: "image/jpeg", file_name: `IMG_${id}.jpeg`, size_bytes: 1000, ...over });

describe("rendered thumbnail", () => {
  test("ready image shows the picture for that row's own document", () => {
    const html = renderToStaticMarkup(h(FleetFileThumb, { item: row("0120"), store: fakeStore({ "doc-0120": { state: "ready", url: "blob:x" } }), onOpen() {} }));
    expect(html).toContain('data-thumb-for="0120"');
    expect(html).toContain('src="blob:x"');
    expect(html).toContain('aria-label="Preview IMG_0120.jpeg"');
  });
  test("loading, restricted, error, PDF, HEIC and missing-document states", () => {
    const r = (item: any, st: any = {}) => renderToStaticMarkup(h(FleetFileThumb, { item, store: fakeStore(st), onOpen() {} }));
    expect(r(row("1"))).toContain('data-thumb-state="idle"');
    expect(r(row("1"), { "doc-1": { state: "loading" } })).toContain("animate-spin");
    expect(r(row("1"), { "doc-1": { state: "restricted" } })).toContain("Restricted");
    expect(r(row("1"), { "doc-1": { state: "error" } })).toContain("No Preview");
    expect(r(row("2", { mime_type: "application/pdf", file_name: "reg.pdf" }))).toContain(">PDF<");
    const heic = r(row("3", { mime_type: "image/heic", file_name: "a.HEIC" }));
    expect(heic).toContain(">HEIC<");
    expect(heic).not.toContain("<img");
    expect(r(row("4", { document_id: null }))).toContain("disabled");
  });
  test("lightbox closed renders nothing; no gradients in new UI", () => {
    expect(renderToStaticMarkup(h(FleetFileLightbox, { items: [row("1")], index: null, store: fakeStore({}), onIndex() {}, onClose() {}, openOriginal() {} }))).toBe("");
    const src = readFileSync("src/components/admin/FleetFilePreview.tsx", "utf8");
    expect(src).not.toMatch(/gradient|bg-linear|\bfrom-\w+-\d/);
    expect(src).toContain("Open Original");
    expect(src).toContain("ArrowRight");
  });
});

describe("security wiring", () => {
  const lib = readFileSync("src/lib/fleet-file-preview.ts", "utf8");
  const ui = readFileSync("src/components/admin/FleetFilePreview.tsx", "utf8");
  const panel = readFileSync("src/components/admin/FleetInboxPanel.tsx", "utf8");
  test("previews only go through the staff-checked file function; no public or signed URLs", () => {
    for (const s of [lib, ui]) expect(s).not.toMatch(/createSignedUrl|getPublicUrl|supabase|storage\.from/);
    expect(panel).toContain("new PreviewStore((documentId) => fileFn({ data: { documentId } }))");
    expect(panel).toContain("return () => st.dispose()");
  });
  test("row controls stay: View, Retry Analysis, Classify, Attach", () => {
    for (const s of ["<Eye", "Retry Analysis", "Classify…", "Attach to vehicle…", "<FleetFileThumb item={it}", "data-item-row={it.id}"]) expect(panel).toContain(s);
  });
});
