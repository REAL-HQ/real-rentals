var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/lib/roles.ts
function tierAllows(have, need) {
  if (!have) return false;
  return TIER_RANK[have] >= TIER_RANK[need];
}
function tierFromRoles(roles) {
  let best = null;
  for (const r of roles) {
    const t = TIER_BY_ROLE[r];
    if (!t) continue;
    if (!best || TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}
var TIER_RANK, TIER_BY_ROLE, TIER_LABELS, TIER_SUMMARY;
var init_roles = __esm({
  "src/lib/roles.ts"() {
    "use strict";
    TIER_RANK = {
      coordinator: 1,
      manager: 2,
      owner: 3
    };
    TIER_BY_ROLE = {
      admin: "owner",
      team: "manager",
      coordinator: "coordinator"
    };
    TIER_LABELS = {
      owner: "Owner",
      manager: "Manager",
      coordinator: "Coordinator"
    };
    TIER_SUMMARY = {
      owner: "Full access, including team management, settings and money.",
      manager: "Everything operational, including rent, deposits, charges and expenses. Cannot manage the team.",
      coordinator: "Applicants, drivers, vehicles, inspections and documents. Cannot see or touch money."
    };
  }
});

// src/lib/trip-media.ts
function tripMediaType(fileName, mimeType) {
  const m = String(mimeType ?? "").toLowerCase();
  if (TRIP_MEDIA_TYPES[m]) return m;
  if (m && m !== "application/octet-stream") return null;
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  return TRIP_MEDIA_EXT[ext] ?? null;
}
function stripJpegMetadata(input) {
  const n = input.length;
  if (n < 4 || input[0] !== 255 || input[1] !== 216) return null;
  const parts = [input.subarray(0, 2)];
  let i = 2;
  let sawSof = false;
  let sawSos = false;
  const keepSeg = (m, s, len) => {
    if (m >= 192 && m <= 207 && m !== 200 || m === 219 || m === 221 || m === 220) {
      if (m >= 192 && m <= 207 && m !== 196 && m !== 204) sawSof = true;
      return true;
    }
    if (m === 224) {
      return len === 16 && fourcc(input, s + 4) === "JFIF" && input[s + 8] === 0;
    }
    if (m === 238) return len === 14 && input[s + 4] === 65 && fourcc(input, s + 5) === "dobe";
    if (m >= 225 && m <= 239) return false;
    if (m === 254) return false;
    return null;
  };
  while (i + 2 <= n) {
    if (input[i] !== 255) return null;
    let m = input[i + 1];
    while (m === 255 && i + 2 < n) {
      i++;
      m = input[i + 1];
    }
    if (m === 217) {
      if (!sawSof || !sawSos) return null;
      parts.push(input.subarray(i, i + 2));
      return concat(parts);
    }
    if (i + 4 > n) return null;
    const len = input[i + 2] << 8 | input[i + 3];
    if (len < 2 || i + 2 + len > n) return null;
    const keep = keepSeg(m, i, len);
    if (keep === null && m !== 218) return null;
    if (m === 218) {
      if (!sawSof) return null;
      sawSos = true;
      let j = i + 2 + len;
      while (j + 1 < n) {
        if (input[j] === 255) {
          const x = input[j + 1];
          if (x === 0 || x >= 208 && x <= 215 || x === 255) {
            j += x === 255 ? 1 : 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j + 1 >= n) return null;
      parts.push(input.subarray(i, j));
      i = j;
      continue;
    }
    if (keep) parts.push(input.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}
function stripPngMetadata(input) {
  if (input.length < 8 || PNG_SIG.some((b, k) => input[k] !== b)) return null;
  const parts = [input.subarray(0, 8)];
  let i = 8;
  let first = true;
  while (i + 12 <= input.length) {
    const len = (input[i] << 24 | input[i + 1] << 16 | input[i + 2] << 8 | input[i + 3]) >>> 0;
    const type = String.fromCharCode(input[i + 4], input[i + 5], input[i + 6], input[i + 7]);
    const end = i + 12 + len;
    if (len > 2147483647 || end > input.length) return null;
    if (first && type !== "IHDR") return null;
    first = false;
    if (PNG_KEEP.has(type)) parts.push(input.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return null;
}
function shareCopyPath(path) {
  return `${path}.share`;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function fourcc(b, i) {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}
function u32(b, i) {
  return (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
}
function sniffMediaType(b) {
  if (b.length < 12) return null;
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (PNG_SIG.every((x, k) => b[k] === x)) return "image/png";
  if (fourcc(b, 0) === "RIFF" && fourcc(b, 8) === "WEBP") return "image/webp";
  if (fourcc(b, 4) === "ftyp") {
    const size = u32(b, 0);
    const brands = [fourcc(b, 8)];
    for (let i = 16; i + 4 <= Math.min(size, b.length); i += 4) brands.push(fourcc(b, i));
    if (brands.some((x) => HEIC_BRANDS.has(x)) && !brands.includes("qt  ")) {
      if (brands[0] !== "isom" && brands[0] !== "mp41" && brands[0] !== "mp42") return "image/heic";
    }
    if (brands[0] === "qt  ") return "video/quicktime";
    if ([
      "isom",
      "iso2",
      "iso4",
      "iso5",
      "iso6",
      "mp41",
      "mp42",
      "avc1",
      "M4V ",
      "MSNV",
      "dash"
    ].includes(brands[0]))
      return "video/mp4";
    return null;
  }
  if (["moov", "wide", "mdat", "free", "skip", "pnot"].includes(fourcc(b, 4)))
    return "video/quicktime";
  return null;
}
function verifyMagic(declared, bytes) {
  const actual = sniffMediaType(bytes);
  if (!actual) throw new Error("The file's contents aren't a supported photo or video");
  if (TRIP_MEDIA_TYPES[actual] !== TRIP_MEDIA_TYPES[declared]) {
    throw new Error("The file's contents don't match its type");
  }
  return actual;
}
function stripWebpMetadata(input) {
  if (input.length < 20 || fourcc(input, 0) !== "RIFF" || fourcc(input, 8) !== "WEBP") return null;
  const riffEnd = 8 + ((input[4] | input[5] << 8 | input[6] << 16 | input[7] << 24) >>> 0);
  if (riffEnd > input.length) return null;
  const parts = [];
  let i = 12;
  let image = false;
  while (i + 8 <= riffEnd) {
    const type = fourcc(input, i);
    const len = (input[i + 4] | input[i + 5] << 8 | input[i + 6] << 16 | input[i + 7] << 24) >>> 0;
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > riffEnd) return null;
    if (WEBP_KEEP.has(type)) {
      const chunk = input.slice(i, Math.min(end, riffEnd));
      if (type === "VP8X") {
        if (len < 10) return null;
        chunk[8] &= ~(32 | 8 | 4);
      }
      if (type === "VP8 " || type === "VP8L" || type === "ANMF") image = true;
      parts.push(chunk);
    }
    i = end;
  }
  if (!image) return null;
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(input.subarray(0, 12));
  const riff = 4 + body.length;
  out[4] = riff & 255;
  out[5] = riff >> 8 & 255;
  out[6] = riff >> 16 & 255;
  out[7] = riff >>> 24 & 255;
  out.set(body, 12);
  return out;
}
function hasMetadataRemnants(b) {
  for (const m of LEAK_MARKERS) {
    const c0 = m.charCodeAt(0);
    outer: for (let i = b.indexOf(c0); i >= 0 && i + m.length <= b.length; i = b.indexOf(c0, i + 1)) {
      for (let k = 1; k < m.length; k++) if (b[i + k] !== m.charCodeAt(k)) continue outer;
      return true;
    }
  }
  return false;
}
function buildShareCopy(mime, bytes) {
  let out = null;
  if (mime === "image/jpeg") out = stripJpegMetadata(bytes);
  else if (mime === "image/png") out = stripPngMetadata(bytes);
  else if (mime === "image/webp") out = stripWebpMetadata(bytes);
  if (!out || hasMetadataRemnants(out)) return null;
  if (sniffMediaType(out) !== mime) return null;
  return out;
}
var TRIP_MEDIA_TYPES, TRIP_MEDIA_EXT, TRIP_MEDIA_MAX_BYTES, PNG_SIG, PNG_KEEP, HEIC_BRANDS, WEBP_KEEP, LEAK_MARKERS;
var init_trip_media = __esm({
  "src/lib/trip-media.ts"() {
    "use strict";
    TRIP_MEDIA_TYPES = {
      "image/jpeg": "photo",
      "image/png": "photo",
      "image/webp": "photo",
      "image/heic": "photo",
      "video/mp4": "video",
      "video/quicktime": "video"
    };
    TRIP_MEDIA_EXT = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      mp4: "video/mp4",
      mov: "video/quicktime"
    };
    TRIP_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
    PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    PNG_KEEP = /* @__PURE__ */ new Set([
      "IHDR",
      "PLTE",
      "IDAT",
      "IEND",
      "tRNS",
      "cHRM",
      "gAMA",
      "sBIT",
      "sRGB",
      "bKGD",
      "pHYs",
      "hIST",
      "cICP",
      "acTL",
      "fcTL",
      "fdAT"
    ]);
    HEIC_BRANDS = /* @__PURE__ */ new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);
    WEBP_KEEP = /* @__PURE__ */ new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
    LEAK_MARKERS = [
      "Exif\0\0",
      "x:xmpmeta",
      "http://ns.adobe.com/",
      "ISO6709",
      "com.apple.quicktime.location"
    ];
  }
});

// .bookings-actions-build/stub/supabase.js
var supabase_exports = {};
__export(supabase_exports, {
  default: () => supabase_default,
  supabase: () => supabase,
  supabaseAdmin: () => supabaseAdmin
});
function likeRx(pattern) {
  return new RegExp(
    `^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".")}$`,
    "i"
  );
}
function matchOr(row, expr) {
  return String(expr).split(",").some((clause) => {
    const [field, op, ...rest] = clause.split(".");
    const want = rest.join(".");
    const v = row[field];
    if (op === "is") return want === "null" ? v == null : v === want;
    if (op === "eq") return want === "" ? v === "" : String(v) === want;
    if (op === "ilike") return v != null && likeRx(want).test(String(v));
    return false;
  });
}
var S, rows, clone, uuid, Query, table, supabaseAdmin, supabase, supabase_default;
var init_supabase = __esm({
  ".bookings-actions-build/stub/supabase.js"() {
    "use strict";
    S = globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} };
    rows = (t) => S.tables[t] ??= [];
    clone = (r) => JSON.parse(JSON.stringify(r));
    uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : r & 3 | 8).toString(16);
    });
    Query = class {
      constructor(table2, kind, payload, opts = {}) {
        this.table = table2;
        this.kind = kind;
        this.payload = payload;
        this.filters = [];
        this.orders = [];
        this.limitN = null;
        this.rangeFrom = null;
        this.rangeTo = null;
        this.total = null;
        this.count = opts.count ?? null;
        this.head = opts.head ?? false;
      }
      // PostgREST lets a filter address inside a json column: value->>version.
      // The compare-and-swap that enforces the photo-reading limit depends on it,
      // so the fake has to understand it too or the test proves nothing.
      eq(f, v) {
        const [col, key] = String(f).split("->>");
        this.filters.push((r) => String(key ? (r[col] ?? {})[key] : r[f]) === String(v));
        return this;
      }
      neq(f, v) {
        this.filters.push((r) => String(r[f]) !== String(v));
        return this;
      }
      /**
       * ilike is a case-insensitive LIKE, not a case-insensitive equals: % and _
       * are wildcards. The duplicate-plate check hands a plate straight to it, so
       * a fake that compared strings would hide the reason a plate's characters
       * are validated at all — a plate of "%" matches every car in the fleet.
       */
      ilike(f, pat) {
        const rx = likeRx(pat);
        this.filters.push((r) => r[f] != null && rx.test(String(r[f])));
        return this;
      }
      // PostgREST cannot parse `col=in.()` — it is a syntax error, not a filter
      // that matches nothing. Pretending otherwise hid the callers that must
      // check for an empty candidate list before they ask.
      in(f, vs) {
        if (!vs?.length) throw new Error(`PostgREST: empty in() list for ${f}`);
        this.filters.push((r) => vs.map(String).includes(String(r[f])));
        return this;
      }
      is(f, v) {
        this.filters.push((r) => v === null ? r[f] == null : r[f] === v);
        return this;
      }
      or(expr) {
        (this.ors ??= []).push(expr);
        this.filters.push((r) => matchOr(r, expr));
        return this;
      }
      gte(f, v) {
        this.filters.push((r) => String(r[f]) >= String(v));
        return this;
      }
      lte(f, v) {
        this.filters.push((r) => String(r[f]) <= String(v));
        return this;
      }
      order(f, o = {}) {
        this.orders.push([f, o.ascending !== false]);
        return this;
      }
      limit(n) {
        this.limitN = n;
        return this;
      }
      /**
       * One page, PostgREST's inclusive from–to. `count: "exact"` still reports
       * the TOTAL that matched, not the size of the page — a fake that counted
       * the slice would make a paginated list claim one page was the whole fleet.
       */
      range(from, to) {
        this.rangeFrom = from;
        this.rangeTo = to;
        return this;
      }
      select(cols, opts = {}) {
        this.selected = true;
        this.cols = cols ?? "*";
        if (opts.count) this.count = opts.count;
        if (opts.head) this.head = true;
        return this;
      }
      _matching() {
        let out = rows(this.table).filter((r) => this.filters.every((f) => f(r)));
        for (const [f, asc] of [...this.orders].reverse()) {
          out = out.slice().sort((a, b) => {
            const x = a[f] ?? "", y = b[f] ?? "";
            return x === y ? 0 : (x < y ? -1 : 1) * (asc ? 1 : -1);
          });
        }
        this.total = out.length;
        if (this.limitN != null) out = out.slice(0, this.limitN);
        if (this.rangeFrom != null) out = out.slice(this.rangeFrom, (this.rangeTo ?? out.length) + 1);
        return out;
      }
      _run() {
        const t = this.table;
        if (this.kind === "select") {
          if (S.failSelect === t) return { data: null, error: { message: `select ${t} refused` }, count: null };
          const m = this._matching();
          return { data: this.head ? null : m.map(clone), error: null, count: this.total ?? m.length };
        }
        if (this.kind === "insert") {
          if (S.failInsert === t) return { data: null, error: { message: `insert into ${t} refused` } };
          const list = Array.isArray(this.payload) ? this.payload : [this.payload];
          const made = list.map((p) => {
            const r = { id: p.id ?? uuid(), created_at: (/* @__PURE__ */ new Date()).toISOString(), ...S.defaults?.[t] ?? {}, ...p };
            rows(t).push(r);
            S.log.push({ op: "insert", table: t, row: clone(r) });
            return clone(r);
          });
          return { data: Array.isArray(this.payload) ? made : made[0], error: null };
        }
        if (this.kind === "upsert") {
          const p = this.payload;
          const i = rows(t).findIndex((r) => r.key === p.key || r.id === p.id);
          if (i >= 0) rows(t)[i] = { ...rows(t)[i], ...p };
          else rows(t).push({ id: p.id ?? uuid(), ...p });
          S.log.push({ op: "upsert", table: t, row: clone(p) });
          return { data: clone(p), error: null };
        }
        if (this.kind === "update") {
          const refused = this._returningRefused();
          if (refused) return refused;
          const m = this._matching();
          const intercepted = S.interceptUpdate?.({ table: t, patch: clone(this.payload), rows: m.map(clone) });
          if (intercepted) return intercepted;
          for (const r of m) {
            Object.assign(r, this.payload);
            S.log.push({ op: "update", table: t, row: clone(r), patch: clone(this.payload) });
          }
          return { data: this._returning(m), error: null };
        }
        if (this.kind === "delete") {
          const refused = this._returningRefused();
          if (refused) return refused;
          const m = this._matching();
          S.tables[t] = rows(t).filter((r) => !m.includes(r));
          for (const r of m) S.log.push({ op: "delete", table: t, row: clone(r) });
          return { data: this._returning(m), error: null };
        }
        return { data: null, error: null };
      }
      /** Columns an or() expression filters on: `a.is.null,and(b.gte.1,c.lt.2)` -> a, b, c. */
      _orColumns() {
        const cols = /* @__PURE__ */ new Set();
        for (const expr of this.ors ?? []) {
          for (const m of String(expr).matchAll(/(?:^|[,(])([A-Za-z_][A-Za-z0-9_]*)\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|isdistinct|cs|cd|ov|fts)\./g)) cols.add(m[1]);
        }
        return cols;
      }
      /** PostgREST 12: a returning mutation whose select omits an or() column fails before writing. */
      _returningRefused() {
        if (!this.selected || !this.ors?.length) return null;
        const sel = String(this.cols).split(",").map((c) => c.trim());
        if (sel.includes("*")) return null;
        for (const c of this._orColumns()) {
          if (!sel.includes(c)) return { data: null, error: { code: "42703", message: `column ${this.table}.${c} does not exist` } };
        }
        return null;
      }
      /** PostgREST 12: the or() is applied again to the rows as they are AFTER the write. */
      _returning(m) {
        const out = this.ors?.length ? m.filter((r) => this.ors.every((e) => matchOr(r, e))) : m;
        return out.map(clone);
      }
      /**
       * A test can hold every read of one table until it chooses to release them.
       * Without this, "concurrent" callers in a single-threaded runtime simply
       * take turns, each seeing the previous one's write — so a compare-and-swap
       * test passes just as well with the compare removed. S.gate makes the race
       * real: everyone reads the same stale row, then they all try to write.
       */
      async _gate() {
        if (S.gateTable === this.table && S.gate) await S.gate;
      }
      async single() {
        await this._gate();
        const r = this._run();
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        return { data: d ?? null, error: r.error ?? (d ? null : { message: "no rows" }), count: r.count };
      }
      async maybeSingle() {
        await this._gate();
        const r = this._run();
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        return { data: d ?? null, error: r.error ?? null, count: r.count };
      }
      then(res, rej) {
        return this._gate().then(() => this._run()).then(res, rej);
      }
    };
    table = (name) => {
      S.reads = (S.reads ?? 0) + 1;
      return {
        select: (cols, opts = {}) => new Query(name, "select", null, opts).select(cols, opts),
        insert: (p) => new Query(name, "insert", p),
        update: (p) => new Query(name, "update", p),
        upsert: (p) => new Query(name, "upsert", p),
        delete: () => new Query(name, "delete", null)
      };
    };
    supabaseAdmin = {
      from: table,
      /**
       * Database functions, recorded rather than executed.
       *
       * The point of a test calling one is not to run PL/pgSQL — it is to prove
       * which transaction a path reached, how many times, and with what. A caller
       * that never gets here (because authorization refused it first) leaves no
       * entry, which is what "fails closed" looks like from the outside.
       *
       * Set S.rpcResults[name] to decide what it answers.
       */
      rpc: async (name, args) => {
        (S.rpcs ??= []).push({ name, args });
        const r = S.rpcResults?.[name];
        if (typeof r === "function") return r(args);
        return r ?? { data: null, error: null };
      },
      storage: {
        from: (bucket) => ({
          download: async (path) => {
            const key = `${bucket}/${path}`;
            const bytes = S.files[key];
            if (!bytes) return { data: null, error: { message: "not found" } };
            return {
              data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer, type: S.mime?.[key] ?? "image/jpeg" },
              error: null
            };
          },
          // A signed URL is how private evidence reaches a staff screen. The fake
          // hands back a recognisable stand-in so a test can tell "signed" from
          // "served straight out of a public bucket", which is the real risk.
          // A signed UPLOAD url is scoped to one path. Returning the path back is
          // what lets a test prove the server pinned it to one vehicle's folder
          // instead of handing out the bucket.
          createSignedUploadUrl: async (path) => ({
            data: { path, token: `upload-token:${bucket}/${path}` },
            error: null
          }),
          createSignedUrl: async (path, seconds) => ({
            data: { signedUrl: `signed://${bucket}/${path}?exp=${seconds}` },
            error: null
          }),
          remove: async (paths) => {
            for (const p of paths) delete S.files[`${bucket}/${p}`];
            return { data: null, error: null };
          },
          upload: async (path, body) => {
            S.files[`${bucket}/${path}`] = [...body ?? []];
            return { data: { path }, error: null };
          }
        })
      }
    };
    supabase = supabaseAdmin;
    supabase_default = supabaseAdmin;
  }
});

// ../real-rentals/node_modules/exifr/dist/full.umd.js
var require_full_umd = __commonJS({
  "../real-rentals/node_modules/exifr/dist/full.umd.js"(exports, module) {
    !(function(e, t) {
      "object" == typeof exports && "undefined" != typeof module ? t(exports) : "function" == typeof define && define.amd ? define("exifr", ["exports"], t) : t((e = "undefined" != typeof globalThis ? globalThis : e || self).exifr = {});
    })(exports, (function(e) {
      "use strict";
      var t = "undefined" != typeof self ? self : global;
      const i = "undefined" != typeof navigator, n = i && "undefined" == typeof HTMLImageElement, s = !("undefined" == typeof global || "undefined" == typeof process || !process.versions || !process.versions.node), r = t.Buffer, a = t.BigInt, o = !!r, l = (e2) => e2;
      function h(e2, t2 = l) {
        if (s) try {
          return "function" == typeof __require ? Promise.resolve(t2(__require(e2))) : import(
            /* webpackIgnore: true */
            e2
          ).then(t2);
        } catch (t3) {
          console.warn(`Couldn't load ${e2}`);
        }
      }
      let u = t.fetch;
      const c = (e2) => u = e2;
      if (!t.fetch) {
        const e2 = h("http", ((e3) => e3)), t2 = h("https", ((e3) => e3)), i2 = (n2, { headers: s2 } = {}) => new Promise((async (r2, a2) => {
          let { port: o2, hostname: l2, pathname: h2, protocol: u2, search: c2 } = new URL(n2);
          const f2 = { method: "GET", hostname: l2, path: encodeURI(h2) + c2, headers: s2 };
          "" !== o2 && (f2.port = Number(o2));
          const d2 = ("https:" === u2 ? await t2 : await e2).request(f2, ((e3) => {
            if (301 === e3.statusCode || 302 === e3.statusCode) {
              let t3 = new URL(e3.headers.location, n2).toString();
              return i2(t3, { headers: s2 }).then(r2).catch(a2);
            }
            r2({ status: e3.statusCode, arrayBuffer: () => new Promise(((t3) => {
              let i3 = [];
              e3.on("data", ((e4) => i3.push(e4))), e3.on("end", (() => t3(Buffer.concat(i3))));
            })) });
          }));
          d2.on("error", a2), d2.end();
        }));
        c(i2);
      }
      function f(e2, t2, i2) {
        return t2 in e2 ? Object.defineProperty(e2, t2, { value: i2, enumerable: true, configurable: true, writable: true }) : e2[t2] = i2, e2;
      }
      const d = (e2) => g(e2) ? void 0 : e2, p = (e2) => void 0 !== e2;
      function g(e2) {
        return void 0 === e2 || (e2 instanceof Map ? 0 === e2.size : 0 === Object.values(e2).filter(p).length);
      }
      function m(e2) {
        let t2 = new Error(e2);
        throw delete t2.stack, t2;
      }
      function S2(e2) {
        return "" === (e2 = (function(e3) {
          for (; e3.endsWith("\0"); ) e3 = e3.slice(0, -1);
          return e3;
        })(e2).trim()) ? void 0 : e2;
      }
      function C(e2) {
        let t2 = (function(e3) {
          let t3 = 0;
          return e3.ifd0.enabled && (t3 += 1024), e3.exif.enabled && (t3 += 2048), e3.makerNote && (t3 += 2048), e3.userComment && (t3 += 1024), e3.gps.enabled && (t3 += 512), e3.interop.enabled && (t3 += 100), e3.ifd1.enabled && (t3 += 1024), t3 + 2048;
        })(e2);
        return e2.jfif.enabled && (t2 += 50), e2.xmp.enabled && (t2 += 2e4), e2.iptc.enabled && (t2 += 14e3), e2.icc.enabled && (t2 += 6e3), t2;
      }
      const y = (e2) => String.fromCharCode.apply(null, e2), b = "undefined" != typeof TextDecoder ? new TextDecoder("utf-8") : void 0;
      function P(e2) {
        return b ? b.decode(e2) : o ? Buffer.from(e2).toString("utf8") : decodeURIComponent(escape(y(e2)));
      }
      class I {
        static from(e2, t2) {
          return e2 instanceof this && e2.le === t2 ? e2 : new I(e2, void 0, void 0, t2);
        }
        constructor(e2, t2 = 0, i2, n2) {
          if ("boolean" == typeof n2 && (this.le = n2), Array.isArray(e2) && (e2 = new Uint8Array(e2)), 0 === e2) this.byteOffset = 0, this.byteLength = 0;
          else if (e2 instanceof ArrayBuffer) {
            void 0 === i2 && (i2 = e2.byteLength - t2);
            let n3 = new DataView(e2, t2, i2);
            this._swapDataView(n3);
          } else if (e2 instanceof Uint8Array || e2 instanceof DataView || e2 instanceof I) {
            void 0 === i2 && (i2 = e2.byteLength - t2), (t2 += e2.byteOffset) + i2 > e2.byteOffset + e2.byteLength && m("Creating view outside of available memory in ArrayBuffer");
            let n3 = new DataView(e2.buffer, t2, i2);
            this._swapDataView(n3);
          } else if ("number" == typeof e2) {
            let t3 = new DataView(new ArrayBuffer(e2));
            this._swapDataView(t3);
          } else m("Invalid input argument for BufferView: " + e2);
        }
        _swapArrayBuffer(e2) {
          this._swapDataView(new DataView(e2));
        }
        _swapBuffer(e2) {
          this._swapDataView(new DataView(e2.buffer, e2.byteOffset, e2.byteLength));
        }
        _swapDataView(e2) {
          this.dataView = e2, this.buffer = e2.buffer, this.byteOffset = e2.byteOffset, this.byteLength = e2.byteLength;
        }
        _lengthToEnd(e2) {
          return this.byteLength - e2;
        }
        set(e2, t2, i2 = I) {
          return e2 instanceof DataView || e2 instanceof I ? e2 = new Uint8Array(e2.buffer, e2.byteOffset, e2.byteLength) : e2 instanceof ArrayBuffer && (e2 = new Uint8Array(e2)), e2 instanceof Uint8Array || m("BufferView.set(): Invalid data argument."), this.toUint8().set(e2, t2), new i2(this, t2, e2.byteLength);
        }
        subarray(e2, t2) {
          return t2 = t2 || this._lengthToEnd(e2), new I(this, e2, t2);
        }
        toUint8() {
          return new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
        }
        getUint8Array(e2, t2) {
          return new Uint8Array(this.buffer, this.byteOffset + e2, t2);
        }
        getString(e2 = 0, t2 = this.byteLength) {
          return P(this.getUint8Array(e2, t2));
        }
        getLatin1String(e2 = 0, t2 = this.byteLength) {
          let i2 = this.getUint8Array(e2, t2);
          return y(i2);
        }
        getUnicodeString(e2 = 0, t2 = this.byteLength) {
          const i2 = [];
          for (let n2 = 0; n2 < t2 && e2 + n2 < this.byteLength; n2 += 2) i2.push(this.getUint16(e2 + n2));
          return y(i2);
        }
        getInt8(e2) {
          return this.dataView.getInt8(e2);
        }
        getUint8(e2) {
          return this.dataView.getUint8(e2);
        }
        getInt16(e2, t2 = this.le) {
          return this.dataView.getInt16(e2, t2);
        }
        getInt32(e2, t2 = this.le) {
          return this.dataView.getInt32(e2, t2);
        }
        getUint16(e2, t2 = this.le) {
          return this.dataView.getUint16(e2, t2);
        }
        getUint32(e2, t2 = this.le) {
          return this.dataView.getUint32(e2, t2);
        }
        getFloat32(e2, t2 = this.le) {
          return this.dataView.getFloat32(e2, t2);
        }
        getFloat64(e2, t2 = this.le) {
          return this.dataView.getFloat64(e2, t2);
        }
        getFloat(e2, t2 = this.le) {
          return this.dataView.getFloat32(e2, t2);
        }
        getDouble(e2, t2 = this.le) {
          return this.dataView.getFloat64(e2, t2);
        }
        getUintBytes(e2, t2, i2) {
          switch (t2) {
            case 1:
              return this.getUint8(e2, i2);
            case 2:
              return this.getUint16(e2, i2);
            case 4:
              return this.getUint32(e2, i2);
            case 8:
              return this.getUint64 && this.getUint64(e2, i2);
          }
        }
        getUint(e2, t2, i2) {
          switch (t2) {
            case 8:
              return this.getUint8(e2, i2);
            case 16:
              return this.getUint16(e2, i2);
            case 32:
              return this.getUint32(e2, i2);
            case 64:
              return this.getUint64 && this.getUint64(e2, i2);
          }
        }
        toString(e2) {
          return this.dataView.toString(e2, this.constructor.name);
        }
        ensureChunk() {
        }
      }
      function k(e2, t2) {
        m(`${e2} '${t2}' was not loaded, try using full build of exifr.`);
      }
      class w extends Map {
        constructor(e2) {
          super(), this.kind = e2;
        }
        get(e2, t2) {
          return this.has(e2) || k(this.kind, e2), t2 && (e2 in t2 || (function(e3, t3) {
            m(`Unknown ${e3} '${t3}'.`);
          })(this.kind, e2), t2[e2].enabled || k(this.kind, e2)), super.get(e2);
        }
        keyList() {
          return Array.from(this.keys());
        }
      }
      var T = new w("file parser"), A = new w("segment parser"), D = new w("file reader");
      const O = "Invalid input argument";
      function x(e2, t2) {
        return "string" == typeof e2 ? v(e2, t2) : i && !n && e2 instanceof HTMLImageElement ? v(e2.src, t2) : e2 instanceof Uint8Array || e2 instanceof ArrayBuffer || e2 instanceof DataView ? new I(e2) : i && e2 instanceof Blob ? M(e2, t2, "blob", U) : void m(O);
      }
      function v(e2, t2) {
        return (n2 = e2).startsWith("data:") || n2.length > 1e4 ? R(e2, t2, "base64") : s && e2.includes("://") ? M(e2, t2, "url", L) : s ? R(e2, t2, "fs") : i ? M(e2, t2, "url", L) : void m(O);
        var n2;
      }
      async function M(e2, t2, i2, n2) {
        return D.has(i2) ? R(e2, t2, i2) : n2 ? (async function(e3, t3) {
          let i3 = await t3(e3);
          return new I(i3);
        })(e2, n2) : void m(`Parser ${i2} is not loaded`);
      }
      async function R(e2, t2, i2) {
        let n2 = new (D.get(i2))(e2, t2);
        return await n2.read(), n2;
      }
      const L = (e2) => u(e2).then(((e3) => e3.arrayBuffer())), U = (e2) => new Promise(((t2, i2) => {
        let n2 = new FileReader();
        n2.onloadend = () => t2(n2.result || new ArrayBuffer()), n2.onerror = i2, n2.readAsArrayBuffer(e2);
      }));
      class F extends Map {
        get tagKeys() {
          return this.allKeys || (this.allKeys = Array.from(this.keys())), this.allKeys;
        }
        get tagValues() {
          return this.allValues || (this.allValues = Array.from(this.values())), this.allValues;
        }
      }
      function B(e2, t2, i2) {
        let n2 = new F();
        for (let [e3, t3] of i2) n2.set(e3, t3);
        if (Array.isArray(t2)) for (let i3 of t2) e2.set(i3, n2);
        else e2.set(t2, n2);
        return n2;
      }
      function E(e2, t2, i2) {
        let n2, s2 = e2.get(t2);
        for (n2 of i2) s2.set(n2[0], n2[1]);
      }
      const N = /* @__PURE__ */ new Map(), G = /* @__PURE__ */ new Map(), V = /* @__PURE__ */ new Map(), z = 37500, H = 37510, j = 700, W = 33723, K = 34675, X = 34665, _ = 34853, Y = 40965, $ = ["chunked", "firstChunkSize", "firstChunkSizeNode", "firstChunkSizeBrowser", "chunkSize", "chunkLimit"], J = ["jfif", "xmp", "icc", "iptc", "ihdr"], q = ["tiff", ...J], Q = ["ifd0", "ifd1", "exif", "gps", "interop"], Z = [...q, ...Q], ee = ["makerNote", "userComment"], te = ["translateKeys", "translateValues", "reviveValues", "multiSegment"], ie = [...te, "sanitize", "mergeOutput", "silentErrors"];
      class ne {
        get translate() {
          return this.translateKeys || this.translateValues || this.reviveValues;
        }
      }
      class se extends ne {
        get needed() {
          return this.enabled || this.deps.size > 0;
        }
        constructor(e2, t2, i2, n2) {
          if (super(), f(this, "enabled", false), f(this, "skip", /* @__PURE__ */ new Set()), f(this, "pick", /* @__PURE__ */ new Set()), f(this, "deps", /* @__PURE__ */ new Set()), f(this, "translateKeys", false), f(this, "translateValues", false), f(this, "reviveValues", false), this.key = e2, this.enabled = t2, this.parse = this.enabled, this.applyInheritables(n2), this.canBeFiltered = Q.includes(e2), this.canBeFiltered && (this.dict = N.get(e2)), void 0 !== i2) if (Array.isArray(i2)) this.parse = this.enabled = true, this.canBeFiltered && i2.length > 0 && this.translateTagSet(i2, this.pick);
          else if ("object" == typeof i2) {
            if (this.enabled = true, this.parse = false !== i2.parse, this.canBeFiltered) {
              let { pick: e3, skip: t3 } = i2;
              e3 && e3.length > 0 && this.translateTagSet(e3, this.pick), t3 && t3.length > 0 && this.translateTagSet(t3, this.skip);
            }
            this.applyInheritables(i2);
          } else true === i2 || false === i2 ? this.parse = this.enabled = i2 : m(`Invalid options argument: ${i2}`);
        }
        applyInheritables(e2) {
          let t2, i2;
          for (t2 of te) i2 = e2[t2], void 0 !== i2 && (this[t2] = i2);
        }
        translateTagSet(e2, t2) {
          if (this.dict) {
            let i2, n2, { tagKeys: s2, tagValues: r2 } = this.dict;
            for (i2 of e2) "string" == typeof i2 ? (n2 = r2.indexOf(i2), -1 === n2 && (n2 = s2.indexOf(Number(i2))), -1 !== n2 && t2.add(Number(s2[n2]))) : t2.add(i2);
          } else for (let i2 of e2) t2.add(i2);
        }
        finalizeFilters() {
          !this.enabled && this.deps.size > 0 ? (this.enabled = true, ue(this.pick, this.deps)) : this.enabled && this.pick.size > 0 && ue(this.pick, this.deps);
        }
      }
      var re = { jfif: false, tiff: true, xmp: false, icc: false, iptc: false, ifd0: true, ifd1: false, exif: true, gps: true, interop: false, ihdr: void 0, makerNote: false, userComment: false, multiSegment: false, skip: [], pick: [], translateKeys: true, translateValues: true, reviveValues: true, sanitize: true, mergeOutput: true, silentErrors: true, chunked: true, firstChunkSize: void 0, firstChunkSizeNode: 512, firstChunkSizeBrowser: 65536, chunkSize: 65536, chunkLimit: 5 }, ae = /* @__PURE__ */ new Map();
      class oe extends ne {
        static useCached(e2) {
          let t2 = ae.get(e2);
          return void 0 !== t2 || (t2 = new this(e2), ae.set(e2, t2)), t2;
        }
        constructor(e2) {
          super(), true === e2 ? this.setupFromTrue() : void 0 === e2 ? this.setupFromUndefined() : Array.isArray(e2) ? this.setupFromArray(e2) : "object" == typeof e2 ? this.setupFromObject(e2) : m(`Invalid options argument ${e2}`), void 0 === this.firstChunkSize && (this.firstChunkSize = i ? this.firstChunkSizeBrowser : this.firstChunkSizeNode), this.mergeOutput && (this.ifd1.enabled = false), this.filterNestedSegmentTags(), this.traverseTiffDependencyTree(), this.checkLoadedPlugins();
        }
        setupFromUndefined() {
          let e2;
          for (e2 of $) this[e2] = re[e2];
          for (e2 of ie) this[e2] = re[e2];
          for (e2 of ee) this[e2] = re[e2];
          for (e2 of Z) this[e2] = new se(e2, re[e2], void 0, this);
        }
        setupFromTrue() {
          let e2;
          for (e2 of $) this[e2] = re[e2];
          for (e2 of ie) this[e2] = re[e2];
          for (e2 of ee) this[e2] = true;
          for (e2 of Z) this[e2] = new se(e2, true, void 0, this);
        }
        setupFromArray(e2) {
          let t2;
          for (t2 of $) this[t2] = re[t2];
          for (t2 of ie) this[t2] = re[t2];
          for (t2 of ee) this[t2] = re[t2];
          for (t2 of Z) this[t2] = new se(t2, false, void 0, this);
          this.setupGlobalFilters(e2, void 0, Q);
        }
        setupFromObject(e2) {
          let t2;
          for (t2 of (Q.ifd0 = Q.ifd0 || Q.image, Q.ifd1 = Q.ifd1 || Q.thumbnail, Object.assign(this, e2), $)) this[t2] = he(e2[t2], re[t2]);
          for (t2 of ie) this[t2] = he(e2[t2], re[t2]);
          for (t2 of ee) this[t2] = he(e2[t2], re[t2]);
          for (t2 of q) this[t2] = new se(t2, re[t2], e2[t2], this);
          for (t2 of Q) this[t2] = new se(t2, re[t2], e2[t2], this.tiff);
          this.setupGlobalFilters(e2.pick, e2.skip, Q, Z), true === e2.tiff ? this.batchEnableWithBool(Q, true) : false === e2.tiff ? this.batchEnableWithUserValue(Q, e2) : Array.isArray(e2.tiff) ? this.setupGlobalFilters(e2.tiff, void 0, Q) : "object" == typeof e2.tiff && this.setupGlobalFilters(e2.tiff.pick, e2.tiff.skip, Q);
        }
        batchEnableWithBool(e2, t2) {
          for (let i2 of e2) this[i2].enabled = t2;
        }
        batchEnableWithUserValue(e2, t2) {
          for (let i2 of e2) {
            let e3 = t2[i2];
            this[i2].enabled = false !== e3 && void 0 !== e3;
          }
        }
        setupGlobalFilters(e2, t2, i2, n2 = i2) {
          if (e2 && e2.length) {
            for (let e3 of n2) this[e3].enabled = false;
            let t3 = le(e2, i2);
            for (let [e3, i3] of t3) ue(this[e3].pick, i3), this[e3].enabled = true;
          } else if (t2 && t2.length) {
            let e3 = le(t2, i2);
            for (let [t3, i3] of e3) ue(this[t3].skip, i3);
          }
        }
        filterNestedSegmentTags() {
          let { ifd0: e2, exif: t2, xmp: i2, iptc: n2, icc: s2 } = this;
          this.makerNote ? t2.deps.add(z) : t2.skip.add(z), this.userComment ? t2.deps.add(H) : t2.skip.add(H), i2.enabled || e2.skip.add(j), n2.enabled || e2.skip.add(W), s2.enabled || e2.skip.add(K);
        }
        traverseTiffDependencyTree() {
          let { ifd0: e2, exif: t2, gps: i2, interop: n2 } = this;
          n2.needed && (t2.deps.add(Y), e2.deps.add(Y)), t2.needed && e2.deps.add(X), i2.needed && e2.deps.add(_), this.tiff.enabled = Q.some(((e3) => true === this[e3].enabled)) || this.makerNote || this.userComment;
          for (let e3 of Q) this[e3].finalizeFilters();
        }
        get onlyTiff() {
          return !J.map(((e2) => this[e2].enabled)).some(((e2) => true === e2)) && this.tiff.enabled;
        }
        checkLoadedPlugins() {
          for (let e2 of q) this[e2].enabled && !A.has(e2) && k("segment parser", e2);
        }
      }
      function le(e2, t2) {
        let i2, n2, s2, r2, a2 = [];
        for (s2 of t2) {
          for (r2 of (i2 = N.get(s2), n2 = [], i2)) (e2.includes(r2[0]) || e2.includes(r2[1])) && n2.push(r2[0]);
          n2.length && a2.push([s2, n2]);
        }
        return a2;
      }
      function he(e2, t2) {
        return void 0 !== e2 ? e2 : void 0 !== t2 ? t2 : void 0;
      }
      function ue(e2, t2) {
        for (let i2 of t2) e2.add(i2);
      }
      f(oe, "default", re);
      class ce {
        constructor(e2) {
          f(this, "parsers", {}), f(this, "output", {}), f(this, "errors", []), f(this, "pushToErrors", ((e3) => this.errors.push(e3))), this.options = oe.useCached(e2);
        }
        async read(e2) {
          this.file = await x(e2, this.options);
        }
        setup() {
          if (this.fileParser) return;
          let { file: e2 } = this, t2 = e2.getUint16(0);
          for (let [i2, n2] of T) if (n2.canHandle(e2, t2)) return this.fileParser = new n2(this.options, this.file, this.parsers), e2[i2] = true;
          this.file.close && this.file.close(), m("Unknown file format");
        }
        async parse() {
          let { output: e2, errors: t2 } = this;
          return this.setup(), this.options.silentErrors ? (await this.executeParsers().catch(this.pushToErrors), t2.push(...this.fileParser.errors)) : await this.executeParsers(), this.file.close && this.file.close(), this.options.silentErrors && t2.length > 0 && (e2.errors = t2), d(e2);
        }
        async executeParsers() {
          let { output: e2 } = this;
          await this.fileParser.parse();
          let t2 = Object.values(this.parsers).map((async (t3) => {
            let i2 = await t3.parse();
            t3.assignToOutput(e2, i2);
          }));
          this.options.silentErrors && (t2 = t2.map(((e3) => e3.catch(this.pushToErrors)))), await Promise.all(t2);
        }
        async extractThumbnail() {
          this.setup();
          let { options: e2, file: t2 } = this, i2 = A.get("tiff", e2);
          var n2;
          if (t2.tiff ? n2 = { start: 0, type: "tiff" } : t2.jpeg && (n2 = await this.fileParser.getOrFindSegment("tiff")), void 0 === n2) return;
          let s2 = await this.fileParser.ensureSegmentChunk(n2), r2 = this.parsers.tiff = new i2(s2, e2, t2), a2 = await r2.extractThumbnail();
          return t2.close && t2.close(), a2;
        }
      }
      async function fe(e2, t2) {
        let i2 = new ce(t2);
        return await i2.read(e2), i2.parse();
      }
      var de = Object.freeze({ __proto__: null, parse: fe, Exifr: ce, fileParsers: T, segmentParsers: A, fileReaders: D, tagKeys: N, tagValues: G, tagRevivers: V, createDictionary: B, extendDictionary: E, fetchUrlAsArrayBuffer: L, readBlobAsArrayBuffer: U, chunkedProps: $, otherSegments: J, segments: q, tiffBlocks: Q, segmentsAndBlocks: Z, tiffExtractables: ee, inheritables: te, allFormatters: ie, Options: oe });
      class pe {
        constructor(e2, t2, i2) {
          f(this, "errors", []), f(this, "ensureSegmentChunk", (async (e3) => {
            let t3 = e3.start, i3 = e3.size || 65536;
            if (this.file.chunked) if (this.file.available(t3, i3)) e3.chunk = this.file.subarray(t3, i3);
            else try {
              e3.chunk = await this.file.readChunk(t3, i3);
            } catch (t4) {
              m(`Couldn't read segment: ${JSON.stringify(e3)}. ${t4.message}`);
            }
            else this.file.byteLength > t3 + i3 ? e3.chunk = this.file.subarray(t3, i3) : void 0 === e3.size ? e3.chunk = this.file.subarray(t3) : m("Segment unreachable: " + JSON.stringify(e3));
            return e3.chunk;
          })), this.extendOptions && this.extendOptions(e2), this.options = e2, this.file = t2, this.parsers = i2;
        }
        injectSegment(e2, t2) {
          this.options[e2].enabled && this.createParser(e2, t2);
        }
        createParser(e2, t2) {
          let i2 = new (A.get(e2))(t2, this.options, this.file);
          return this.parsers[e2] = i2;
        }
        createParsers(e2) {
          for (let t2 of e2) {
            let { type: e3, chunk: i2 } = t2, n2 = this.options[e3];
            if (n2 && n2.enabled) {
              let t3 = this.parsers[e3];
              t3 && t3.append || t3 || this.createParser(e3, i2);
            }
          }
        }
        async readSegments(e2) {
          let t2 = e2.map(this.ensureSegmentChunk);
          await Promise.all(t2);
        }
      }
      class ge {
        static findPosition(e2, t2) {
          let i2 = e2.getUint16(t2 + 2) + 2, n2 = "function" == typeof this.headerLength ? this.headerLength(e2, t2, i2) : this.headerLength, s2 = t2 + n2, r2 = i2 - n2;
          return { offset: t2, length: i2, headerLength: n2, start: s2, size: r2, end: s2 + r2 };
        }
        static parse(e2, t2 = {}) {
          return new this(e2, new oe({ [this.type]: t2 }), e2).parse();
        }
        normalizeInput(e2) {
          return e2 instanceof I ? e2 : new I(e2);
        }
        constructor(e2, t2 = {}, i2) {
          f(this, "errors", []), f(this, "raw", /* @__PURE__ */ new Map()), f(this, "handleError", ((e3) => {
            if (!this.options.silentErrors) throw e3;
            this.errors.push(e3.message);
          })), this.chunk = this.normalizeInput(e2), this.file = i2, this.type = this.constructor.type, this.globalOptions = this.options = t2, this.localOptions = t2[this.type], this.canTranslate = this.localOptions && this.localOptions.translate;
        }
        translate() {
          this.canTranslate && (this.translated = this.translateBlock(this.raw, this.type));
        }
        get output() {
          return this.translated ? this.translated : this.raw ? Object.fromEntries(this.raw) : void 0;
        }
        translateBlock(e2, t2) {
          let i2 = V.get(t2), n2 = G.get(t2), s2 = N.get(t2), r2 = this.options[t2], a2 = r2.reviveValues && !!i2, o2 = r2.translateValues && !!n2, l2 = r2.translateKeys && !!s2, h2 = {};
          for (let [t3, r3] of e2) a2 && i2.has(t3) ? r3 = i2.get(t3)(r3) : o2 && n2.has(t3) && (r3 = this.translateValue(r3, n2.get(t3))), l2 && s2.has(t3) && (t3 = s2.get(t3) || t3), h2[t3] = r3;
          return h2;
        }
        translateValue(e2, t2) {
          return t2[e2] || t2.DEFAULT || e2;
        }
        assignToOutput(e2, t2) {
          this.assignObjectToOutput(e2, this.constructor.type, t2);
        }
        assignObjectToOutput(e2, t2, i2) {
          if (this.globalOptions.mergeOutput) return Object.assign(e2, i2);
          e2[t2] ? Object.assign(e2[t2], i2) : e2[t2] = i2;
        }
      }
      f(ge, "headerLength", 4), f(ge, "type", void 0), f(ge, "multiSegment", false), f(ge, "canHandle", (() => false));
      function me(e2) {
        return 192 === e2 || 194 === e2 || 196 === e2 || 219 === e2 || 221 === e2 || 218 === e2 || 254 === e2;
      }
      function Se(e2) {
        return e2 >= 224 && e2 <= 239;
      }
      function Ce(e2, t2, i2) {
        for (let [n2, s2] of A) if (s2.canHandle(e2, t2, i2)) return n2;
      }
      class ye extends pe {
        constructor(...e2) {
          super(...e2), f(this, "appSegments", []), f(this, "jpegSegments", []), f(this, "unknownSegments", []);
        }
        static canHandle(e2, t2) {
          return 65496 === t2;
        }
        async parse() {
          await this.findAppSegments(), await this.readSegments(this.appSegments), this.mergeMultiSegments(), this.createParsers(this.mergedAppSegments || this.appSegments);
        }
        setupSegmentFinderArgs(e2) {
          true === e2 ? (this.findAll = true, this.wanted = new Set(A.keyList())) : (e2 = void 0 === e2 ? A.keyList().filter(((e3) => this.options[e3].enabled)) : e2.filter(((e3) => this.options[e3].enabled && A.has(e3))), this.findAll = false, this.remaining = new Set(e2), this.wanted = new Set(e2)), this.unfinishedMultiSegment = false;
        }
        async findAppSegments(e2 = 0, t2) {
          this.setupSegmentFinderArgs(t2);
          let { file: i2, findAll: n2, wanted: s2, remaining: r2 } = this;
          if (!n2 && this.file.chunked && (n2 = Array.from(s2).some(((e3) => {
            let t3 = A.get(e3), i3 = this.options[e3];
            return t3.multiSegment && i3.multiSegment;
          })), n2 && await this.file.readWhole()), e2 = this.findAppSegmentsInRange(e2, i2.byteLength), !this.options.onlyTiff && i2.chunked) {
            let t3 = false;
            for (; r2.size > 0 && !t3 && (i2.canReadNextChunk || this.unfinishedMultiSegment); ) {
              let { nextChunkOffset: n3 } = i2, s3 = this.appSegments.some(((e3) => !this.file.available(e3.offset || e3.start, e3.length || e3.size)));
              if (t3 = e2 > n3 && !s3 ? !await i2.readNextChunk(e2) : !await i2.readNextChunk(n3), void 0 === (e2 = this.findAppSegmentsInRange(e2, i2.byteLength))) return;
            }
          }
        }
        findAppSegmentsInRange(e2, t2) {
          t2 -= 2;
          let i2, n2, s2, r2, a2, o2, { file: l2, findAll: h2, wanted: u2, remaining: c2, options: f2 } = this;
          for (; e2 < t2; e2++) if (255 === l2.getUint8(e2)) {
            if (i2 = l2.getUint8(e2 + 1), Se(i2)) {
              if (n2 = l2.getUint16(e2 + 2), s2 = Ce(l2, e2, n2), s2 && u2.has(s2) && (r2 = A.get(s2), a2 = r2.findPosition(l2, e2), o2 = f2[s2], a2.type = s2, this.appSegments.push(a2), !h2 && (r2.multiSegment && o2.multiSegment ? (this.unfinishedMultiSegment = a2.chunkNumber < a2.chunkCount, this.unfinishedMultiSegment || c2.delete(s2)) : c2.delete(s2), 0 === c2.size))) break;
              f2.recordUnknownSegments && (a2 = ge.findPosition(l2, e2), a2.marker = i2, this.unknownSegments.push(a2)), e2 += n2 + 1;
            } else if (me(i2)) {
              if (n2 = l2.getUint16(e2 + 2), 218 === i2 && false !== f2.stopAfterSos) return;
              f2.recordJpegSegments && this.jpegSegments.push({ offset: e2, length: n2, marker: i2 }), e2 += n2 + 1;
            }
          }
          return e2;
        }
        mergeMultiSegments() {
          if (!this.appSegments.some(((e3) => e3.multiSegment))) return;
          let e2 = (function(e3, t2) {
            let i2, n2, s2, r2 = /* @__PURE__ */ new Map();
            for (let a2 = 0; a2 < e3.length; a2++) i2 = e3[a2], n2 = i2[t2], r2.has(n2) ? s2 = r2.get(n2) : r2.set(n2, s2 = []), s2.push(i2);
            return Array.from(r2);
          })(this.appSegments, "type");
          this.mergedAppSegments = e2.map((([e3, t2]) => {
            let i2 = A.get(e3, this.options);
            if (i2.handleMultiSegments) {
              return { type: e3, chunk: i2.handleMultiSegments(t2) };
            }
            return t2[0];
          }));
        }
        getSegment(e2) {
          return this.appSegments.find(((t2) => t2.type === e2));
        }
        async getOrFindSegment(e2) {
          let t2 = this.getSegment(e2);
          return void 0 === t2 && (await this.findAppSegments(0, [e2]), t2 = this.getSegment(e2)), t2;
        }
      }
      f(ye, "type", "jpeg"), T.set("jpeg", ye);
      const be = [void 0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
      class Pe extends ge {
        parseHeader() {
          var e2 = this.chunk.getUint16();
          18761 === e2 ? this.le = true : 19789 === e2 && (this.le = false), this.chunk.le = this.le, this.headerParsed = true;
        }
        parseTags(e2, t2, i2 = /* @__PURE__ */ new Map()) {
          let { pick: n2, skip: s2 } = this.options[t2];
          n2 = new Set(n2);
          let r2 = n2.size > 0, a2 = 0 === s2.size, o2 = this.chunk.getUint16(e2);
          e2 += 2;
          for (let l2 = 0; l2 < o2; l2++) {
            let o3 = this.chunk.getUint16(e2);
            if (r2) {
              if (n2.has(o3) && (i2.set(o3, this.parseTag(e2, o3, t2)), n2.delete(o3), 0 === n2.size)) break;
            } else !a2 && s2.has(o3) || i2.set(o3, this.parseTag(e2, o3, t2));
            e2 += 12;
          }
          return i2;
        }
        parseTag(e2, t2, i2) {
          let { chunk: n2 } = this, s2 = n2.getUint16(e2 + 2), r2 = n2.getUint32(e2 + 4), a2 = be[s2];
          if (a2 * r2 <= 4 ? e2 += 8 : e2 = n2.getUint32(e2 + 8), (s2 < 1 || s2 > 13) && m(`Invalid TIFF value type. block: ${i2.toUpperCase()}, tag: ${t2.toString(16)}, type: ${s2}, offset ${e2}`), e2 > n2.byteLength && m(`Invalid TIFF value offset. block: ${i2.toUpperCase()}, tag: ${t2.toString(16)}, type: ${s2}, offset ${e2} is outside of chunk size ${n2.byteLength}`), 1 === s2) return n2.getUint8Array(e2, r2);
          if (2 === s2) return S2(n2.getString(e2, r2));
          if (7 === s2) return n2.getUint8Array(e2, r2);
          if (1 === r2) return this.parseTagValue(s2, e2);
          {
            let t3 = new ((function(e3) {
              switch (e3) {
                case 1:
                  return Uint8Array;
                case 3:
                  return Uint16Array;
                case 4:
                  return Uint32Array;
                case 5:
                  return Array;
                case 6:
                  return Int8Array;
                case 8:
                  return Int16Array;
                case 9:
                  return Int32Array;
                case 10:
                  return Array;
                case 11:
                  return Float32Array;
                case 12:
                  return Float64Array;
                default:
                  return Array;
              }
            })(s2))(r2), i3 = a2;
            for (let n3 = 0; n3 < r2; n3++) t3[n3] = this.parseTagValue(s2, e2), e2 += i3;
            return t3;
          }
        }
        parseTagValue(e2, t2) {
          let { chunk: i2 } = this;
          switch (e2) {
            case 1:
              return i2.getUint8(t2);
            case 3:
              return i2.getUint16(t2);
            case 4:
              return i2.getUint32(t2);
            case 5:
              return i2.getUint32(t2) / i2.getUint32(t2 + 4);
            case 6:
              return i2.getInt8(t2);
            case 8:
              return i2.getInt16(t2);
            case 9:
              return i2.getInt32(t2);
            case 10:
              return i2.getInt32(t2) / i2.getInt32(t2 + 4);
            case 11:
              return i2.getFloat(t2);
            case 12:
              return i2.getDouble(t2);
            case 13:
              return i2.getUint32(t2);
            default:
              m(`Invalid tiff type ${e2}`);
          }
        }
      }
      class Ie extends Pe {
        static canHandle(e2, t2) {
          return 225 === e2.getUint8(t2 + 1) && 1165519206 === e2.getUint32(t2 + 4) && 0 === e2.getUint16(t2 + 8);
        }
        async parse() {
          this.parseHeader();
          let { options: e2 } = this;
          return e2.ifd0.enabled && await this.parseIfd0Block(), e2.exif.enabled && await this.safeParse("parseExifBlock"), e2.gps.enabled && await this.safeParse("parseGpsBlock"), e2.interop.enabled && await this.safeParse("parseInteropBlock"), e2.ifd1.enabled && await this.safeParse("parseThumbnailBlock"), this.createOutput();
        }
        safeParse(e2) {
          let t2 = this[e2]();
          return void 0 !== t2.catch && (t2 = t2.catch(this.handleError)), t2;
        }
        findIfd0Offset() {
          void 0 === this.ifd0Offset && (this.ifd0Offset = this.chunk.getUint32(4));
        }
        findIfd1Offset() {
          if (void 0 === this.ifd1Offset) {
            this.findIfd0Offset();
            let e2 = this.chunk.getUint16(this.ifd0Offset), t2 = this.ifd0Offset + 2 + 12 * e2;
            this.ifd1Offset = this.chunk.getUint32(t2);
          }
        }
        parseBlock(e2, t2) {
          let i2 = /* @__PURE__ */ new Map();
          return this[t2] = i2, this.parseTags(e2, t2, i2), i2;
        }
        async parseIfd0Block() {
          if (this.ifd0) return;
          let { file: e2 } = this;
          this.findIfd0Offset(), this.ifd0Offset < 8 && m("Malformed EXIF data"), !e2.chunked && this.ifd0Offset > e2.byteLength && m(`IFD0 offset points to outside of file.
this.ifd0Offset: ${this.ifd0Offset}, file.byteLength: ${e2.byteLength}`), e2.tiff && await e2.ensureChunk(this.ifd0Offset, C(this.options));
          let t2 = this.parseBlock(this.ifd0Offset, "ifd0");
          return 0 !== t2.size ? (this.exifOffset = t2.get(X), this.interopOffset = t2.get(Y), this.gpsOffset = t2.get(_), this.xmp = t2.get(j), this.iptc = t2.get(W), this.icc = t2.get(K), this.options.sanitize && (t2.delete(X), t2.delete(Y), t2.delete(_), t2.delete(j), t2.delete(W), t2.delete(K)), t2) : void 0;
        }
        async parseExifBlock() {
          if (this.exif) return;
          if (this.ifd0 || await this.parseIfd0Block(), void 0 === this.exifOffset) return;
          this.file.tiff && await this.file.ensureChunk(this.exifOffset, C(this.options));
          let e2 = this.parseBlock(this.exifOffset, "exif");
          return this.interopOffset || (this.interopOffset = e2.get(Y)), this.makerNote = e2.get(z), this.userComment = e2.get(H), this.options.sanitize && (e2.delete(Y), e2.delete(z), e2.delete(H)), this.unpack(e2, 41728), this.unpack(e2, 41729), e2;
        }
        unpack(e2, t2) {
          let i2 = e2.get(t2);
          i2 && 1 === i2.length && e2.set(t2, i2[0]);
        }
        async parseGpsBlock() {
          if (this.gps) return;
          if (this.ifd0 || await this.parseIfd0Block(), void 0 === this.gpsOffset) return;
          let e2 = this.parseBlock(this.gpsOffset, "gps");
          return e2 && e2.has(2) && e2.has(4) && (e2.set("latitude", ke(...e2.get(2), e2.get(1))), e2.set("longitude", ke(...e2.get(4), e2.get(3)))), e2;
        }
        async parseInteropBlock() {
          if (!this.interop && (this.ifd0 || await this.parseIfd0Block(), void 0 !== this.interopOffset || this.exif || await this.parseExifBlock(), void 0 !== this.interopOffset)) return this.parseBlock(this.interopOffset, "interop");
        }
        async parseThumbnailBlock(e2 = false) {
          if (!this.ifd1 && !this.ifd1Parsed && (!this.options.mergeOutput || e2)) return this.findIfd1Offset(), this.ifd1Offset > 0 && (this.parseBlock(this.ifd1Offset, "ifd1"), this.ifd1Parsed = true), this.ifd1;
        }
        async extractThumbnail() {
          if (this.headerParsed || this.parseHeader(), this.ifd1Parsed || await this.parseThumbnailBlock(true), void 0 === this.ifd1) return;
          let e2 = this.ifd1.get(513), t2 = this.ifd1.get(514);
          return this.chunk.getUint8Array(e2, t2);
        }
        get image() {
          return this.ifd0;
        }
        get thumbnail() {
          return this.ifd1;
        }
        createOutput() {
          let e2, t2, i2, n2 = {};
          for (t2 of Q) if (e2 = this[t2], !g(e2)) if (i2 = this.canTranslate ? this.translateBlock(e2, t2) : Object.fromEntries(e2), this.options.mergeOutput) {
            if ("ifd1" === t2) continue;
            Object.assign(n2, i2);
          } else n2[t2] = i2;
          return this.makerNote && (n2.makerNote = this.makerNote), this.userComment && (n2.userComment = this.userComment), n2;
        }
        assignToOutput(e2, t2) {
          if (this.globalOptions.mergeOutput) Object.assign(e2, t2);
          else for (let [i2, n2] of Object.entries(t2)) this.assignObjectToOutput(e2, i2, n2);
        }
      }
      function ke(e2, t2, i2, n2) {
        var s2 = e2 + t2 / 60 + i2 / 3600;
        return "S" !== n2 && "W" !== n2 || (s2 *= -1), s2;
      }
      f(Ie, "type", "tiff"), f(Ie, "headerLength", 10), A.set("tiff", Ie);
      var we = Object.freeze({ __proto__: null, default: de, Exifr: ce, fileParsers: T, segmentParsers: A, fileReaders: D, tagKeys: N, tagValues: G, tagRevivers: V, createDictionary: B, extendDictionary: E, fetchUrlAsArrayBuffer: L, readBlobAsArrayBuffer: U, chunkedProps: $, otherSegments: J, segments: q, tiffBlocks: Q, segmentsAndBlocks: Z, tiffExtractables: ee, inheritables: te, allFormatters: ie, Options: oe, parse: fe });
      const Te = { ifd0: false, ifd1: false, exif: false, gps: false, interop: false, sanitize: false, reviveValues: true, translateKeys: false, translateValues: false, mergeOutput: false }, Ae = Object.assign({}, Te, { firstChunkSize: 4e4, gps: [1, 2, 3, 4] });
      async function De(e2) {
        let t2 = new ce(Ae);
        await t2.read(e2);
        let i2 = await t2.parse();
        if (i2 && i2.gps) {
          let { latitude: e3, longitude: t3 } = i2.gps;
          return { latitude: e3, longitude: t3 };
        }
      }
      const Oe = Object.assign({}, Te, { tiff: false, ifd1: true, mergeOutput: false });
      async function xe(e2) {
        let t2 = new ce(Oe);
        await t2.read(e2);
        let i2 = await t2.extractThumbnail();
        return i2 && o ? r.from(i2) : i2;
      }
      async function ve(e2) {
        let t2 = await this.thumbnail(e2);
        if (void 0 !== t2) {
          let e3 = new Blob([t2]);
          return URL.createObjectURL(e3);
        }
      }
      const Me = Object.assign({}, Te, { firstChunkSize: 4e4, ifd0: [274] });
      async function Re(e2) {
        let t2 = new ce(Me);
        await t2.read(e2);
        let i2 = await t2.parse();
        if (i2 && i2.ifd0) return i2.ifd0[274];
      }
      const Le = Object.freeze({ 1: { dimensionSwapped: false, scaleX: 1, scaleY: 1, deg: 0, rad: 0 }, 2: { dimensionSwapped: false, scaleX: -1, scaleY: 1, deg: 0, rad: 0 }, 3: { dimensionSwapped: false, scaleX: 1, scaleY: 1, deg: 180, rad: 180 * Math.PI / 180 }, 4: { dimensionSwapped: false, scaleX: -1, scaleY: 1, deg: 180, rad: 180 * Math.PI / 180 }, 5: { dimensionSwapped: true, scaleX: 1, scaleY: -1, deg: 90, rad: 90 * Math.PI / 180 }, 6: { dimensionSwapped: true, scaleX: 1, scaleY: 1, deg: 90, rad: 90 * Math.PI / 180 }, 7: { dimensionSwapped: true, scaleX: 1, scaleY: -1, deg: 270, rad: 270 * Math.PI / 180 }, 8: { dimensionSwapped: true, scaleX: 1, scaleY: 1, deg: 270, rad: 270 * Math.PI / 180 } });
      if (e.rotateCanvas = true, e.rotateCss = true, "object" == typeof navigator) {
        let t2 = navigator.userAgent;
        if (t2.includes("iPad") || t2.includes("iPhone")) {
          let i2 = t2.match(/OS (\d+)_(\d+)/);
          if (i2) {
            let [, t3, n2] = i2, s2 = Number(t3) + 0.1 * Number(n2);
            e.rotateCanvas = s2 < 13.4, e.rotateCss = false;
          }
        } else if (t2.includes("OS X 10")) {
          let [, i2] = t2.match(/OS X 10[_.](\d+)/);
          e.rotateCanvas = e.rotateCss = Number(i2) < 15;
        }
        if (t2.includes("Chrome/")) {
          let [, i2] = t2.match(/Chrome\/(\d+)/);
          e.rotateCanvas = e.rotateCss = Number(i2) < 81;
        } else if (t2.includes("Firefox/")) {
          let [, i2] = t2.match(/Firefox\/(\d+)/);
          e.rotateCanvas = e.rotateCss = Number(i2) < 77;
        }
      }
      async function Ue(t2) {
        let i2 = await Re(t2);
        return Object.assign({ canvas: e.rotateCanvas, css: e.rotateCss }, Le[i2]);
      }
      class Fe extends I {
        constructor(...e2) {
          super(...e2), f(this, "ranges", new Be()), 0 !== this.byteLength && this.ranges.add(0, this.byteLength);
        }
        _tryExtend(e2, t2, i2) {
          if (0 === e2 && 0 === this.byteLength && i2) {
            let e3 = new DataView(i2.buffer || i2, i2.byteOffset, i2.byteLength);
            this._swapDataView(e3);
          } else {
            let i3 = e2 + t2;
            if (i3 > this.byteLength) {
              let { dataView: e3 } = this._extend(i3);
              this._swapDataView(e3);
            }
          }
        }
        _extend(e2) {
          let t2;
          t2 = o ? r.allocUnsafe(e2) : new Uint8Array(e2);
          let i2 = new DataView(t2.buffer, t2.byteOffset, t2.byteLength);
          return t2.set(new Uint8Array(this.buffer, this.byteOffset, this.byteLength), 0), { uintView: t2, dataView: i2 };
        }
        subarray(e2, t2, i2 = false) {
          return t2 = t2 || this._lengthToEnd(e2), i2 && this._tryExtend(e2, t2), this.ranges.add(e2, t2), super.subarray(e2, t2);
        }
        set(e2, t2, i2 = false) {
          i2 && this._tryExtend(t2, e2.byteLength, e2);
          let n2 = super.set(e2, t2);
          return this.ranges.add(t2, n2.byteLength), n2;
        }
        async ensureChunk(e2, t2) {
          this.chunked && (this.ranges.available(e2, t2) || await this.readChunk(e2, t2));
        }
        available(e2, t2) {
          return this.ranges.available(e2, t2);
        }
      }
      class Be {
        constructor() {
          f(this, "list", []);
        }
        get length() {
          return this.list.length;
        }
        add(e2, t2, i2 = 0) {
          let n2 = e2 + t2, s2 = this.list.filter(((t3) => Ee(e2, t3.offset, n2) || Ee(e2, t3.end, n2)));
          if (s2.length > 0) {
            e2 = Math.min(e2, ...s2.map(((e3) => e3.offset))), n2 = Math.max(n2, ...s2.map(((e3) => e3.end))), t2 = n2 - e2;
            let i3 = s2.shift();
            i3.offset = e2, i3.length = t2, i3.end = n2, this.list = this.list.filter(((e3) => !s2.includes(e3)));
          } else this.list.push({ offset: e2, length: t2, end: n2 });
        }
        available(e2, t2) {
          let i2 = e2 + t2;
          return this.list.some(((t3) => t3.offset <= e2 && i2 <= t3.end));
        }
      }
      function Ee(e2, t2, i2) {
        return e2 <= t2 && t2 <= i2;
      }
      class Ne extends Fe {
        constructor(e2, t2) {
          super(0), f(this, "chunksRead", 0), this.input = e2, this.options = t2;
        }
        async readWhole() {
          this.chunked = false, await this.readChunk(this.nextChunkOffset);
        }
        async readChunked() {
          this.chunked = true, await this.readChunk(0, this.options.firstChunkSize);
        }
        async readNextChunk(e2 = this.nextChunkOffset) {
          if (this.fullyRead) return this.chunksRead++, false;
          let t2 = this.options.chunkSize, i2 = await this.readChunk(e2, t2);
          return !!i2 && i2.byteLength === t2;
        }
        async readChunk(e2, t2) {
          if (this.chunksRead++, 0 !== (t2 = this.safeWrapAddress(e2, t2))) return this._readChunk(e2, t2);
        }
        safeWrapAddress(e2, t2) {
          return void 0 !== this.size && e2 + t2 > this.size ? Math.max(0, this.size - e2) : t2;
        }
        get nextChunkOffset() {
          if (0 !== this.ranges.list.length) return this.ranges.list[0].length;
        }
        get canReadNextChunk() {
          return this.chunksRead < this.options.chunkLimit;
        }
        get fullyRead() {
          return void 0 !== this.size && this.nextChunkOffset === this.size;
        }
        read() {
          return this.options.chunked ? this.readChunked() : this.readWhole();
        }
        close() {
        }
      }
      D.set("blob", class extends Ne {
        async readWhole() {
          this.chunked = false;
          let e2 = await U(this.input);
          this._swapArrayBuffer(e2);
        }
        readChunked() {
          return this.chunked = true, this.size = this.input.size, super.readChunked();
        }
        async _readChunk(e2, t2) {
          let i2 = t2 ? e2 + t2 : void 0, n2 = this.input.slice(e2, i2), s2 = await U(n2);
          return this.set(s2, e2, true);
        }
      });
      var Ge = Object.freeze({ __proto__: null, default: we, Exifr: ce, fileParsers: T, segmentParsers: A, fileReaders: D, tagKeys: N, tagValues: G, tagRevivers: V, createDictionary: B, extendDictionary: E, fetchUrlAsArrayBuffer: L, readBlobAsArrayBuffer: U, chunkedProps: $, otherSegments: J, segments: q, tiffBlocks: Q, segmentsAndBlocks: Z, tiffExtractables: ee, inheritables: te, allFormatters: ie, Options: oe, parse: fe, gpsOnlyOptions: Ae, gps: De, thumbnailOnlyOptions: Oe, thumbnail: xe, thumbnailUrl: ve, orientationOnlyOptions: Me, orientation: Re, rotations: Le, get rotateCanvas() {
        return e.rotateCanvas;
      }, get rotateCss() {
        return e.rotateCss;
      }, rotation: Ue });
      D.set("url", class extends Ne {
        async readWhole() {
          this.chunked = false;
          let e2 = await L(this.input);
          e2 instanceof ArrayBuffer ? this._swapArrayBuffer(e2) : e2 instanceof Uint8Array && this._swapBuffer(e2);
        }
        async _readChunk(e2, t2) {
          let i2 = t2 ? e2 + t2 - 1 : void 0, n2 = this.options.httpHeaders || {};
          (e2 || i2) && (n2.range = `bytes=${[e2, i2].join("-")}`);
          let s2 = await u(this.input, { headers: n2 }), r2 = await s2.arrayBuffer(), a2 = r2.byteLength;
          if (416 !== s2.status) return a2 !== t2 && (this.size = e2 + a2), this.set(r2, e2, true);
        }
      });
      I.prototype.getUint64 = function(e2) {
        let t2 = this.getUint32(e2), i2 = this.getUint32(e2 + 4);
        return t2 < 1048575 ? t2 << 32 | i2 : void 0 !== typeof a ? (console.warn("Using BigInt because of type 64uint but JS can only handle 53b numbers."), a(t2) << a(32) | a(i2)) : void m("Trying to read 64b value but JS can only handle 53b numbers.");
      };
      class Ve extends pe {
        parseBoxes(e2 = 0) {
          let t2 = [];
          for (; e2 < this.file.byteLength - 4; ) {
            let i2 = this.parseBoxHead(e2);
            if (t2.push(i2), 0 === i2.length) break;
            e2 += i2.length;
          }
          return t2;
        }
        parseSubBoxes(e2) {
          e2.boxes = this.parseBoxes(e2.start);
        }
        findBox(e2, t2) {
          return void 0 === e2.boxes && this.parseSubBoxes(e2), e2.boxes.find(((e3) => e3.kind === t2));
        }
        parseBoxHead(e2) {
          let t2 = this.file.getUint32(e2), i2 = this.file.getString(e2 + 4, 4), n2 = e2 + 8;
          return 1 === t2 && (t2 = this.file.getUint64(e2 + 8), n2 += 8), { offset: e2, length: t2, kind: i2, start: n2 };
        }
        parseBoxFullHead(e2) {
          if (void 0 !== e2.version) return;
          let t2 = this.file.getUint32(e2.start);
          e2.version = t2 >> 24, e2.start += 4;
        }
      }
      class ze extends Ve {
        static canHandle(e2, t2) {
          if (0 !== t2) return false;
          let i2 = e2.getUint16(2);
          if (i2 > 50) return false;
          let n2 = 16, s2 = [];
          for (; n2 < i2; ) s2.push(e2.getString(n2, 4)), n2 += 4;
          return s2.includes(this.type);
        }
        async parse() {
          let e2 = this.file.getUint32(0), t2 = this.parseBoxHead(e2);
          for (; "meta" !== t2.kind; ) e2 += t2.length, await this.file.ensureChunk(e2, 16), t2 = this.parseBoxHead(e2);
          await this.file.ensureChunk(t2.offset, t2.length), this.parseBoxFullHead(t2), this.parseSubBoxes(t2), this.options.icc.enabled && await this.findIcc(t2), this.options.tiff.enabled && await this.findExif(t2);
        }
        async registerSegment(e2, t2, i2) {
          await this.file.ensureChunk(t2, i2);
          let n2 = this.file.subarray(t2, i2);
          this.createParser(e2, n2);
        }
        async findIcc(e2) {
          let t2 = this.findBox(e2, "iprp");
          if (void 0 === t2) return;
          let i2 = this.findBox(t2, "ipco");
          if (void 0 === i2) return;
          let n2 = this.findBox(i2, "colr");
          void 0 !== n2 && await this.registerSegment("icc", n2.offset + 12, n2.length);
        }
        async findExif(e2) {
          let t2 = this.findBox(e2, "iinf");
          if (void 0 === t2) return;
          let i2 = this.findBox(e2, "iloc");
          if (void 0 === i2) return;
          let n2 = this.findExifLocIdInIinf(t2), s2 = this.findExtentInIloc(i2, n2);
          if (void 0 === s2) return;
          let [r2, a2] = s2;
          await this.file.ensureChunk(r2, a2);
          let o2 = 4 + this.file.getUint32(r2);
          r2 += o2, a2 -= o2, await this.registerSegment("tiff", r2, a2);
        }
        findExifLocIdInIinf(e2) {
          this.parseBoxFullHead(e2);
          let t2, i2, n2, s2, r2 = e2.start, a2 = this.file.getUint16(r2);
          for (r2 += 2; a2--; ) {
            if (t2 = this.parseBoxHead(r2), this.parseBoxFullHead(t2), i2 = t2.start, t2.version >= 2 && (n2 = 3 === t2.version ? 4 : 2, s2 = this.file.getString(i2 + n2 + 2, 4), "Exif" === s2)) return this.file.getUintBytes(i2, n2);
            r2 += t2.length;
          }
        }
        get8bits(e2) {
          let t2 = this.file.getUint8(e2);
          return [t2 >> 4, 15 & t2];
        }
        findExtentInIloc(e2, t2) {
          this.parseBoxFullHead(e2);
          let i2 = e2.start, [n2, s2] = this.get8bits(i2++), [r2, a2] = this.get8bits(i2++), o2 = 2 === e2.version ? 4 : 2, l2 = 1 === e2.version || 2 === e2.version ? 2 : 0, h2 = a2 + n2 + s2, u2 = 2 === e2.version ? 4 : 2, c2 = this.file.getUintBytes(i2, u2);
          for (i2 += u2; c2--; ) {
            let e3 = this.file.getUintBytes(i2, o2);
            i2 += o2 + l2 + 2 + r2;
            let u3 = this.file.getUint16(i2);
            if (i2 += 2, e3 === t2) return u3 > 1 && console.warn("ILOC box has more than one extent but we're only processing one\nPlease create an issue at https://github.com/MikeKovarik/exifr with this file"), [this.file.getUintBytes(i2 + a2, n2), this.file.getUintBytes(i2 + a2 + n2, s2)];
            i2 += u3 * h2;
          }
        }
      }
      class He extends ze {
      }
      f(He, "type", "heic");
      class je extends ze {
      }
      f(je, "type", "avif"), T.set("heic", He), T.set("avif", je), B(N, ["ifd0", "ifd1"], [[256, "ImageWidth"], [257, "ImageHeight"], [258, "BitsPerSample"], [259, "Compression"], [262, "PhotometricInterpretation"], [270, "ImageDescription"], [271, "Make"], [272, "Model"], [273, "StripOffsets"], [274, "Orientation"], [277, "SamplesPerPixel"], [278, "RowsPerStrip"], [279, "StripByteCounts"], [282, "XResolution"], [283, "YResolution"], [284, "PlanarConfiguration"], [296, "ResolutionUnit"], [301, "TransferFunction"], [305, "Software"], [306, "ModifyDate"], [315, "Artist"], [316, "HostComputer"], [317, "Predictor"], [318, "WhitePoint"], [319, "PrimaryChromaticities"], [513, "ThumbnailOffset"], [514, "ThumbnailLength"], [529, "YCbCrCoefficients"], [530, "YCbCrSubSampling"], [531, "YCbCrPositioning"], [532, "ReferenceBlackWhite"], [700, "ApplicationNotes"], [33432, "Copyright"], [33723, "IPTC"], [34665, "ExifIFD"], [34675, "ICC"], [34853, "GpsIFD"], [330, "SubIFD"], [40965, "InteropIFD"], [40091, "XPTitle"], [40092, "XPComment"], [40093, "XPAuthor"], [40094, "XPKeywords"], [40095, "XPSubject"]]), B(N, "exif", [[33434, "ExposureTime"], [33437, "FNumber"], [34850, "ExposureProgram"], [34852, "SpectralSensitivity"], [34855, "ISO"], [34858, "TimeZoneOffset"], [34859, "SelfTimerMode"], [34864, "SensitivityType"], [34865, "StandardOutputSensitivity"], [34866, "RecommendedExposureIndex"], [34867, "ISOSpeed"], [34868, "ISOSpeedLatitudeyyy"], [34869, "ISOSpeedLatitudezzz"], [36864, "ExifVersion"], [36867, "DateTimeOriginal"], [36868, "CreateDate"], [36873, "GooglePlusUploadCode"], [36880, "OffsetTime"], [36881, "OffsetTimeOriginal"], [36882, "OffsetTimeDigitized"], [37121, "ComponentsConfiguration"], [37122, "CompressedBitsPerPixel"], [37377, "ShutterSpeedValue"], [37378, "ApertureValue"], [37379, "BrightnessValue"], [37380, "ExposureCompensation"], [37381, "MaxApertureValue"], [37382, "SubjectDistance"], [37383, "MeteringMode"], [37384, "LightSource"], [37385, "Flash"], [37386, "FocalLength"], [37393, "ImageNumber"], [37394, "SecurityClassification"], [37395, "ImageHistory"], [37396, "SubjectArea"], [37500, "MakerNote"], [37510, "UserComment"], [37520, "SubSecTime"], [37521, "SubSecTimeOriginal"], [37522, "SubSecTimeDigitized"], [37888, "AmbientTemperature"], [37889, "Humidity"], [37890, "Pressure"], [37891, "WaterDepth"], [37892, "Acceleration"], [37893, "CameraElevationAngle"], [40960, "FlashpixVersion"], [40961, "ColorSpace"], [40962, "ExifImageWidth"], [40963, "ExifImageHeight"], [40964, "RelatedSoundFile"], [41483, "FlashEnergy"], [41486, "FocalPlaneXResolution"], [41487, "FocalPlaneYResolution"], [41488, "FocalPlaneResolutionUnit"], [41492, "SubjectLocation"], [41493, "ExposureIndex"], [41495, "SensingMethod"], [41728, "FileSource"], [41729, "SceneType"], [41730, "CFAPattern"], [41985, "CustomRendered"], [41986, "ExposureMode"], [41987, "WhiteBalance"], [41988, "DigitalZoomRatio"], [41989, "FocalLengthIn35mmFormat"], [41990, "SceneCaptureType"], [41991, "GainControl"], [41992, "Contrast"], [41993, "Saturation"], [41994, "Sharpness"], [41996, "SubjectDistanceRange"], [42016, "ImageUniqueID"], [42032, "OwnerName"], [42033, "SerialNumber"], [42034, "LensInfo"], [42035, "LensMake"], [42036, "LensModel"], [42037, "LensSerialNumber"], [42080, "CompositeImage"], [42081, "CompositeImageCount"], [42082, "CompositeImageExposureTimes"], [42240, "Gamma"], [59932, "Padding"], [59933, "OffsetSchema"], [65e3, "OwnerName"], [65001, "SerialNumber"], [65002, "Lens"], [65100, "RawFile"], [65101, "Converter"], [65102, "WhiteBalance"], [65105, "Exposure"], [65106, "Shadows"], [65107, "Brightness"], [65108, "Contrast"], [65109, "Saturation"], [65110, "Sharpness"], [65111, "Smoothness"], [65112, "MoireFilter"], [40965, "InteropIFD"]]), B(N, "gps", [[0, "GPSVersionID"], [1, "GPSLatitudeRef"], [2, "GPSLatitude"], [3, "GPSLongitudeRef"], [4, "GPSLongitude"], [5, "GPSAltitudeRef"], [6, "GPSAltitude"], [7, "GPSTimeStamp"], [8, "GPSSatellites"], [9, "GPSStatus"], [10, "GPSMeasureMode"], [11, "GPSDOP"], [12, "GPSSpeedRef"], [13, "GPSSpeed"], [14, "GPSTrackRef"], [15, "GPSTrack"], [16, "GPSImgDirectionRef"], [17, "GPSImgDirection"], [18, "GPSMapDatum"], [19, "GPSDestLatitudeRef"], [20, "GPSDestLatitude"], [21, "GPSDestLongitudeRef"], [22, "GPSDestLongitude"], [23, "GPSDestBearingRef"], [24, "GPSDestBearing"], [25, "GPSDestDistanceRef"], [26, "GPSDestDistance"], [27, "GPSProcessingMethod"], [28, "GPSAreaInformation"], [29, "GPSDateStamp"], [30, "GPSDifferential"], [31, "GPSHPositioningError"]]), B(G, ["ifd0", "ifd1"], [[274, { 1: "Horizontal (normal)", 2: "Mirror horizontal", 3: "Rotate 180", 4: "Mirror vertical", 5: "Mirror horizontal and rotate 270 CW", 6: "Rotate 90 CW", 7: "Mirror horizontal and rotate 90 CW", 8: "Rotate 270 CW" }], [296, { 1: "None", 2: "inches", 3: "cm" }]]);
      let We = B(G, "exif", [[34850, { 0: "Not defined", 1: "Manual", 2: "Normal program", 3: "Aperture priority", 4: "Shutter priority", 5: "Creative program", 6: "Action program", 7: "Portrait mode", 8: "Landscape mode" }], [37121, { 0: "-", 1: "Y", 2: "Cb", 3: "Cr", 4: "R", 5: "G", 6: "B" }], [37383, { 0: "Unknown", 1: "Average", 2: "CenterWeightedAverage", 3: "Spot", 4: "MultiSpot", 5: "Pattern", 6: "Partial", 255: "Other" }], [37384, { 0: "Unknown", 1: "Daylight", 2: "Fluorescent", 3: "Tungsten (incandescent light)", 4: "Flash", 9: "Fine weather", 10: "Cloudy weather", 11: "Shade", 12: "Daylight fluorescent (D 5700 - 7100K)", 13: "Day white fluorescent (N 4600 - 5400K)", 14: "Cool white fluorescent (W 3900 - 4500K)", 15: "White fluorescent (WW 3200 - 3700K)", 17: "Standard light A", 18: "Standard light B", 19: "Standard light C", 20: "D55", 21: "D65", 22: "D75", 23: "D50", 24: "ISO studio tungsten", 255: "Other" }], [37385, { 0: "Flash did not fire", 1: "Flash fired", 5: "Strobe return light not detected", 7: "Strobe return light detected", 9: "Flash fired, compulsory flash mode", 13: "Flash fired, compulsory flash mode, return light not detected", 15: "Flash fired, compulsory flash mode, return light detected", 16: "Flash did not fire, compulsory flash mode", 24: "Flash did not fire, auto mode", 25: "Flash fired, auto mode", 29: "Flash fired, auto mode, return light not detected", 31: "Flash fired, auto mode, return light detected", 32: "No flash function", 65: "Flash fired, red-eye reduction mode", 69: "Flash fired, red-eye reduction mode, return light not detected", 71: "Flash fired, red-eye reduction mode, return light detected", 73: "Flash fired, compulsory flash mode, red-eye reduction mode", 77: "Flash fired, compulsory flash mode, red-eye reduction mode, return light not detected", 79: "Flash fired, compulsory flash mode, red-eye reduction mode, return light detected", 89: "Flash fired, auto mode, red-eye reduction mode", 93: "Flash fired, auto mode, return light not detected, red-eye reduction mode", 95: "Flash fired, auto mode, return light detected, red-eye reduction mode" }], [41495, { 1: "Not defined", 2: "One-chip color area sensor", 3: "Two-chip color area sensor", 4: "Three-chip color area sensor", 5: "Color sequential area sensor", 7: "Trilinear sensor", 8: "Color sequential linear sensor" }], [41728, { 1: "Film Scanner", 2: "Reflection Print Scanner", 3: "Digital Camera" }], [41729, { 1: "Directly photographed" }], [41985, { 0: "Normal", 1: "Custom", 2: "HDR (no original saved)", 3: "HDR (original saved)", 4: "Original (for HDR)", 6: "Panorama", 7: "Portrait HDR", 8: "Portrait" }], [41986, { 0: "Auto", 1: "Manual", 2: "Auto bracket" }], [41987, { 0: "Auto", 1: "Manual" }], [41990, { 0: "Standard", 1: "Landscape", 2: "Portrait", 3: "Night", 4: "Other" }], [41991, { 0: "None", 1: "Low gain up", 2: "High gain up", 3: "Low gain down", 4: "High gain down" }], [41996, { 0: "Unknown", 1: "Macro", 2: "Close", 3: "Distant" }], [42080, { 0: "Unknown", 1: "Not a Composite Image", 2: "General Composite Image", 3: "Composite Image Captured While Shooting" }]]);
      const Ke = { 1: "No absolute unit of measurement", 2: "Inch", 3: "Centimeter" };
      We.set(37392, Ke), We.set(41488, Ke);
      const Xe = { 0: "Normal", 1: "Low", 2: "High" };
      function _e(e2) {
        return "object" == typeof e2 && void 0 !== e2.length ? e2[0] : e2;
      }
      function Ye(e2) {
        let t2 = Array.from(e2).slice(1);
        return t2[1] > 15 && (t2 = t2.map(((e3) => String.fromCharCode(e3)))), "0" !== t2[2] && 0 !== t2[2] || t2.pop(), t2.join(".");
      }
      function $e(e2) {
        if ("string" == typeof e2) {
          var [t2, i2, n2, s2, r2, a2] = e2.trim().split(/[-: ]/g).map(Number), o2 = new Date(t2, i2 - 1, n2);
          return Number.isNaN(s2) || Number.isNaN(r2) || Number.isNaN(a2) || (o2.setHours(s2), o2.setMinutes(r2), o2.setSeconds(a2)), Number.isNaN(+o2) ? e2 : o2;
        }
      }
      function Je(e2) {
        if ("string" == typeof e2) return e2;
        let t2 = [];
        if (0 === e2[1] && 0 === e2[e2.length - 1]) for (let i2 = 0; i2 < e2.length; i2 += 2) t2.push(qe(e2[i2 + 1], e2[i2]));
        else for (let i2 = 0; i2 < e2.length; i2 += 2) t2.push(qe(e2[i2], e2[i2 + 1]));
        return S2(String.fromCodePoint(...t2));
      }
      function qe(e2, t2) {
        return e2 << 8 | t2;
      }
      We.set(41992, Xe), We.set(41993, Xe), We.set(41994, Xe), B(V, ["ifd0", "ifd1"], [[50827, function(e2) {
        return "string" != typeof e2 ? P(e2) : e2;
      }], [306, $e], [40091, Je], [40092, Je], [40093, Je], [40094, Je], [40095, Je]]), B(V, "exif", [[40960, Ye], [36864, Ye], [36867, $e], [36868, $e], [40962, _e], [40963, _e]]), B(V, "gps", [[0, (e2) => Array.from(e2).join(".")], [7, (e2) => Array.from(e2).join(":")]]);
      const Qe = "http://ns.adobe.com/", Ze = "http://ns.adobe.com/xmp/extension/";
      class et extends ge {
        static canHandle(e2, t2) {
          return 225 === e2.getUint8(t2 + 1) && 1752462448 === e2.getUint32(t2 + 4) && e2.getString(t2 + 4, Qe.length) === Qe;
        }
        static headerLength(e2, t2) {
          return e2.getString(t2 + 4, Ze.length) === Ze ? 79 : 4 + "http://ns.adobe.com/xap/1.0/".length + 1;
        }
        static findPosition(e2, t2) {
          let i2 = super.findPosition(e2, t2);
          return i2.multiSegment = i2.extended = 79 === i2.headerLength, i2.multiSegment ? (i2.chunkCount = e2.getUint8(t2 + 72), i2.chunkNumber = e2.getUint8(t2 + 76), 0 !== e2.getUint8(t2 + 77) && i2.chunkNumber++) : (i2.chunkCount = 1 / 0, i2.chunkNumber = -1), i2;
        }
        static handleMultiSegments(e2) {
          return e2.map(((e3) => e3.chunk.getString())).join("");
        }
        normalizeInput(e2) {
          return "string" == typeof e2 ? e2 : I.from(e2).getString();
        }
        parse(e2 = this.chunk) {
          if (!this.localOptions.parse) return e2;
          e2 = (function(e3) {
            let t3 = {}, i3 = {};
            for (let e4 of ut) t3[e4] = [], i3[e4] = 0;
            return e3.replace(ct, ((e4, n3, s2) => {
              if ("<" === n3) {
                let n4 = ++i3[s2];
                return t3[s2].push(n4), `${e4}#${n4}`;
              }
              return `${e4}#${t3[s2].pop()}`;
            }));
          })(e2);
          let t2 = nt.findAll(e2, "rdf", "Description");
          0 === t2.length && t2.push(new nt("rdf", "Description", void 0, e2));
          let i2, n2 = {};
          for (let e3 of t2) for (let t3 of e3.properties) i2 = ot(t3.ns, n2), st(t3, i2);
          return (function(e3) {
            let t3;
            for (let i3 in e3) t3 = e3[i3] = d(e3[i3]), void 0 === t3 && delete e3[i3];
            return d(e3);
          })(n2);
        }
        assignToOutput(e2, t2) {
          if (this.localOptions.parse) for (let [i2, n2] of Object.entries(t2)) switch (i2) {
            case "tiff":
              this.assignObjectToOutput(e2, "ifd0", n2);
              break;
            case "exif":
              this.assignObjectToOutput(e2, "exif", n2);
              break;
            case "xmlns":
              break;
            default:
              this.assignObjectToOutput(e2, i2, n2);
          }
          else e2.xmp = t2;
        }
      }
      f(et, "type", "xmp"), f(et, "multiSegment", true), A.set("xmp", et);
      class tt {
        static findAll(e2) {
          return lt(e2, /([a-zA-Z0-9-]+):([a-zA-Z0-9-]+)=("[^"]*"|'[^']*')/gm).map(tt.unpackMatch);
        }
        static unpackMatch(e2) {
          let t2 = e2[1], i2 = e2[2], n2 = e2[3].slice(1, -1);
          return n2 = ht(n2), new tt(t2, i2, n2);
        }
        constructor(e2, t2, i2) {
          this.ns = e2, this.name = t2, this.value = i2;
        }
        serialize() {
          return this.value;
        }
      }
      const it = "[\\w\\d-]+";
      class nt {
        static findAll(e2, t2, i2) {
          if (void 0 !== t2 || void 0 !== i2) {
            t2 = t2 || it, i2 = i2 || it;
            var n2 = new RegExp(`<(${t2}):(${i2})(#\\d+)?((\\s+?[\\w\\d-:]+=("[^"]*"|'[^']*'))*\\s*)(\\/>|>([\\s\\S]*?)<\\/\\1:\\2\\3>)`, "gm");
          } else n2 = /<([\w\d-]+):([\w\d-]+)(#\d+)?((\s+?[\w\d-:]+=("[^"]*"|'[^']*'))*\s*)(\/>|>([\s\S]*?)<\/\1:\2\3>)/gm;
          return lt(e2, n2).map(nt.unpackMatch);
        }
        static unpackMatch(e2) {
          let t2 = e2[1], i2 = e2[2], n2 = e2[4], s2 = e2[8];
          return new nt(t2, i2, n2, s2);
        }
        constructor(e2, t2, i2, n2) {
          this.ns = e2, this.name = t2, this.attrString = i2, this.innerXml = n2, this.attrs = tt.findAll(i2), this.children = nt.findAll(n2), this.value = 0 === this.children.length ? ht(n2) : void 0, this.properties = [...this.attrs, ...this.children];
        }
        get isPrimitive() {
          return void 0 !== this.value && 0 === this.attrs.length && 0 === this.children.length;
        }
        get isListContainer() {
          return 1 === this.children.length && this.children[0].isList;
        }
        get isList() {
          let { ns: e2, name: t2 } = this;
          return "rdf" === e2 && ("Seq" === t2 || "Bag" === t2 || "Alt" === t2);
        }
        get isListItem() {
          return "rdf" === this.ns && "li" === this.name;
        }
        serialize() {
          if (0 === this.properties.length && void 0 === this.value) return;
          if (this.isPrimitive) return this.value;
          if (this.isListContainer) return this.children[0].serialize();
          if (this.isList) return at(this.children.map(rt));
          if (this.isListItem && 1 === this.children.length && 0 === this.attrs.length) return this.children[0].serialize();
          let e2 = {};
          for (let t2 of this.properties) st(t2, e2);
          return void 0 !== this.value && (e2.value = this.value), d(e2);
        }
      }
      function st(e2, t2) {
        let i2 = e2.serialize();
        void 0 !== i2 && (t2[e2.name] = i2);
      }
      var rt = (e2) => e2.serialize(), at = (e2) => 1 === e2.length ? e2[0] : e2, ot = (e2, t2) => t2[e2] ? t2[e2] : t2[e2] = {};
      function lt(e2, t2) {
        let i2, n2 = [];
        if (!e2) return n2;
        for (; null !== (i2 = t2.exec(e2)); ) n2.push(i2);
        return n2;
      }
      function ht(e2) {
        if ((function(e3) {
          return null == e3 || "null" === e3 || "undefined" === e3 || "" === e3 || "" === e3.trim();
        })(e2)) return;
        let t2 = Number(e2);
        if (!Number.isNaN(t2)) return t2;
        let i2 = e2.toLowerCase();
        return "true" === i2 || "false" !== i2 && e2.trim();
      }
      const ut = ["rdf:li", "rdf:Seq", "rdf:Bag", "rdf:Alt", "rdf:Description"], ct = new RegExp(`(<|\\/)(${ut.join("|")})`, "g");
      var ft = Object.freeze({ __proto__: null, default: Ge, Exifr: ce, fileParsers: T, segmentParsers: A, fileReaders: D, tagKeys: N, tagValues: G, tagRevivers: V, createDictionary: B, extendDictionary: E, fetchUrlAsArrayBuffer: L, readBlobAsArrayBuffer: U, chunkedProps: $, otherSegments: J, segments: q, tiffBlocks: Q, segmentsAndBlocks: Z, tiffExtractables: ee, inheritables: te, allFormatters: ie, Options: oe, parse: fe, gpsOnlyOptions: Ae, gps: De, thumbnailOnlyOptions: Oe, thumbnail: xe, thumbnailUrl: ve, orientationOnlyOptions: Me, orientation: Re, rotations: Le, get rotateCanvas() {
        return e.rotateCanvas;
      }, get rotateCss() {
        return e.rotateCss;
      }, rotation: Ue });
      const dt = ["xmp", "icc", "iptc", "tiff"], pt = () => {
      };
      async function gt(e2, t2, i2) {
        let n2 = i2[e2];
        return n2.enabled = true, n2.parse = true, A.get(e2).parse(t2, n2);
      }
      let mt = h("fs", ((e2) => e2.promises));
      D.set("fs", class extends Ne {
        async readWhole() {
          this.chunked = false, this.fs = await mt;
          let e2 = await this.fs.readFile(this.input);
          this._swapBuffer(e2);
        }
        async readChunked() {
          this.chunked = true, this.fs = await mt, await this.open(), await this.readChunk(0, this.options.firstChunkSize);
        }
        async open() {
          void 0 === this.fh && (this.fh = await this.fs.open(this.input, "r"), this.size = (await this.fh.stat(this.input)).size);
        }
        async _readChunk(e2, t2) {
          void 0 === this.fh && await this.open(), e2 + t2 > this.size && (t2 = this.size - e2);
          var i2 = this.subarray(e2, t2, true);
          return await this.fh.read(i2.dataView, 0, t2, e2), i2;
        }
        async close() {
          if (this.fh) {
            let e2 = this.fh;
            this.fh = void 0, await e2.close();
          }
        }
      });
      D.set("base64", class extends Ne {
        constructor(...e2) {
          super(...e2), this.input = this.input.replace(/^data:([^;]+);base64,/gim, ""), this.size = this.input.length / 4 * 3, this.input.endsWith("==") ? this.size -= 2 : this.input.endsWith("=") && (this.size -= 1);
        }
        async _readChunk(e2, t2) {
          let i2, n2, s2 = this.input;
          void 0 === e2 ? (e2 = 0, i2 = 0, n2 = 0) : (i2 = 4 * Math.floor(e2 / 3), n2 = e2 - i2 / 4 * 3), void 0 === t2 && (t2 = this.size);
          let a2 = e2 + t2, l2 = i2 + 4 * Math.ceil(a2 / 3);
          s2 = s2.slice(i2, l2);
          let h2 = Math.min(t2, this.size - e2);
          if (o) {
            let t3 = r.from(s2, "base64").slice(n2, n2 + h2);
            return this.set(t3, e2, true);
          }
          {
            let t3 = this.subarray(e2, h2, true), i3 = atob(s2), r2 = t3.toUint8();
            for (let e3 = 0; e3 < h2; e3++) r2[e3] = i3.charCodeAt(n2 + e3);
            return t3;
          }
        }
      });
      class St extends pe {
        static canHandle(e2, t2) {
          return 18761 === t2 || 19789 === t2;
        }
        extendOptions(e2) {
          let { ifd0: t2, xmp: i2, iptc: n2, icc: s2 } = e2;
          i2.enabled && t2.deps.add(j), n2.enabled && t2.deps.add(W), s2.enabled && t2.deps.add(K), t2.finalizeFilters();
        }
        async parse() {
          let { tiff: e2, xmp: t2, iptc: i2, icc: n2 } = this.options;
          if (e2.enabled || t2.enabled || i2.enabled || n2.enabled) {
            let e3 = Math.max(C(this.options), this.options.chunkSize);
            await this.file.ensureChunk(0, e3), this.createParser("tiff", this.file), this.parsers.tiff.parseHeader(), await this.parsers.tiff.parseIfd0Block(), this.adaptTiffPropAsSegment("xmp"), this.adaptTiffPropAsSegment("iptc"), this.adaptTiffPropAsSegment("icc");
          }
        }
        adaptTiffPropAsSegment(e2) {
          if (this.parsers.tiff[e2]) {
            let t2 = this.parsers.tiff[e2];
            this.injectSegment(e2, t2);
          }
        }
      }
      f(St, "type", "tiff"), T.set("tiff", St);
      let Ct = h("zlib");
      const yt = "XML:com.adobe.xmp", bt = "ihdr", Pt = "iccp", It = "text", kt = "itxt", wt = [bt, Pt, It, kt, "exif"];
      class Tt extends pe {
        constructor(...e2) {
          super(...e2), f(this, "catchError", ((e3) => this.errors.push(e3))), f(this, "metaChunks", []), f(this, "unknownChunks", []);
        }
        static canHandle(e2, t2) {
          return 35152 === t2 && 2303741511 === e2.getUint32(0) && 218765834 === e2.getUint32(4);
        }
        async parse() {
          let { file: e2 } = this;
          await this.findPngChunksInRange("\x89PNG\r\n\n".length, e2.byteLength), await this.readSegments(this.metaChunks), this.findIhdr(), this.parseTextChunks(), await this.findExif().catch(this.catchError), await this.findXmp().catch(this.catchError), await this.findIcc().catch(this.catchError);
        }
        async findPngChunksInRange(e2, t2) {
          let { file: i2 } = this;
          for (; e2 < t2; ) {
            let t3 = i2.getUint32(e2), n2 = i2.getUint32(e2 + 4), s2 = i2.getString(e2 + 4, 4).toLowerCase(), r2 = t3 + 4 + 4 + 4, a2 = { type: s2, offset: e2, length: r2, start: e2 + 4 + 4, size: t3, marker: n2 };
            wt.includes(s2) ? this.metaChunks.push(a2) : this.unknownChunks.push(a2), e2 += r2;
          }
        }
        parseTextChunks() {
          let e2 = this.metaChunks.filter(((e3) => e3.type === It));
          for (let t2 of e2) {
            let [e3, i2] = this.file.getString(t2.start, t2.size).split("\0");
            this.injectKeyValToIhdr(e3, i2);
          }
        }
        injectKeyValToIhdr(e2, t2) {
          let i2 = this.parsers.ihdr;
          i2 && i2.raw.set(e2, t2);
        }
        findIhdr() {
          let e2 = this.metaChunks.find(((e3) => e3.type === bt));
          e2 && false !== this.options.ihdr.enabled && this.createParser(bt, e2.chunk);
        }
        async findExif() {
          let e2 = this.metaChunks.find(((e3) => "exif" === e3.type));
          e2 && this.injectSegment("tiff", e2.chunk);
        }
        async findXmp() {
          let e2 = this.metaChunks.filter(((e3) => e3.type === kt));
          for (let t2 of e2) {
            t2.chunk.getString(0, yt.length) === yt && this.injectSegment("xmp", t2.chunk);
          }
        }
        async findIcc() {
          let e2 = this.metaChunks.find(((e3) => e3.type === Pt));
          if (!e2) return;
          let { chunk: t2 } = e2, i2 = t2.getUint8Array(0, 81), n2 = 0;
          for (; n2 < 80 && 0 !== i2[n2]; ) n2++;
          let r2 = n2 + 2, a2 = t2.getString(0, n2);
          if (this.injectKeyValToIhdr("ProfileName", a2), s) {
            let e3 = await Ct, i3 = t2.getUint8Array(r2);
            i3 = e3.inflateSync(i3), this.injectSegment("icc", i3);
          }
        }
      }
      f(Tt, "type", "png"), T.set("png", Tt), B(N, "interop", [[1, "InteropIndex"], [2, "InteropVersion"], [4096, "RelatedImageFileFormat"], [4097, "RelatedImageWidth"], [4098, "RelatedImageHeight"]]), E(N, "ifd0", [[11, "ProcessingSoftware"], [254, "SubfileType"], [255, "OldSubfileType"], [263, "Thresholding"], [264, "CellWidth"], [265, "CellLength"], [266, "FillOrder"], [269, "DocumentName"], [280, "MinSampleValue"], [281, "MaxSampleValue"], [285, "PageName"], [286, "XPosition"], [287, "YPosition"], [290, "GrayResponseUnit"], [297, "PageNumber"], [321, "HalftoneHints"], [322, "TileWidth"], [323, "TileLength"], [332, "InkSet"], [337, "TargetPrinter"], [18246, "Rating"], [18249, "RatingPercent"], [33550, "PixelScale"], [34264, "ModelTransform"], [34377, "PhotoshopSettings"], [50706, "DNGVersion"], [50707, "DNGBackwardVersion"], [50708, "UniqueCameraModel"], [50709, "LocalizedCameraModel"], [50736, "DNGLensInfo"], [50739, "ShadowScale"], [50740, "DNGPrivateData"], [33920, "IntergraphMatrix"], [33922, "ModelTiePoint"], [34118, "SEMInfo"], [34735, "GeoTiffDirectory"], [34736, "GeoTiffDoubleParams"], [34737, "GeoTiffAsciiParams"], [50341, "PrintIM"], [50721, "ColorMatrix1"], [50722, "ColorMatrix2"], [50723, "CameraCalibration1"], [50724, "CameraCalibration2"], [50725, "ReductionMatrix1"], [50726, "ReductionMatrix2"], [50727, "AnalogBalance"], [50728, "AsShotNeutral"], [50729, "AsShotWhiteXY"], [50730, "BaselineExposure"], [50731, "BaselineNoise"], [50732, "BaselineSharpness"], [50734, "LinearResponseLimit"], [50735, "CameraSerialNumber"], [50741, "MakerNoteSafety"], [50778, "CalibrationIlluminant1"], [50779, "CalibrationIlluminant2"], [50781, "RawDataUniqueID"], [50827, "OriginalRawFileName"], [50828, "OriginalRawFileData"], [50831, "AsShotICCProfile"], [50832, "AsShotPreProfileMatrix"], [50833, "CurrentICCProfile"], [50834, "CurrentPreProfileMatrix"], [50879, "ColorimetricReference"], [50885, "SRawType"], [50898, "PanasonicTitle"], [50899, "PanasonicTitle2"], [50931, "CameraCalibrationSig"], [50932, "ProfileCalibrationSig"], [50933, "ProfileIFD"], [50934, "AsShotProfileName"], [50936, "ProfileName"], [50937, "ProfileHueSatMapDims"], [50938, "ProfileHueSatMapData1"], [50939, "ProfileHueSatMapData2"], [50940, "ProfileToneCurve"], [50941, "ProfileEmbedPolicy"], [50942, "ProfileCopyright"], [50964, "ForwardMatrix1"], [50965, "ForwardMatrix2"], [50966, "PreviewApplicationName"], [50967, "PreviewApplicationVersion"], [50968, "PreviewSettingsName"], [50969, "PreviewSettingsDigest"], [50970, "PreviewColorSpace"], [50971, "PreviewDateTime"], [50972, "RawImageDigest"], [50973, "OriginalRawFileDigest"], [50981, "ProfileLookTableDims"], [50982, "ProfileLookTableData"], [51043, "TimeCodes"], [51044, "FrameRate"], [51058, "TStop"], [51081, "ReelName"], [51089, "OriginalDefaultFinalSize"], [51090, "OriginalBestQualitySize"], [51091, "OriginalDefaultCropSize"], [51105, "CameraLabel"], [51107, "ProfileHueSatMapEncoding"], [51108, "ProfileLookTableEncoding"], [51109, "BaselineExposureOffset"], [51110, "DefaultBlackRender"], [51111, "NewRawImageDigest"], [51112, "RawToPreviewGain"]]);
      let At = [[273, "StripOffsets"], [279, "StripByteCounts"], [288, "FreeOffsets"], [289, "FreeByteCounts"], [291, "GrayResponseCurve"], [292, "T4Options"], [293, "T6Options"], [300, "ColorResponseUnit"], [320, "ColorMap"], [324, "TileOffsets"], [325, "TileByteCounts"], [326, "BadFaxLines"], [327, "CleanFaxData"], [328, "ConsecutiveBadFaxLines"], [330, "SubIFD"], [333, "InkNames"], [334, "NumberofInks"], [336, "DotRange"], [338, "ExtraSamples"], [339, "SampleFormat"], [340, "SMinSampleValue"], [341, "SMaxSampleValue"], [342, "TransferRange"], [343, "ClipPath"], [344, "XClipPathUnits"], [345, "YClipPathUnits"], [346, "Indexed"], [347, "JPEGTables"], [351, "OPIProxy"], [400, "GlobalParametersIFD"], [401, "ProfileType"], [402, "FaxProfile"], [403, "CodingMethods"], [404, "VersionYear"], [405, "ModeNumber"], [433, "Decode"], [434, "DefaultImageColor"], [435, "T82Options"], [437, "JPEGTables"], [512, "JPEGProc"], [515, "JPEGRestartInterval"], [517, "JPEGLosslessPredictors"], [518, "JPEGPointTransforms"], [519, "JPEGQTables"], [520, "JPEGDCTables"], [521, "JPEGACTables"], [559, "StripRowCounts"], [999, "USPTOMiscellaneous"], [18247, "XP_DIP_XML"], [18248, "StitchInfo"], [28672, "SonyRawFileType"], [28688, "SonyToneCurve"], [28721, "VignettingCorrection"], [28722, "VignettingCorrParams"], [28724, "ChromaticAberrationCorrection"], [28725, "ChromaticAberrationCorrParams"], [28726, "DistortionCorrection"], [28727, "DistortionCorrParams"], [29895, "SonyCropTopLeft"], [29896, "SonyCropSize"], [32781, "ImageID"], [32931, "WangTag1"], [32932, "WangAnnotation"], [32933, "WangTag3"], [32934, "WangTag4"], [32953, "ImageReferencePoints"], [32954, "RegionXformTackPoint"], [32955, "WarpQuadrilateral"], [32956, "AffineTransformMat"], [32995, "Matteing"], [32996, "DataType"], [32997, "ImageDepth"], [32998, "TileDepth"], [33300, "ImageFullWidth"], [33301, "ImageFullHeight"], [33302, "TextureFormat"], [33303, "WrapModes"], [33304, "FovCot"], [33305, "MatrixWorldToScreen"], [33306, "MatrixWorldToCamera"], [33405, "Model2"], [33421, "CFARepeatPatternDim"], [33422, "CFAPattern2"], [33423, "BatteryLevel"], [33424, "KodakIFD"], [33445, "MDFileTag"], [33446, "MDScalePixel"], [33447, "MDColorTable"], [33448, "MDLabName"], [33449, "MDSampleInfo"], [33450, "MDPrepDate"], [33451, "MDPrepTime"], [33452, "MDFileUnits"], [33589, "AdventScale"], [33590, "AdventRevision"], [33628, "UIC1Tag"], [33629, "UIC2Tag"], [33630, "UIC3Tag"], [33631, "UIC4Tag"], [33918, "IntergraphPacketData"], [33919, "IntergraphFlagRegisters"], [33921, "INGRReserved"], [34016, "Site"], [34017, "ColorSequence"], [34018, "IT8Header"], [34019, "RasterPadding"], [34020, "BitsPerRunLength"], [34021, "BitsPerExtendedRunLength"], [34022, "ColorTable"], [34023, "ImageColorIndicator"], [34024, "BackgroundColorIndicator"], [34025, "ImageColorValue"], [34026, "BackgroundColorValue"], [34027, "PixelIntensityRange"], [34028, "TransparencyIndicator"], [34029, "ColorCharacterization"], [34030, "HCUsage"], [34031, "TrapIndicator"], [34032, "CMYKEquivalent"], [34152, "AFCP_IPTC"], [34232, "PixelMagicJBIGOptions"], [34263, "JPLCartoIFD"], [34306, "WB_GRGBLevels"], [34310, "LeafData"], [34687, "TIFF_FXExtensions"], [34688, "MultiProfiles"], [34689, "SharedData"], [34690, "T88Options"], [34732, "ImageLayer"], [34750, "JBIGOptions"], [34856, "Opto-ElectricConvFactor"], [34857, "Interlace"], [34908, "FaxRecvParams"], [34909, "FaxSubAddress"], [34910, "FaxRecvTime"], [34929, "FedexEDR"], [34954, "LeafSubIFD"], [37387, "FlashEnergy"], [37388, "SpatialFrequencyResponse"], [37389, "Noise"], [37390, "FocalPlaneXResolution"], [37391, "FocalPlaneYResolution"], [37392, "FocalPlaneResolutionUnit"], [37397, "ExposureIndex"], [37398, "TIFF-EPStandardID"], [37399, "SensingMethod"], [37434, "CIP3DataFile"], [37435, "CIP3Sheet"], [37436, "CIP3Side"], [37439, "StoNits"], [37679, "MSDocumentText"], [37680, "MSPropertySetStorage"], [37681, "MSDocumentTextPosition"], [37724, "ImageSourceData"], [40965, "InteropIFD"], [40976, "SamsungRawPointersOffset"], [40977, "SamsungRawPointersLength"], [41217, "SamsungRawByteOrder"], [41218, "SamsungRawUnknown"], [41484, "SpatialFrequencyResponse"], [41485, "Noise"], [41489, "ImageNumber"], [41490, "SecurityClassification"], [41491, "ImageHistory"], [41494, "TIFF-EPStandardID"], [41995, "DeviceSettingDescription"], [42112, "GDALMetadata"], [42113, "GDALNoData"], [44992, "ExpandSoftware"], [44993, "ExpandLens"], [44994, "ExpandFilm"], [44995, "ExpandFilterLens"], [44996, "ExpandScanner"], [44997, "ExpandFlashLamp"], [46275, "HasselbladRawImage"], [48129, "PixelFormat"], [48130, "Transformation"], [48131, "Uncompressed"], [48132, "ImageType"], [48256, "ImageWidth"], [48257, "ImageHeight"], [48258, "WidthResolution"], [48259, "HeightResolution"], [48320, "ImageOffset"], [48321, "ImageByteCount"], [48322, "AlphaOffset"], [48323, "AlphaByteCount"], [48324, "ImageDataDiscard"], [48325, "AlphaDataDiscard"], [50215, "OceScanjobDesc"], [50216, "OceApplicationSelector"], [50217, "OceIDNumber"], [50218, "OceImageLogic"], [50255, "Annotations"], [50459, "HasselbladExif"], [50547, "OriginalFileName"], [50560, "USPTOOriginalContentType"], [50656, "CR2CFAPattern"], [50710, "CFAPlaneColor"], [50711, "CFALayout"], [50712, "LinearizationTable"], [50713, "BlackLevelRepeatDim"], [50714, "BlackLevel"], [50715, "BlackLevelDeltaH"], [50716, "BlackLevelDeltaV"], [50717, "WhiteLevel"], [50718, "DefaultScale"], [50719, "DefaultCropOrigin"], [50720, "DefaultCropSize"], [50733, "BayerGreenSplit"], [50737, "ChromaBlurRadius"], [50738, "AntiAliasStrength"], [50752, "RawImageSegmentation"], [50780, "BestQualityScale"], [50784, "AliasLayerMetadata"], [50829, "ActiveArea"], [50830, "MaskedAreas"], [50935, "NoiseReductionApplied"], [50974, "SubTileBlockSize"], [50975, "RowInterleaveFactor"], [51008, "OpcodeList1"], [51009, "OpcodeList2"], [51022, "OpcodeList3"], [51041, "NoiseProfile"], [51114, "CacheVersion"], [51125, "DefaultUserCrop"], [51157, "NikonNEFInfo"], [65024, "KdcIFD"]];
      E(N, "ifd0", At), E(N, "exif", At), B(G, "gps", [[23, { M: "Magnetic North", T: "True North" }], [25, { K: "Kilometers", M: "Miles", N: "Nautical Miles" }]]);
      class Dt extends ge {
        static canHandle(e2, t2) {
          return 224 === e2.getUint8(t2 + 1) && 1246120262 === e2.getUint32(t2 + 4) && 0 === e2.getUint8(t2 + 8);
        }
        parse() {
          return this.parseTags(), this.translate(), this.output;
        }
        parseTags() {
          this.raw = /* @__PURE__ */ new Map([[0, this.chunk.getUint16(0)], [2, this.chunk.getUint8(2)], [3, this.chunk.getUint16(3)], [5, this.chunk.getUint16(5)], [7, this.chunk.getUint8(7)], [8, this.chunk.getUint8(8)]]);
        }
      }
      f(Dt, "type", "jfif"), f(Dt, "headerLength", 9), A.set("jfif", Dt), B(N, "jfif", [[0, "JFIFVersion"], [2, "ResolutionUnit"], [3, "XResolution"], [5, "YResolution"], [7, "ThumbnailWidth"], [8, "ThumbnailHeight"]]);
      class Ot extends ge {
        parse() {
          return this.parseTags(), this.translate(), this.output;
        }
        parseTags() {
          this.raw = new Map([[0, this.chunk.getUint32(0)], [4, this.chunk.getUint32(4)], [8, this.chunk.getUint8(8)], [9, this.chunk.getUint8(9)], [10, this.chunk.getUint8(10)], [11, this.chunk.getUint8(11)], [12, this.chunk.getUint8(12)], ...Array.from(this.raw)]);
        }
      }
      f(Ot, "type", "ihdr"), A.set("ihdr", Ot), B(N, "ihdr", [[0, "ImageWidth"], [4, "ImageHeight"], [8, "BitDepth"], [9, "ColorType"], [10, "Compression"], [11, "Filter"], [12, "Interlace"]]), B(G, "ihdr", [[9, { 0: "Grayscale", 2: "RGB", 3: "Palette", 4: "Grayscale with Alpha", 6: "RGB with Alpha", DEFAULT: "Unknown" }], [10, { 0: "Deflate/Inflate", DEFAULT: "Unknown" }], [11, { 0: "Adaptive", DEFAULT: "Unknown" }], [12, { 0: "Noninterlaced", 1: "Adam7 Interlace", DEFAULT: "Unknown" }]]);
      const xt = "\0\0\0\0";
      class vt extends ge {
        static canHandle(e2, t2) {
          return 226 === e2.getUint8(t2 + 1) && 1229144927 === e2.getUint32(t2 + 4);
        }
        static findPosition(e2, t2) {
          let i2 = super.findPosition(e2, t2);
          return i2.chunkNumber = e2.getUint8(t2 + 16), i2.chunkCount = e2.getUint8(t2 + 17), i2.multiSegment = i2.chunkCount > 1, i2;
        }
        static handleMultiSegments(e2) {
          return (function(e3) {
            let t2 = (function(e4) {
              let t3 = e4[0].constructor, i2 = 0;
              for (let t4 of e4) i2 += t4.length;
              let n2 = new t3(i2), s2 = 0;
              for (let t4 of e4) n2.set(t4, s2), s2 += t4.length;
              return n2;
            })(e3.map(((e4) => e4.chunk.toUint8())));
            return new I(t2);
          })(e2);
        }
        parse() {
          return this.raw = /* @__PURE__ */ new Map(), this.parseHeader(), this.parseTags(), this.translate(), this.output;
        }
        parseHeader() {
          let { raw: e2 } = this;
          this.chunk.byteLength < 84 && m("ICC header is too short");
          for (let [t2, i2] of Object.entries(Mt)) {
            t2 = parseInt(t2, 10);
            let n2 = i2(this.chunk, t2);
            n2 !== xt && e2.set(t2, n2);
          }
        }
        parseTags() {
          let e2, t2, i2, n2, s2, { raw: r2 } = this, a2 = this.chunk.getUint32(128), o2 = 132, l2 = this.chunk.byteLength;
          for (; a2--; ) {
            if (e2 = this.chunk.getString(o2, 4), t2 = this.chunk.getUint32(o2 + 4), i2 = this.chunk.getUint32(o2 + 8), n2 = this.chunk.getString(t2, 4), t2 + i2 > l2) return void console.warn("reached the end of the first ICC chunk. Enable options.tiff.multiSegment to read all ICC segments.");
            s2 = this.parseTag(n2, t2, i2), void 0 !== s2 && s2 !== xt && r2.set(e2, s2), o2 += 12;
          }
        }
        parseTag(e2, t2, i2) {
          switch (e2) {
            case "desc":
              return this.parseDesc(t2);
            case "mluc":
              return this.parseMluc(t2);
            case "text":
              return this.parseText(t2, i2);
            case "sig ":
              return this.parseSig(t2);
          }
          if (!(t2 + i2 > this.chunk.byteLength)) return this.chunk.getUint8Array(t2, i2);
        }
        parseDesc(e2) {
          let t2 = this.chunk.getUint32(e2 + 8) - 1;
          return S2(this.chunk.getString(e2 + 12, t2));
        }
        parseText(e2, t2) {
          return S2(this.chunk.getString(e2 + 8, t2 - 8));
        }
        parseSig(e2) {
          return S2(this.chunk.getString(e2 + 8, 4));
        }
        parseMluc(e2) {
          let { chunk: t2 } = this, i2 = t2.getUint32(e2 + 8), n2 = t2.getUint32(e2 + 12), s2 = e2 + 16, r2 = [];
          for (let a2 = 0; a2 < i2; a2++) {
            let i3 = t2.getString(s2 + 0, 2), a3 = t2.getString(s2 + 2, 2), o2 = t2.getUint32(s2 + 4), l2 = t2.getUint32(s2 + 8) + e2, h2 = S2(t2.getUnicodeString(l2, o2));
            r2.push({ lang: i3, country: a3, text: h2 }), s2 += n2;
          }
          return 1 === i2 ? r2[0].text : r2;
        }
        translateValue(e2, t2) {
          return "string" == typeof e2 ? t2[e2] || t2[e2.toLowerCase()] || e2 : t2[e2] || e2;
        }
      }
      f(vt, "type", "icc"), f(vt, "multiSegment", true), f(vt, "headerLength", 18);
      const Mt = { 4: Rt, 8: function(e2, t2) {
        return [e2.getUint8(t2), e2.getUint8(t2 + 1) >> 4, e2.getUint8(t2 + 1) % 16].map(((e3) => e3.toString(10))).join(".");
      }, 12: Rt, 16: Rt, 20: Rt, 24: function(e2, t2) {
        const i2 = e2.getUint16(t2), n2 = e2.getUint16(t2 + 2) - 1, s2 = e2.getUint16(t2 + 4), r2 = e2.getUint16(t2 + 6), a2 = e2.getUint16(t2 + 8), o2 = e2.getUint16(t2 + 10);
        return new Date(Date.UTC(i2, n2, s2, r2, a2, o2));
      }, 36: Rt, 40: Rt, 48: Rt, 52: Rt, 64: (e2, t2) => e2.getUint32(t2), 80: Rt };
      function Rt(e2, t2) {
        return S2(e2.getString(t2, 4));
      }
      A.set("icc", vt), B(N, "icc", [[4, "ProfileCMMType"], [8, "ProfileVersion"], [12, "ProfileClass"], [16, "ColorSpaceData"], [20, "ProfileConnectionSpace"], [24, "ProfileDateTime"], [36, "ProfileFileSignature"], [40, "PrimaryPlatform"], [44, "CMMFlags"], [48, "DeviceManufacturer"], [52, "DeviceModel"], [56, "DeviceAttributes"], [64, "RenderingIntent"], [68, "ConnectionSpaceIlluminant"], [80, "ProfileCreator"], [84, "ProfileID"], ["Header", "ProfileHeader"], ["MS00", "WCSProfiles"], ["bTRC", "BlueTRC"], ["bXYZ", "BlueMatrixColumn"], ["bfd", "UCRBG"], ["bkpt", "MediaBlackPoint"], ["calt", "CalibrationDateTime"], ["chad", "ChromaticAdaptation"], ["chrm", "Chromaticity"], ["ciis", "ColorimetricIntentImageState"], ["clot", "ColorantTableOut"], ["clro", "ColorantOrder"], ["clrt", "ColorantTable"], ["cprt", "ProfileCopyright"], ["crdi", "CRDInfo"], ["desc", "ProfileDescription"], ["devs", "DeviceSettings"], ["dmdd", "DeviceModelDesc"], ["dmnd", "DeviceMfgDesc"], ["dscm", "ProfileDescriptionML"], ["fpce", "FocalPlaneColorimetryEstimates"], ["gTRC", "GreenTRC"], ["gXYZ", "GreenMatrixColumn"], ["gamt", "Gamut"], ["kTRC", "GrayTRC"], ["lumi", "Luminance"], ["meas", "Measurement"], ["meta", "Metadata"], ["mmod", "MakeAndModel"], ["ncl2", "NamedColor2"], ["ncol", "NamedColor"], ["ndin", "NativeDisplayInfo"], ["pre0", "Preview0"], ["pre1", "Preview1"], ["pre2", "Preview2"], ["ps2i", "PS2RenderingIntent"], ["ps2s", "PostScript2CSA"], ["psd0", "PostScript2CRD0"], ["psd1", "PostScript2CRD1"], ["psd2", "PostScript2CRD2"], ["psd3", "PostScript2CRD3"], ["pseq", "ProfileSequenceDesc"], ["psid", "ProfileSequenceIdentifier"], ["psvm", "PS2CRDVMSize"], ["rTRC", "RedTRC"], ["rXYZ", "RedMatrixColumn"], ["resp", "OutputResponse"], ["rhoc", "ReflectionHardcopyOrigColorimetry"], ["rig0", "PerceptualRenderingIntentGamut"], ["rig2", "SaturationRenderingIntentGamut"], ["rpoc", "ReflectionPrintOutputColorimetry"], ["sape", "SceneAppearanceEstimates"], ["scoe", "SceneColorimetryEstimates"], ["scrd", "ScreeningDesc"], ["scrn", "Screening"], ["targ", "CharTarget"], ["tech", "Technology"], ["vcgt", "VideoCardGamma"], ["view", "ViewingConditions"], ["vued", "ViewingCondDesc"], ["wtpt", "MediaWhitePoint"]]);
      const Lt = { "4d2p": "Erdt Systems", AAMA: "Aamazing Technologies", ACER: "Acer", ACLT: "Acolyte Color Research", ACTI: "Actix Sytems", ADAR: "Adara Technology", ADBE: "Adobe", ADI: "ADI Systems", AGFA: "Agfa Graphics", ALMD: "Alps Electric", ALPS: "Alps Electric", ALWN: "Alwan Color Expertise", AMTI: "Amiable Technologies", AOC: "AOC International", APAG: "Apago", APPL: "Apple Computer", AST: "AST", "AT&T": "AT&T", BAEL: "BARBIERI electronic", BRCO: "Barco NV", BRKP: "Breakpoint", BROT: "Brother", BULL: "Bull", BUS: "Bus Computer Systems", "C-IT": "C-Itoh", CAMR: "Intel", CANO: "Canon", CARR: "Carroll Touch", CASI: "Casio", CBUS: "Colorbus PL", CEL: "Crossfield", CELx: "Crossfield", CGS: "CGS Publishing Technologies International", CHM: "Rochester Robotics", CIGL: "Colour Imaging Group, London", CITI: "Citizen", CL00: "Candela", CLIQ: "Color IQ", CMCO: "Chromaco", CMiX: "CHROMiX", COLO: "Colorgraphic Communications", COMP: "Compaq", COMp: "Compeq/Focus Technology", CONR: "Conrac Display Products", CORD: "Cordata Technologies", CPQ: "Compaq", CPRO: "ColorPro", CRN: "Cornerstone", CTX: "CTX International", CVIS: "ColorVision", CWC: "Fujitsu Laboratories", DARI: "Darius Technology", DATA: "Dataproducts", DCP: "Dry Creek Photo", DCRC: "Digital Contents Resource Center, Chung-Ang University", DELL: "Dell Computer", DIC: "Dainippon Ink and Chemicals", DICO: "Diconix", DIGI: "Digital", "DL&C": "Digital Light & Color", DPLG: "Doppelganger", DS: "Dainippon Screen", DSOL: "DOOSOL", DUPN: "DuPont", EPSO: "Epson", ESKO: "Esko-Graphics", ETRI: "Electronics and Telecommunications Research Institute", EVER: "Everex Systems", EXAC: "ExactCODE", Eizo: "Eizo", FALC: "Falco Data Products", FF: "Fuji Photo Film", FFEI: "FujiFilm Electronic Imaging", FNRD: "Fnord Software", FORA: "Fora", FORE: "Forefront Technology", FP: "Fujitsu", FPA: "WayTech Development", FUJI: "Fujitsu", FX: "Fuji Xerox", GCC: "GCC Technologies", GGSL: "Global Graphics Software", GMB: "Gretagmacbeth", GMG: "GMG", GOLD: "GoldStar Technology", GOOG: "Google", GPRT: "Giantprint", GTMB: "Gretagmacbeth", GVC: "WayTech Development", GW2K: "Sony", HCI: "HCI", HDM: "Heidelberger Druckmaschinen", HERM: "Hermes", HITA: "Hitachi America", HP: "Hewlett-Packard", HTC: "Hitachi", HiTi: "HiTi Digital", IBM: "IBM", IDNT: "Scitex", IEC: "Hewlett-Packard", IIYA: "Iiyama North America", IKEG: "Ikegami Electronics", IMAG: "Image Systems", IMI: "Ingram Micro", INTC: "Intel", INTL: "N/A (INTL)", INTR: "Intra Electronics", IOCO: "Iocomm International Technology", IPS: "InfoPrint Solutions Company", IRIS: "Scitex", ISL: "Ichikawa Soft Laboratory", ITNL: "N/A (ITNL)", IVM: "IVM", IWAT: "Iwatsu Electric", Idnt: "Scitex", Inca: "Inca Digital Printers", Iris: "Scitex", JPEG: "Joint Photographic Experts Group", JSFT: "Jetsoft Development", JVC: "JVC Information Products", KART: "Scitex", KFC: "KFC Computek Components", KLH: "KLH Computers", KMHD: "Konica Minolta", KNCA: "Konica", KODA: "Kodak", KYOC: "Kyocera", Kart: "Scitex", LCAG: "Leica", LCCD: "Leeds Colour", LDAK: "Left Dakota", LEAD: "Leading Technology", LEXM: "Lexmark International", LINK: "Link Computer", LINO: "Linotronic", LITE: "Lite-On", Leaf: "Leaf", Lino: "Linotronic", MAGC: "Mag Computronic", MAGI: "MAG Innovision", MANN: "Mannesmann", MICN: "Micron Technology", MICR: "Microtek", MICV: "Microvitec", MINO: "Minolta", MITS: "Mitsubishi Electronics America", MITs: "Mitsuba", MNLT: "Minolta", MODG: "Modgraph", MONI: "Monitronix", MONS: "Monaco Systems", MORS: "Morse Technology", MOTI: "Motive Systems", MSFT: "Microsoft", MUTO: "MUTOH INDUSTRIES", Mits: "Mitsubishi Electric", NANA: "NANAO", NEC: "NEC", NEXP: "NexPress Solutions", NISS: "Nissei Sangyo America", NKON: "Nikon", NONE: "none", OCE: "Oce Technologies", OCEC: "OceColor", OKI: "Oki", OKID: "Okidata", OKIP: "Okidata", OLIV: "Olivetti", OLYM: "Olympus", ONYX: "Onyx Graphics", OPTI: "Optiquest", PACK: "Packard Bell", PANA: "Matsushita Electric Industrial", PANT: "Pantone", PBN: "Packard Bell", PFU: "PFU", PHIL: "Philips Consumer Electronics", PNTX: "HOYA", POne: "Phase One A/S", PREM: "Premier Computer Innovations", PRIN: "Princeton Graphic Systems", PRIP: "Princeton Publishing Labs", QLUX: "Hong Kong", QMS: "QMS", QPCD: "QPcard AB", QUAD: "QuadLaser", QUME: "Qume", RADI: "Radius", RDDx: "Integrated Color Solutions", RDG: "Roland DG", REDM: "REDMS Group", RELI: "Relisys", RGMS: "Rolf Gierling Multitools", RICO: "Ricoh", RNLD: "Edmund Ronald", ROYA: "Royal", RPC: "Ricoh Printing Systems", RTL: "Royal Information Electronics", SAMP: "Sampo", SAMS: "Samsung", SANT: "Jaime Santana Pomares", SCIT: "Scitex", SCRN: "Dainippon Screen", SDP: "Scitex", SEC: "Samsung", SEIK: "Seiko Instruments", SEIk: "Seikosha", SGUY: "ScanGuy.com", SHAR: "Sharp Laboratories", SICC: "International Color Consortium", SONY: "Sony", SPCL: "SpectraCal", STAR: "Star", STC: "Sampo Technology", Scit: "Scitex", Sdp: "Scitex", Sony: "Sony", TALO: "Talon Technology", TAND: "Tandy", TATU: "Tatung", TAXA: "TAXAN America", TDS: "Tokyo Denshi Sekei", TECO: "TECO Information Systems", TEGR: "Tegra", TEKT: "Tektronix", TI: "Texas Instruments", TMKR: "TypeMaker", TOSB: "Toshiba", TOSH: "Toshiba", TOTK: "TOTOKU ELECTRIC", TRIU: "Triumph", TSBT: "Toshiba", TTX: "TTX Computer Products", TVM: "TVM Professional Monitor", TW: "TW Casper", ULSX: "Ulead Systems", UNIS: "Unisys", UTZF: "Utz Fehlau & Sohn", VARI: "Varityper", VIEW: "Viewsonic", VISL: "Visual communication", VIVO: "Vivo Mobile Communication", WANG: "Wang", WLBR: "Wilbur Imaging", WTG2: "Ware To Go", WYSE: "WYSE Technology", XERX: "Xerox", XRIT: "X-Rite", ZRAN: "Zoran", Zebr: "Zebra Technologies", appl: "Apple Computer", bICC: "basICColor", berg: "bergdesign", ceyd: "Integrated Color Solutions", clsp: "MacDermid ColorSpan", ds: "Dainippon Screen", dupn: "DuPont", ffei: "FujiFilm Electronic Imaging", flux: "FluxData", iris: "Scitex", kart: "Scitex", lcms: "Little CMS", lino: "Linotronic", none: "none", ob4d: "Erdt Systems", obic: "Medigraph", quby: "Qubyx Sarl", scit: "Scitex", scrn: "Dainippon Screen", sdp: "Scitex", siwi: "SIWI GRAFIKA", yxym: "YxyMaster" }, Ut = { scnr: "Scanner", mntr: "Monitor", prtr: "Printer", link: "Device Link", abst: "Abstract", spac: "Color Space Conversion Profile", nmcl: "Named Color", cenc: "ColorEncodingSpace profile", mid: "MultiplexIdentification profile", mlnk: "MultiplexLink profile", mvis: "MultiplexVisualization profile", nkpf: "Nikon Input Device Profile (NON-STANDARD!)" };
      B(G, "icc", [[4, Lt], [12, Ut], [40, Object.assign({}, Lt, Ut)], [48, Lt], [80, Lt], [64, { 0: "Perceptual", 1: "Relative Colorimetric", 2: "Saturation", 3: "Absolute Colorimetric" }], ["tech", { amd: "Active Matrix Display", crt: "Cathode Ray Tube Display", kpcd: "Photo CD", pmd: "Passive Matrix Display", dcam: "Digital Camera", dcpj: "Digital Cinema Projector", dmpc: "Digital Motion Picture Camera", dsub: "Dye Sublimation Printer", epho: "Electrophotographic Printer", esta: "Electrostatic Printer", flex: "Flexography", fprn: "Film Writer", fscn: "Film Scanner", grav: "Gravure", ijet: "Ink Jet Printer", imgs: "Photo Image Setter", mpfr: "Motion Picture Film Recorder", mpfs: "Motion Picture Film Scanner", offs: "Offset Lithography", pjtv: "Projection Television", rpho: "Photographic Paper Printer", rscn: "Reflective Scanner", silk: "Silkscreen", twax: "Thermal Wax Printer", vidc: "Video Camera", vidm: "Video Monitor" }]]);
      class Ft extends ge {
        static canHandle(e2, t2, i2) {
          return 237 === e2.getUint8(t2 + 1) && "Photoshop" === e2.getString(t2 + 4, 9) && void 0 !== this.containsIptc8bim(e2, t2, i2);
        }
        static headerLength(e2, t2, i2) {
          let n2, s2 = this.containsIptc8bim(e2, t2, i2);
          if (void 0 !== s2) return n2 = e2.getUint8(t2 + s2 + 7), n2 % 2 != 0 && (n2 += 1), 0 === n2 && (n2 = 4), s2 + 8 + n2;
        }
        static containsIptc8bim(e2, t2, i2) {
          for (let n2 = 0; n2 < i2; n2++) if (this.isIptcSegmentHead(e2, t2 + n2)) return n2;
        }
        static isIptcSegmentHead(e2, t2) {
          return 56 === e2.getUint8(t2) && 943868237 === e2.getUint32(t2) && 1028 === e2.getUint16(t2 + 4);
        }
        parse() {
          let { raw: e2 } = this, t2 = this.chunk.byteLength - 1, i2 = false;
          for (let n2 = 0; n2 < t2; n2++) if (28 === this.chunk.getUint8(n2) && 2 === this.chunk.getUint8(n2 + 1)) {
            i2 = true;
            let t3 = this.chunk.getUint16(n2 + 3), s2 = this.chunk.getUint8(n2 + 2), r2 = this.chunk.getLatin1String(n2 + 5, t3);
            e2.set(s2, this.pluralizeValue(e2.get(s2), r2)), n2 += 4 + t3;
          } else if (i2) break;
          return this.translate(), this.output;
        }
        pluralizeValue(e2, t2) {
          return void 0 !== e2 ? e2 instanceof Array ? (e2.push(t2), e2) : [e2, t2] : t2;
        }
      }
      f(Ft, "type", "iptc"), f(Ft, "translateValues", false), f(Ft, "reviveValues", false), A.set("iptc", Ft), B(N, "iptc", [[0, "ApplicationRecordVersion"], [3, "ObjectTypeReference"], [4, "ObjectAttributeReference"], [5, "ObjectName"], [7, "EditStatus"], [8, "EditorialUpdate"], [10, "Urgency"], [12, "SubjectReference"], [15, "Category"], [20, "SupplementalCategories"], [22, "FixtureIdentifier"], [25, "Keywords"], [26, "ContentLocationCode"], [27, "ContentLocationName"], [30, "ReleaseDate"], [35, "ReleaseTime"], [37, "ExpirationDate"], [38, "ExpirationTime"], [40, "SpecialInstructions"], [42, "ActionAdvised"], [45, "ReferenceService"], [47, "ReferenceDate"], [50, "ReferenceNumber"], [55, "DateCreated"], [60, "TimeCreated"], [62, "DigitalCreationDate"], [63, "DigitalCreationTime"], [65, "OriginatingProgram"], [70, "ProgramVersion"], [75, "ObjectCycle"], [80, "Byline"], [85, "BylineTitle"], [90, "City"], [92, "Sublocation"], [95, "State"], [100, "CountryCode"], [101, "Country"], [103, "OriginalTransmissionReference"], [105, "Headline"], [110, "Credit"], [115, "Source"], [116, "CopyrightNotice"], [118, "Contact"], [120, "Caption"], [121, "LocalCaption"], [122, "Writer"], [125, "RasterizedCaption"], [130, "ImageType"], [131, "ImageOrientation"], [135, "LanguageIdentifier"], [150, "AudioType"], [151, "AudioSamplingRate"], [152, "AudioSamplingResolution"], [153, "AudioDuration"], [154, "AudioOutcue"], [184, "JobID"], [185, "MasterDocumentID"], [186, "ShortDocumentID"], [187, "UniqueDocumentID"], [188, "OwnerID"], [200, "ObjectPreviewFileFormat"], [201, "ObjectPreviewFileVersion"], [202, "ObjectPreviewData"], [221, "Prefs"], [225, "ClassifyState"], [228, "SimilarityIndex"], [230, "DocumentNotes"], [231, "DocumentHistory"], [232, "ExifCameraInfo"], [255, "CatalogSets"]]), B(G, "iptc", [[10, { 0: "0 (reserved)", 1: "1 (most urgent)", 2: "2", 3: "3", 4: "4", 5: "5 (normal urgency)", 6: "6", 7: "7", 8: "8 (least urgent)", 9: "9 (user-defined priority)" }], [75, { a: "Morning", b: "Both Morning and Evening", p: "Evening" }], [131, { L: "Landscape", P: "Portrait", S: "Square" }]]), e.Exifr = ce, e.Options = oe, e.allFormatters = ie, e.chunkedProps = $, e.createDictionary = B, e.default = ft, e.extendDictionary = E, e.fetchUrlAsArrayBuffer = L, e.fileParsers = T, e.fileReaders = D, e.gps = De, e.gpsOnlyOptions = Ae, e.inheritables = te, e.orientation = Re, e.orientationOnlyOptions = Me, e.otherSegments = J, e.parse = fe, e.readBlobAsArrayBuffer = U, e.rotation = Ue, e.rotations = Le, e.segmentParsers = A, e.segments = q, e.segmentsAndBlocks = Z, e.sidecar = async function(e2, t2, i2) {
        let n2 = new oe(t2);
        n2.chunked = false, void 0 === i2 && "string" == typeof e2 && (i2 = (function(e3) {
          let t3 = e3.toLowerCase().split(".").pop();
          if (/* @__PURE__ */ (function(e4) {
            return "exif" === e4 || "tiff" === e4 || "tif" === e4;
          })(t3)) return "tiff";
          if (dt.includes(t3)) return t3;
        })(e2));
        let s2 = await x(e2, n2);
        if (i2) {
          if (dt.includes(i2)) return gt(i2, s2, n2);
          m("Invalid segment type");
        } else {
          if ((function(e3) {
            let t3 = e3.getString(0, 50).trim();
            return t3.includes("<?xpacket") || t3.includes("<x:");
          })(s2)) return gt("xmp", s2, n2);
          for (let [e3] of A) {
            if (!dt.includes(e3)) continue;
            let t3 = await gt(e3, s2, n2).catch(pt);
            if (t3) return t3;
          }
          m("Unknown file format");
        }
      }, e.tagKeys = N, e.tagRevivers = V, e.tagValues = G, e.thumbnail = xe, e.thumbnailOnlyOptions = Oe, e.thumbnailUrl = ve, e.tiffBlocks = Q, e.tiffExtractables = ee, Object.defineProperty(e, "__esModule", { value: true });
    }));
  }
});

// src/lib/condition-exif.ts
function isFiniteCoord(n) {
  return typeof n === "number" && Number.isFinite(n);
}
async function parseConditionExif(bytes, fallback = /* @__PURE__ */ new Date()) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (input.byteLength < 12) {
    return {
      takenAt: fallback,
      takenAtSource: "upload",
      gpsLat: null,
      gpsLng: null,
      missingExifTime: true
    };
  }
  try {
    const parsed = await import_exifr.default.parse(input, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "ModifyDate",
        "DateTime",
        "GPSLatitude",
        "GPSLongitude",
        "latitude",
        "longitude"
      ],
      // Keys must be translated: `pick` and the reads below use tag NAMES.
      // With translateKeys:false exifr returns numeric keys, and every photo
      // was filed as "no camera time" with no GPS.
      reviveValues: true,
      gps: true
    });
    const rawTime = parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.ModifyDate ?? parsed?.DateTime ?? null;
    let takenAt = null;
    if (rawTime instanceof Date && !Number.isNaN(rawTime.getTime())) takenAt = rawTime;
    else if (typeof rawTime === "string" || typeof rawTime === "number") {
      const d = new Date(rawTime);
      if (!Number.isNaN(d.getTime())) takenAt = d;
    }
    const lat = isFiniteCoord(parsed?.latitude) ? parsed.latitude : isFiniteCoord(parsed?.GPSLatitude) ? parsed.GPSLatitude : null;
    const lng = isFiniteCoord(parsed?.longitude) ? parsed.longitude : isFiniteCoord(parsed?.GPSLongitude) ? parsed.GPSLongitude : null;
    if (takenAt) {
      return {
        takenAt,
        takenAtSource: "exif",
        gpsLat: lat,
        gpsLng: lng,
        missingExifTime: false
      };
    }
    return {
      takenAt: fallback,
      takenAtSource: "upload",
      gpsLat: lat,
      gpsLng: lng,
      missingExifTime: true
    };
  } catch {
    return {
      takenAt: fallback,
      takenAtSource: "upload",
      gpsLat: null,
      gpsLng: null,
      missingExifTime: true
    };
  }
}
var import_exifr;
var init_condition_exif = __esm({
  "src/lib/condition-exif.ts"() {
    "use strict";
    import_exifr = __toESM(require_full_umd(), 1);
  }
});

// src/lib/trip-media-bucket.ts
var CONDITION_BUCKET_NAME;
var init_trip_media_bucket = __esm({
  "src/lib/trip-media-bucket.ts"() {
    "use strict";
    CONDITION_BUCKET_NAME = "condition-media";
  }
});

// src/lib/trip-media.server.ts
var trip_media_server_exports = {};
__export(trip_media_server_exports, {
  DUPLICATE_MEDIA: () => DUPLICATE_MEDIA,
  SHARE_COPY_MAX_BYTES: () => SHARE_COPY_MAX_BYTES,
  backfillOne: () => backfillOne,
  storeConditionMedia: () => storeConditionMedia
});
async function storeConditionMedia(admin, a) {
  if (!TRIP_MEDIA_TYPES[a.mimeType]) throw new Error("This file type isn't supported");
  const { data: existing, error: dupErr } = await admin.from("condition_media").select("id").eq("storage_bucket", CONDITION_BUCKET_NAME).eq("storage_path", a.path).limit(1);
  if (dupErr) throw new Error("Could not check for an existing copy. Nothing was saved.");
  if ((existing ?? []).length) throw new Error(DUPLICATE_MEDIA);
  let takenAt = null;
  let source = "upload";
  let gpsLat = null;
  let gpsLng = null;
  let sharePath = null;
  const head = await readHead(admin, a.path);
  if (!head) throw new Error("The upload didn't arrive. Nothing was saved.");
  let mime;
  try {
    mime = verifyMagic(a.mimeType, head.bytes);
  } catch (e) {
    await admin.storage.from(CONDITION_BUCKET_NAME).remove([a.path]);
    throw e;
  }
  const kind = TRIP_MEDIA_TYPES[mime];
  const actualSize = head.size ?? a.sizeBytes;
  if (actualSize != null && actualSize > TRIP_MEDIA_MAX_BYTES) {
    await admin.storage.from(CONDITION_BUCKET_NAME).remove([a.path]);
    throw new Error("Larger than 50 MB");
  }
  if (kind === "photo") {
    let full = null;
    if (actualSize != null && actualSize <= SHARE_COPY_MAX_BYTES) {
      const { data: blob, error: dlErr } = await admin.storage.from(CONDITION_BUCKET_NAME).download(a.path);
      if (dlErr || !blob) throw new Error("The upload didn't arrive. Nothing was saved.");
      full = new Uint8Array(await blob.arrayBuffer());
    }
    const exif = await parseConditionExif(full ?? head.bytes, /* @__PURE__ */ new Date());
    if (exif.takenAtSource === "exif" && exif.takenAt) {
      takenAt = exif.takenAt.toISOString();
      source = "exif";
    }
    gpsLat = exif.gpsLat;
    gpsLng = exif.gpsLng;
    if (full) {
      try {
        const copy = buildShareCopy(mime, full);
        full = null;
        if (copy && await shareCopyIsClean(copy)) {
          const sp = shareCopyPath(a.path);
          const up = await admin.storage.from(CONDITION_BUCKET_NAME).upload(sp, copy, { contentType: mime, upsert: false });
          if (!up.error) sharePath = sp;
        }
      } catch {
        sharePath = null;
      }
    }
  }
  const { data: row, error } = await admin.from("condition_media").insert({
    vehicle_id: a.vehicleId,
    rental_id: a.rentalId,
    application_id: a.applicationId,
    inspection_id: a.inspectionId,
    phase: a.phase,
    angle: a.angle,
    media_type: kind,
    storage_bucket: CONDITION_BUCKET_NAME,
    storage_path: a.path,
    share_path: sharePath,
    file_name: a.fileName,
    mime_type: mime,
    size_bytes: actualSize,
    captured_by: a.capturedBy,
    captured_by_role: a.capturedByRole,
    caption: a.caption,
    // Never the upload time dressed up as a capture time: created_at is the
    // upload time, taken_at is the camera's, or null.
    taken_at: takenAt,
    taken_at_source: source,
    gps_lat: gpsLat,
    gps_lng: gpsLng
  }).select("id").single();
  if (error) {
    if (sharePath) await admin.storage.from(CONDITION_BUCKET_NAME).remove([sharePath]);
    throw new Error(error.message);
  }
  return { id: row.id, missingExifTime: source !== "exif", sharePreview: !!sharePath };
}
async function readHead(admin, path) {
  const { data: signed, error } = await admin.storage.from(CONDITION_BUCKET_NAME).createSignedUrl(path, 60);
  if (error || !signed?.signedUrl) return null;
  const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!res.ok) return null;
  const range = res.headers.get("content-range");
  const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length"));
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let got = 0;
  while (got < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    got += value.length;
  }
  await reader.cancel().catch(() => {
  });
  const bytes = new Uint8Array(Math.min(got, HEAD_BYTES));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, bytes.length - o);
    bytes.set(c.subarray(0, take), o);
    o += take;
    if (o >= bytes.length) break;
  }
  return { bytes, size: Number.isFinite(total) && total > 0 ? total : null };
}
async function shareCopyIsClean(copy) {
  try {
    const left = await import_exifr2.default.parse(copy, { gps: true, xmp: true, iptc: true, icc: true });
    return !left || Object.keys(left).length === 0;
  } catch {
    return false;
  }
}
async function backfillOne(admin, r) {
  if (r.storage_bucket !== CONDITION_BUCKET_NAME) return false;
  const head = await readHead(admin, r.storage_path);
  if (!head || head.size == null || head.size > SHARE_COPY_MAX_BYTES) return false;
  const pre = sniffMediaType(head.bytes);
  if (!pre || TRIP_MEDIA_TYPES[pre] !== "photo") return false;
  const { data: blob, error } = await admin.storage.from(r.storage_bucket).download(r.storage_path);
  if (error || !blob) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffMediaType(bytes);
  if (!mime) return false;
  const copy = buildShareCopy(mime, bytes);
  if (!copy || !await shareCopyIsClean(copy)) return false;
  const sp = shareCopyPath(r.storage_path);
  const up = await admin.storage.from(r.storage_bucket).upload(sp, copy, { contentType: mime, upsert: false });
  if (up.error) return false;
  const { error: uErr } = await admin.from("condition_media").update({ share_path: sp }).eq("id", r.id).is("share_path", null);
  return !uErr;
}
var import_exifr2, DUPLICATE_MEDIA, SHARE_COPY_MAX_BYTES, HEAD_BYTES;
var init_trip_media_server = __esm({
  "src/lib/trip-media.server.ts"() {
    "use strict";
    init_condition_exif();
    init_trip_media_bucket();
    import_exifr2 = __toESM(require_full_umd(), 1);
    init_trip_media();
    DUPLICATE_MEDIA = "This upload was already saved. Nothing was added.";
    SHARE_COPY_MAX_BYTES = 20 * 1024 * 1024;
    HEAD_BYTES = 256 * 1024;
  }
});

