/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   ENHANCEMENT IMPROVES A BAD PHOTOGRAPH AND LEAVES A GOOD ONE ALONE.
 *
 * "Enhanced" is half-strength auto levels plus a white-balance nudge and a
 * little sharpening. Two ways that goes wrong and neither shows up in a type
 * check: it could do nothing, or it could maul a photograph that was already
 * correctly exposed. The second is the dangerous one, because the operator
 * only sees a thumbnail and the result goes on a listing.
 *
 * So this runs the REAL worker in a real browser on images generated at
 * runtime, and measures the pixels before and after. It also pins the failure
 * behaviour, the resolution cap, and that Studio stays refused.
 *
 * No model is downloaded and no paid service is called: "enhanced" is pure
 * canvas work, and the ~115 MB cut-out model belongs to Studio, which is off.
 * Every image is synthesised here; no fixture file, no real photo.
 *
 * Needs no dev server — it serves the bundled worker itself.
 * Run: npm run test:photo-e2e
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const OUT = ".pe2e-build";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
execFileSync("npx", ["esbuild", "src/lib/photo-enhance.worker.ts", "--bundle", "--format=esm",
  "--alias:@=./src", `--outfile=${OUT}/worker.mjs`, "--log-level=warning"], { stdio: "inherit" });

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
window.__ready = true;
function stats(d){let mn=255,mx=0,s=0;const h=new Uint32Array(256);
 for(let i=0;i<d.length;i+=4){const l=Math.round(d[i]*.299+d[i+1]*.587+d[i+2]*.114);h[l]++;if(l<mn)mn=l;if(l>mx)mx=l;s+=l;}
 const n=d.length/4;const pct=(p)=>{let c=0;for(let v=0;v<256;v++){c+=h[v];if(c>=n*p)return v;}return 255;};
 return{min:mn,max:mx,mean:Math.round(s/n),range:mx-mn,p005:pct(.005),p995:pct(.995)};}
window.__px = async (buf)=>{const b=await createImageBitmap(new Blob([buf]));const c=document.createElement("canvas");
 c.width=b.width;c.height=b.height;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(b,0,0);
 return {...stats(x.getImageData(0,0,b.width,b.height).data),w:b.width,h:b.height};};
/** A dull photograph: narrow histogram, warm cast — what the correction is for. */
window.__flat = async (w,h)=>{const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");
 const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,"rgb(70,58,44)");g.addColorStop(1,"rgb(28,24,20)");
 x.fillStyle=g;x.fillRect(0,0,w,h);x.fillStyle="rgb(96,86,70)";
 x.beginPath();x.ellipse(w/2,h*.6,w*.3,h*.18,0,0,Math.PI*2);x.fill();
 return (await new Promise(r=>c.toBlob(r,"image/jpeg",.92))).arrayBuffer();};
/** A photograph that already uses the whole tonal range. Must be left alone. */
window.__good = async (w,h)=>{const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");
 x.fillStyle="rgb(128,128,128)";x.fillRect(0,0,w,h);
 x.fillStyle="rgb(2,2,2)";x.fillRect(0,0,w,Math.round(h*.18));
 x.fillStyle="rgb(253,253,253)";x.fillRect(0,Math.round(h*.82),w,Math.round(h*.18));
 const g=x.createLinearGradient(0,h*.18,0,h*.82);g.addColorStop(0,"rgb(40,40,40)");g.addColorStop(1,"rgb(215,215,215)");
 x.fillStyle=g;x.fillRect(0,Math.round(h*.18),w,Math.round(h*.64));
 return (await new Promise(r=>c.toBlob(r,"image/jpeg",.95))).arrayBuffer();};
let wk=null;
window.__run = (bytes,mode)=>{if(!wk)wk=new Worker("/worker.mjs",{type:"module"});
 return new Promise((res,rej)=>{const id=Math.floor(Math.random()*1e6);
  const to=setTimeout(()=>rej(new Error("timed out")),120000);
  const h=(e)=>{if(e.data.id!==id)return;if(e.data.type==="progress")return;clearTimeout(to);
   wk.removeEventListener("message",h);e.data.type==="done"?res({jpeg:e.data.jpeg,flags:e.data.flags,ms:e.data.ms}):rej(new Error(e.data.error));};
  wk.addEventListener("message",h);wk.postMessage({id,bytes,mode},[bytes]);});};