// src/lib/roles.server.ts
var roles_server_exports = {};
__export(roles_server_exports, {
  TIER_LABELS: () => TIER_LABELS,
  TIER_SUMMARY: () => TIER_SUMMARY,
  getActor: () => getActor,
  requireManager: () => requireManager,
  requireOwner: () => requireOwner,
  requireStaff: () => requireStaff,
  requireTier: () => requireTier
});
async function getActor(userId) {
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: rows2 } = await supabaseAdmin2.from("user_roles").select("role").eq("user_id", userId);
  const roles = (rows2 ?? []).map((r) => String(r.role));
  const role = roles.find((r) => r === "admin") ?? roles.find((r) => r === "team") ?? roles.find((r) => r === "coordinator");
  if (!role) return null;
  let email = null;
  try {
    const { data } = await supabaseAdmin2.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  } catch {
  }
  return { userId, email, role, tier: TIER_BY_ROLE[role] };
}
async function requireTier(userId, minimum) {
  const actor = await getActor(userId);
  if (!actor) throw new Error("Forbidden");
  if (TIER_RANK[actor.tier] < TIER_RANK[minimum]) throw new Error("Forbidden");
  return actor;
}
var requireStaff, requireManager, requireOwner;
var init_roles_server = __esm({
  "src/lib/roles.server.ts"() {
    "use strict";
    init_roles();
    requireStaff = (userId) => requireTier(userId, "coordinator");
    requireManager = (userId) => requireTier(userId, "manager");
    requireOwner = (userId) => requireTier(userId, "owner");
  }
});