</script>`;
writeFileSync(`${OUT}/worker-page.html`, PAGE);

const worker = readFileSync(`${OUT}/worker.mjs`);
const server = createServer((req, res) => {
  if (req.url === "/worker.mjs") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(worker); }
  res.writeHead(200, { "Content-Type": "text/html" }); res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function openPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true);
  return { ctx, page, errs };
}

for (const [label, viewport] of [["DESKTOP 1440x900", { width: 1440, height: 900 }],
                                 ["PHONE 375x812", { width: 375, height: 812 }]]) {
  console.log(`\nA DULL PHOTOGRAPH IS IMPROVED — ${label}`);
  const { ctx, page, errs } = await openPage(viewport);
  {
    const r = await page.evaluate(async () => {
      const src = await window.__flat(1600, 1200);
      const before = await window.__px(src.slice(0));
      const out = await window.__run(src, "enhanced");
      return { before, after: await window.__px(out.jpeg), ms: out.ms, flags: out.flags, bytes: out.jpeg.byteLength };
    });
    ok(r.after.range > r.before.range * 1.5,
       `contrast opens up (range ${r.before.range} -> ${r.after.range})`);
    ok(r.after.mean > r.before.mean, `  and it is no longer underexposed (mean ${r.before.mean} -> ${r.after.mean})`);
    ok(r.after.w === 1600 && r.after.h === 1200, "  at the original size");
    ok(r.bytes > 0 && r.ms > 0, `  in ${r.ms} ms`);
    ok(r.flags.length === 0, "  with nothing flagged");
  }
  {
    const r = await page.evaluate(async () => {
      const src = await window.__good(1200, 900);
      const before = await window.__px(src.slice(0));
      const out = await window.__run(src, "enhanced");
      return { before, after: await window.__px(out.jpeg) };
    });
    ok(Math.abs(r.after.mean - r.before.mean) <= 4,
       `A GOOD PHOTOGRAPH IS LEFT ALONE (mean ${r.before.mean} -> ${r.after.mean})`);
    ok(Math.abs(r.after.p005 - r.before.p005) <= 4 && Math.abs(r.after.p995 - r.before.p995) <= 4,
       "  shadows and highlights are not crushed or blown");
  }
  ok(errs.length === 0, `no page errors (${errs.slice(0, 2).join(" | ") || "none"})`);
  await ctx.close();
}

console.log("\nAN OVERSIZED PHOTOGRAPH IS CAPPED, NOT REFUSED");
{
  const { ctx, page, errs } = await openPage({ width: 1440, height: 900 });
  const r = await page.evaluate(async () => {
    const src = await window.__flat(6000, 4000);
    const out = await window.__run(src, "enhanced");
    return { after: await window.__px(out.jpeg), ms: out.ms };
  });
  ok(Math.max(r.after.w, r.after.h) === 2400, `the long edge is capped at 2400 (${r.after.w}x${r.after.h})`);
  ok(r.after.h === 1600, "  and the aspect ratio is kept");
  ok(r.ms < 30000, `  within a reasonable time (${r.ms} ms)`);
  ok(errs.length === 0, "no page errors");
  await ctx.close();
}

console.log("\nFAILURE IS REPORTED IN WORDS A PERSON CAN ACT ON");
{
  const { ctx, page, errs } = await openPage({ width: 1440, height: 900 });
  const bad = await page.evaluate(async () => {
    try {
      const notAnImage = new TextEncoder().encode("%PDF-1.4 this is not a photograph").buffer;
      await window.__run(notAnImage, "enhanced");
      return { threw: false };
    } catch (e) { return { threw: true, message: String(e.message) }; }
  });
  ok(bad.threw, "a file that is not a photograph fails");
  ok(!/undefined|\[object|TypeError/.test(bad.message), `  with a readable message ("${bad.message}")`);

  const after = await page.evaluate(async () => {
    const src = await window.__flat(800, 600);
    const out = await window.__run(src, "enhanced");
    return out.jpeg.byteLength;
  });
  ok(after > 0, "AND THE WORKER STILL WORKS AFTERWARDS — one bad file does not poison it");

  const studio = await page.evaluate(async () => {
    try { const src = await window.__flat(600, 400); await window.__run(src, "studio"); return { threw: false }; }
    catch (e) { return { threw: true, message: String(e.message) }; }
  });
  ok(studio.threw, "Studio is refused on this device");
  ok(/graphics acceleration|memory|Enhanced/i.test(studio.message),
     `  and says why, and what to use instead ("${studio.message.slice(0, 70)}…")`);
  ok(errs.length === 0, "no page errors");
  await ctx.close();
}

await browser.close();
server.close();
rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall clear");
process.exit(fail ? 1 : 0);