// .bookings-actions-build/stub/audit-server.js
var audit_server_exports = {};
__export(audit_server_exports, {
  logAudit: () => logAudit
});
var logAudit;
var init_audit_server = __esm({
  ".bookings-actions-build/stub/audit-server.js"() {
    "use strict";
    logAudit = async (actor, entry) => {
      (globalThis.__fakeSb.audit ??= []).push(entry);
    };
  }
});

// src/lib/driver-preview.server.ts
var driver_preview_server_exports = {};
__export(driver_preview_server_exports, {
  isDriverAccount: () => isDriverAccount,
  portalScope: () => portalScope,
  refuseStaffPortalWrite: () => refuseStaffPortalWrite
});
async function portalScope(context, input, section) {
  const driverId = input?.previewDriverId ?? null;
  if (!driverId) return { supabase: context.supabase, userId: context.userId, preview: false };
  const { requireManager: requireManager2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  const actor = await requireManager2(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const ok = await isDriverAccount(supabaseAdmin2, driverId);
  if (!ok) throw new Error("Driver not found");
  if (section === "dashboard") {
    const { logAudit: logAudit2 } = await Promise.resolve().then(() => (init_audit_server(), audit_server_exports));
    await logAudit2(actor, {
      action: "driver_preview.access",
      summary: "Viewed driver portal in read-only preview",
      entityType: "driver",
      entityId: driverId,
      metadata: { section, context: "experience_selector_driver_preview" }
    });
  }
  return { supabase: supabaseAdmin2, userId: driverId, preview: true };
}
async function isDriverAccount(sb, userId) {
  const [{ data: role }, { data: app }] = await Promise.all([
    sb.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "driver").limit(1).maybeSingle(),
    sb.from("applications").select("id").eq("user_id", userId).limit(1).maybeSingle()
  ]);
  return Boolean(role || app);
}
async function refuseStaffPortalWrite(userId) {
  const { getActor: getActor2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  const actor = await getActor2(userId);
  if (!actor) return;
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data } = await supabaseAdmin2.from("user_roles").select("role").eq("user_id", userId).eq("role", "driver").maybeSingle();
  if (!data) throw new Error("Driver Preview is read-only.");
}
var init_driver_preview_server = __esm({
  "src/lib/driver-preview.server.ts"() {
    "use strict";
  }
});

// .bookings-actions-build/stub/react-start.js
var createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};

// .bookings-actions-build/stub/react-start-server.js
var getRequest = () => ({ headers: /* @__PURE__ */ new Map() });

// .bookings-actions-build/stub/auth-middleware.js
var requireSupabaseAuth = {};

// ../real-rentals/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../real-rentals/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../real-rentals/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../real-rentals/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../real-rentals/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../real-rentals/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../real-rentals/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../real-rentals/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/lib/inspections.functions.ts
init_roles();
init_trip_media();
var CONDITION_BUCKET = "condition-media";
var CONDITION_ANGLES = [
  { key: "front", label: "Front" },
  { key: "rear", label: "Rear" },
  { key: "driver_side", label: "Driver side" },
  { key: "passenger_side", label: "Passenger side" },
  { key: "interior_front", label: "Interior \u2014 front" },
  { key: "interior_rear", label: "Interior \u2014 rear" },
  { key: "odometer", label: "Odometer" },
  { key: "fuel", label: "Fuel gauge" },
  { key: "damage", label: "Damage / defect" },
  { key: "other", label: "Other" }
];
var CONDITION_PHASES = [
  { key: "checkout", label: "Before \u2014 at pickup" },
  { key: "checkin", label: "After \u2014 at return" },
  { key: "damage", label: "Damage report" },
  { key: "other", label: "Other" }
];
var PhaseEnum = external_exports.enum(["checkout", "checkin", "damage", "other"]);
var AngleEnum = external_exports.enum([
  "front",
  "rear",
  "driver_side",
  "passenger_side",
  "interior_front",
  "interior_rear",
  "odometer",
  "fuel",
  "damage",
  "other"
]);
var ResultEnum = external_exports.enum(["pending", "pass", "fail", "na"]);
async function staffTier(supabase2, userId) {
  const { data } = await supabase2.from("user_roles").select("role").eq("user_id", userId);
  return tierFromRoles((data ?? []).map((r) => String(r.role)));
}
async function isStaff(supabase2, userId) {
  return tierAllows(await staffTier(supabase2, userId), "manager");
}
async function canInspect(supabase2, userId) {
  return tierAllows(await staffTier(supabase2, userId), "coordinator");
}
function safeExt(fileName, mime) {
  const fromName = (fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/quicktime": "mov"
  };
  return map[mime] || "bin";
}
async function signMedia(admin, rows2, opts) {
  return Promise.all(
    rows2.map(async (m) => {
      const path = opts.renter ? m.share_path ?? null : m.storage_path;
      const { data: signed } = path ? await admin.storage.from(m.storage_bucket).createSignedUrl(path, 60 * 30) : { data: null };
      const takenAt = m.taken_at ?? m.created_at;
      const source = m.taken_at_source ?? (m.taken_at ? "exif" : "upload");
      return {
        id: m.id,
        vehicle_id: m.vehicle_id,
        rental_id: m.rental_id ?? null,
        phase: m.phase,
        angle: m.angle ?? null,
        media_type: m.media_type ?? "photo",
        caption: m.caption ?? null,
        captured_by_role: m.captured_by_role ?? "staff",
        created_at: m.created_at,
        taken_at: takenAt,
        taken_at_source: source,
        gps_lat: opts.includeGps && m.gps_lat != null ? Number(m.gps_lat) : null,
        gps_lng: opts.includeGps && m.gps_lng != null ? Number(m.gps_lng) : null,
        missing_exif_time: source !== "exif",
        url: signed?.signedUrl ?? null,
        uploaded_at: m.created_at,
        application_id: opts.renter ? null : m.application_id ?? null,
        file_name: opts.renter ? null : m.file_name ?? null,
        mime_type: m.mime_type ?? null
      };
    })
  );
}
async function activeRentalFor(supabase2, userId) {
  const { data } = await supabase2.from("rentals").select("id,vehicle_id,application_id").eq("driver_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}
var createConditionUploadUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    vehicleId: external_exports.string().uuid().optional(),
    fileName: external_exports.string().min(1).max(200),
    mimeType: external_exports.string().min(3).max(120)
  }).parse(d)
).handler(async ({ data, context }) => {
  const operator = await canInspect(context.supabase, context.userId);
  if (!tripMediaType(data.fileName, data.mimeType)) throw new Error("This file type isn't supported");
  let vehicleId = data.vehicleId ?? null;
  let folder;
  if (!operator) {
    const rental = await activeRentalFor(context.supabase, context.userId);
    if (!rental?.vehicle_id) throw new Error("No active rental on file");
    vehicleId = rental.vehicle_id;
    folder = `${vehicleId}/rental/${rental.id}`;
  } else {
    if (!vehicleId) throw new Error("Missing vehicle");
    folder = vehicleId;
  }
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const path = `${folder}/${crypto.randomUUID()}.${safeExt(data.fileName, data.mimeType)}`;
  const { data: signed, error } = await supabaseAdmin2.storage.from(CONDITION_BUCKET).createSignedUploadUrl(path);
  if (error || !signed) throw new Error(error?.message || "Could not start upload");
  return { path: signed.path, token: signed.token, bucket: CONDITION_BUCKET, vehicleId };
});
var confirmConditionUpload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    vehicleId: external_exports.string().uuid(),
    rentalId: external_exports.string().uuid().nullable().optional(),
    inspectionId: external_exports.string().uuid().nullable().optional(),
    phase: PhaseEnum,
    angle: AngleEnum.optional().nullable(),
    path: external_exports.string().min(3).max(400),
    fileName: external_exports.string().max(200).optional(),
    mimeType: external_exports.string().max(120).optional(),
    sizeBytes: external_exports.number().int().nonnegative().optional(),
    caption: external_exports.string().max(200).optional().nullable()
  }).parse(d)
).handler(async ({ data, context }) => {
  const operator = await canInspect(context.supabase, context.userId);
  const mime = tripMediaType(data.fileName ?? data.path, data.mimeType);
  if (!mime) throw new Error("This file type isn't supported");
  let rentalId = data.rentalId ?? null;
  let applicationId = null;
  if (!operator) {
    const rental = await activeRentalFor(context.supabase, context.userId);
    if (!rental || rental.vehicle_id !== data.vehicleId) throw new Error("Forbidden");
    rentalId = rental.id;
    applicationId = rental.application_id ?? null;
    if (!data.path.startsWith(`${data.vehicleId}/rental/${rentalId}/`)) throw new Error("Invalid upload path");
  }
  if (!data.path.startsWith(`${data.vehicleId}/`)) throw new Error("Invalid upload path");
  if (data.path.startsWith(`${data.vehicleId}/trip/`)) throw new Error("Invalid upload path");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { storeConditionMedia: storeConditionMedia2 } = await Promise.resolve().then(() => (init_trip_media_server(), trip_media_server_exports));
  const saved = await storeConditionMedia2(supabaseAdmin2, {
    vehicleId: data.vehicleId,
    rentalId,
    applicationId,
    inspectionId: operator ? data.inspectionId ?? null : null,
    phase: data.phase,
    angle: data.angle ?? null,
    path: data.path,
    fileName: data.fileName ?? null,
    mimeType: mime,
    sizeBytes: data.sizeBytes ?? null,
    caption: data.caption ?? null,
    capturedBy: context.userId,
    capturedByRole: operator ? "staff" : "driver"
  });
  return { ok: true, missingExifTime: saved.missingExifTime };
});
var listConditionMedia = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({ vehicleId: external_exports.string().uuid().optional(), rentalId: external_exports.string().uuid().optional() }).parse(d ?? {})
).handler(async ({ data, context }) => {
  const operator = await canInspect(context.supabase, context.userId);
  let vehicleId = data.vehicleId ?? null;
  let renterRental = null;
  if (!operator) {
    const rental = await activeRentalFor(context.supabase, context.userId);
    if (!rental?.vehicle_id) return [];
    vehicleId = rental.vehicle_id;
    renterRental = rental.id;
  }
  if (!vehicleId) return [];
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  let q = supabaseAdmin2.from("condition_media").select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(200);
  if (renterRental) q = q.eq("rental_id", renterRental);
  else if (data.rentalId) q = q.eq("rental_id", data.rentalId);
  const { data: rows2 } = await q;
  return signMedia(supabaseAdmin2, rows2 ?? [], { includeGps: !!operator, renter: !operator });
});
var deleteConditionMedia = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  if (!await isStaff(context.supabase, context.userId)) throw new Error("Forbidden");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: row } = await supabaseAdmin2.from("condition_media").select("id,storage_bucket,storage_path,share_path").eq("id", data.id).maybeSingle();
  if (row) {
    await supabaseAdmin2.storage.from(row.storage_bucket).remove([row.storage_path, ...row.share_path ? [row.share_path] : []]);
    await supabaseAdmin2.from("condition_media").delete().eq("id", data.id);
  }
  return { ok: true };
});
var startInspection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    vehicleId: external_exports.string().uuid(),
    templateId: external_exports.string().uuid(),
    rentalId: external_exports.string().uuid().nullable().optional(),
    odometer: external_exports.number().int().nonnegative().nullable().optional()
  }).parse(d)
).handler(async ({ data, context }) => {
  if (!await canInspect(context.supabase, context.userId)) throw new Error("Forbidden");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: vehicle } = await supabaseAdmin2.from("vehicles").select("id,archived_at").eq("id", data.vehicleId).maybeSingle();
  if (!vehicle) throw new Error("That vehicle no longer exists.");
  if (vehicle.archived_at)
    throw new Error("That vehicle is archived \u2014 restore it before inspecting it.");
  const { data: template } = await supabaseAdmin2.from("inspection_templates").select("id,inspection_type").eq("id", data.templateId).maybeSingle();
  if (!template) throw new Error("Template not found");
  let rentalId = data.rentalId ?? null;
  if (!rentalId) {
    const { data: live } = await supabaseAdmin2.from("rentals").select("id").eq("vehicle_id", data.vehicleId).eq("status", "active").maybeSingle();
    rentalId = live?.id ?? null;
  }
  const { data: inspection, error } = await supabaseAdmin2.from("inspections").insert({
    vehicle_id: data.vehicleId,
    rental_id: rentalId,
    template_id: template.id,
    inspection_type: template.inspection_type,
    status: "in_progress",
    odometer: data.odometer ?? null,
    inspector_id: context.userId,
    inspector_name: context.claims?.email ?? null
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { data: templateItems } = await supabaseAdmin2.from("inspection_template_items").select("section,label,requires_photo,is_critical,sort_order").eq("template_id", template.id).order("sort_order");
  if (templateItems?.length) {
    const { error: itemsErr } = await supabaseAdmin2.from("inspection_items").insert(
      templateItems.map((t) => ({
        inspection_id: inspection.id,
        section: t.section,
        label: t.label,
        requires_photo: t.requires_photo,
        is_critical: t.is_critical,
        sort_order: t.sort_order,
        result: "pending"
      }))
    );
    if (itemsErr) throw new Error(itemsErr.message);
  }
  return { id: inspection.id };
});
var getInspection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  const operator = await canInspect(context.supabase, context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: inspection } = await supabaseAdmin2.from("inspections").select("*").eq("id", data.id).maybeSingle();
  if (!inspection) throw new Error("Inspection not found");
  if (!operator) {
    const rental = await activeRentalFor(context.supabase, context.userId);
    if (!rental || rental.vehicle_id !== inspection.vehicle_id) throw new Error("Forbidden");
  }
  const [{ data: items }, { data: media }] = await Promise.all([
    supabaseAdmin2.from("inspection_items").select("*").eq("inspection_id", data.id).order("sort_order"),
    supabaseAdmin2.from("condition_media").select("*").eq("inspection_id", data.id).order("created_at")
  ]);
  return {
    id: inspection.id,
    vehicle_id: inspection.vehicle_id,
    rental_id: inspection.rental_id ?? null,
    inspection_type: inspection.inspection_type,
    status: inspection.status,
    odometer: inspection.odometer ?? null,
    fuel_level: inspection.fuel_level ?? null,
    exterior_notes: inspection.exterior_notes ?? null,
    interior_notes: inspection.interior_notes ?? null,
    notes: inspection.notes ?? null,
    inspector_name: inspection.inspector_name ?? null,
    started_at: inspection.started_at,
    completed_at: inspection.completed_at ?? null,
    driver_signature_name: inspection.driver_signature_name ?? null,
    driver_signed_at: inspection.driver_signed_at ?? null,
    driver_notes: inspection.driver_notes ?? null,
    items: items ?? [],
    media: await signMedia(supabaseAdmin2, media ?? [], { includeGps: true })
  };
});
var setInspectionItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    itemId: external_exports.string().uuid(),
    result: ResultEnum.optional(),
    notes: external_exports.string().max(500).nullable().optional()
  }).parse(d)
).handler(async ({ data, context }) => {
  if (!await canInspect(context.supabase, context.userId)) throw new Error("Forbidden");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const patch = {};
  if (data.result !== void 0) patch.result = data.result;
  if (data.notes !== void 0) patch.notes = data.notes;
  const { error } = await supabaseAdmin2.from("inspection_items").update(patch).eq("id", data.itemId);
  if (error) throw new Error(error.message);
  return { ok: true };
});
var updateInspection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    id: external_exports.string().uuid(),
    odometer: external_exports.number().int().nonnegative().nullable().optional(),
    fuelLevel: external_exports.enum(["empty", "quarter", "half", "three_quarter", "full"]).nullable().optional(),
    exteriorNotes: external_exports.string().max(2e3).nullable().optional(),
    interiorNotes: external_exports.string().max(2e3).nullable().optional(),
    notes: external_exports.string().max(2e3).nullable().optional()
  }).parse(d)
).handler(async ({ data, context }) => {
  if (!await canInspect(context.supabase, context.userId)) throw new Error("Forbidden");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const patch = {};
  if (data.odometer !== void 0) patch.odometer = data.odometer;
  if (data.fuelLevel !== void 0) patch.fuel_level = data.fuelLevel;
  if (data.exteriorNotes !== void 0) patch.exterior_notes = data.exteriorNotes;
  if (data.interiorNotes !== void 0) patch.interior_notes = data.interiorNotes;
  if (data.notes !== void 0) patch.notes = data.notes;
  const { error } = await supabaseAdmin2.from("inspections").update(patch).eq("id", data.id);
  if (error) throw new Error(error.message);
  return { ok: true };
});
var completeInspection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  if (!await canInspect(context.supabase, context.userId)) throw new Error("Forbidden");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: items } = await supabaseAdmin2.from("inspection_items").select("label,result,is_critical").eq("inspection_id", data.id);
  const incomplete = (items ?? []).filter((i) => i.result === "pending").map((i) => i.label);
  if (incomplete.length) {
    return { ok: false, status: "in_progress", blockedBy: [], incomplete };
  }
  const blockedBy = (items ?? []).filter((i) => i.is_critical && i.result === "fail").map((i) => i.label);
  const status = blockedBy.length ? "failed" : "passed";
  const { error } = await supabaseAdmin2.from("inspections").update({ status, completed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", data.id);
  if (error) throw new Error(error.message);
  if (status === "failed") {
    const { data: inspection } = await supabaseAdmin2.from("inspections").select("vehicle_id,inspection_type").eq("id", data.id).maybeSingle();
    if (inspection?.vehicle_id) {
      await supabaseAdmin2.from("vehicles").update({ status: "maintenance" }).eq("id", inspection.vehicle_id);
    }
  }
  return { ok: true, status, blockedBy, incomplete: [] };
});
var getMyCheckoutInspection = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const rental = await activeRentalFor(context.supabase, context.userId);
  if (!rental?.vehicle_id) return null;
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: inspection } = await supabaseAdmin2.from("inspections").select("*").eq("vehicle_id", rental.vehicle_id).eq("inspection_type", "pre_delivery").eq("status", "passed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (!inspection) return null;
  const [{ data: items }, { data: media }, { data: vehicle }] = await Promise.all([
    supabaseAdmin2.from("inspection_items").select("section,label,result,notes").eq("inspection_id", inspection.id).order("sort_order"),
    // This rental's pickup, or the pre-delivery inspection being signed —
    // never another renter's pickup on the same car. Two reads, merged,
    // rather than an interpolated .or() filter.
    Promise.all([
      supabaseAdmin2.from("condition_media").select("*").eq("vehicle_id", rental.vehicle_id).eq("phase", "checkout").eq("rental_id", rental.id),
      supabaseAdmin2.from("condition_media").select("*").eq("vehicle_id", rental.vehicle_id).eq("phase", "checkout").eq("inspection_id", inspection.id)
    ]).then(([a, b]) => {
      const seen = /* @__PURE__ */ new Map();
      for (const m of [...a.data ?? [], ...b.data ?? []]) seen.set(m.id, m);
      return { data: [...seen.values()].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at))) };
    }),
    supabaseAdmin2.from("vehicles").select("year,make,model,license_plate").eq("id", rental.vehicle_id).maybeSingle()
  ]);
  return {
    id: inspection.id,
    vehicleLabel: [
      [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
      vehicle?.license_plate
    ].filter(Boolean).join(" \xB7 ") || "Your vehicle",
    inspectionType: inspection.inspection_type,
    odometer: inspection.odometer ?? null,
    fuelLevel: inspection.fuel_level ?? null,
    completedAt: inspection.completed_at ?? null,
    inspectorName: inspection.inspector_name ?? null,
    signedAt: inspection.driver_signed_at ?? null,
    signatureName: inspection.driver_signature_name ?? null,
    driverNotes: inspection.driver_notes ?? null,
    items: items ?? [],
    media: await signMedia(supabaseAdmin2, media ?? [], { includeGps: false, renter: true })
  };
});
var signCheckoutInspection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    inspectionId: external_exports.string().uuid(),
    signerName: external_exports.string().trim().min(2).max(140),
    agree: external_exports.literal(true),
    notes: external_exports.string().max(2e3).nullable().optional()
  }).parse(d)
).handler(async ({ data, context }) => {
  await (await Promise.resolve().then(() => (init_driver_preview_server(), driver_preview_server_exports))).refuseStaffPortalWrite(context.userId);
  const rental = await activeRentalFor(context.supabase, context.userId);
  if (!rental?.vehicle_id) return { error: "No active rental on file." };
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: inspection } = await supabaseAdmin2.from("inspections").select("id,vehicle_id,status,inspection_type,driver_signed_at").eq("id", data.inspectionId).maybeSingle();
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.vehicle_id !== rental.vehicle_id) return { error: "Forbidden" };
  if (inspection.inspection_type !== "pre_delivery" || inspection.status !== "passed") {
    return { error: "That inspection is not ready for signature." };
  }
  if (inspection.driver_signed_at) return { error: "You have already signed this." };
  const req = getRequest();
  const ip = req?.headers.get("cf-connecting-ip") || req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const agent = req?.headers.get("user-agent") ?? null;
  const { error } = await supabaseAdmin2.from("inspections").update({
    driver_user_id: context.userId,
    driver_signature_name: data.signerName.trim(),
    driver_signed_at: (/* @__PURE__ */ new Date()).toISOString(),
    driver_signature_ip: ip,
    driver_signature_user_agent: agent,
    driver_notes: data.notes?.trim() || null
  }).eq("id", data.inspectionId).is("driver_signed_at", null);
  if (error) return { error: error.message };
  return { ok: true };
});
export {
  CONDITION_ANGLES,
  CONDITION_BUCKET,
  CONDITION_PHASES,
  completeInspection,
  confirmConditionUpload,
  createConditionUploadUrl,
  deleteConditionMedia,
  getInspection,
  getMyCheckoutInspection,
  listConditionMedia,
  setInspectionItem,
  signCheckoutInspection,
  startInspection,
  updateInspection
};
