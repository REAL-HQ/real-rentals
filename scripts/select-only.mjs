/**
 * Accept exactly one SELECT or WITH.
 * Comments, standard strings, E'' strings, dollar quotes, and quoted
 * identifiers cannot hide a second command or a write. Unicode escapes
 * are refused. A comment or newline between a name and '(' is whitespace,
 * the same way Postgres sees it, so the name is still a call. A quoted
 * name and a parenthesized name are calls too.
 *
 * The caller passes the checklist policy. current_setting may read only
 * the setting names in that policy, including an E'' literal with no
 * backslash. to_jsonb may read only the public.documents alias named
 * there. A plain quoted alias stays in the shape, so it cannot hide a
 * second binding. Tables are an allowlist. pg_roles and pg_authid may
 * not be read with a star or rolpassword.
 *
 * Postgres keeps $ inside an identifier, so a$$ is not a dollar quote.
 * A dollar quote never starts right after an identifier character.
 */

const WRITE_KEYWORD = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge|call|do|comment|vacuum|analyze|refresh|reindex|cluster|lock|set|begin|commit|rollback|execute|prepare|listen|notify|into)\b/i;

const NOT_A_CALL = new Set([
  "all", "and", "any", "array", "as", "between", "by", "case", "cast", "collate",
  "else", "end", "except", "fetch", "filter", "for", "from", "group", "having",
  "ilike", "in", "intersect", "into", "isnull", "join", "lateral", "like", "limit",
  "not", "notnull", "offset", "on", "or", "order", "over", "placement", "returning",
  "row", "select", "similar", "some", "tablesample", "then", "union", "using",
  "values", "when", "where", "window", "with", "within",
]);

const ALIAS_STOP = new Set([
  "and", "as", "cross", "else", "end", "except", "fetch", "for", "from", "full",
  "group", "having", "inner", "intersect", "join", "left", "limit", "loop",
  "natural", "offset", "on", "or", "order", "outer", "returning", "right",
  "select", "tablesample", "then", "union", "using", "when", "where", "window",
]);

const JOIN_WORDS = new Set(["cross", "full", "inner", "join", "left", "natural", "outer", "right"]);

export function assertReadQuery(sql) {
  const scanned = scanSql(sql);
  if (scanned.statements !== 1) {
    throw new Error("Refusing to run: SQL is not a single statement.");
  }
  const code = scanned.code.trim();
  if (!/^(select|with)\b/i.test(code)) {
    throw new Error(`Refusing to run: statement is not a SELECT: ${code.slice(0, 80)}`);
  }
  const write = code.match(WRITE_KEYWORD);
  if (write) throw new Error(`Refusing to run: SELECT contains ${write[1]}`);
  return scanned;
}

export function assertSelectOnly(sql, policy) {
  if (!policy || !policy.allowedCalls || !policy.allowedRelations) {
    throw new Error("Refusing to run: select guard has no call policy.");
  }
  const scanned = assertReadQuery(sql);
  for (const name of scanned.names) {
    const bare = name.slice(name.lastIndexOf(".") + 1);
    if (bare === "rolpassword") throw new Error("Refusing to run: SELECT reads a role secret.");
  }
  for (const relation of relationsOf(scanned.shape)) {
    if (!policy.allowedRelations.has(relation)) throw new Error(`Refusing to run: SELECT reads ${relation}`);
  }
  assertRoleProjection(scanned.shape);
  for (const call of scanned.calls) {
    if (!policy.allowedCalls.has(call.name)) throw new Error(`Refusing to run: SELECT calls ${call.name}`);
    if (call.name === "current_setting" || call.name === "pg_catalog.current_setting") {
      assertSetting(sql, call.open, policy.allowedSettings);
    }
    if (call.name === "to_jsonb" || call.name === "pg_catalog.to_jsonb") {
      if (scanned.opaqueQuoted) throw new Error("Refusing to run: to_jsonb is not limited to public.documents.");
      assertDocumentsRow(sql, call.open, scanned.shape, policy.documentsAlias);
    }
  }
}

export function scanSql(sql) {
  let code = "";
  let shape = "";
  let statements = 0;
  let saw = false;
  let qualifier = "";
  const names = [];
  const calls = [];
  let opaqueQuoted = false;
  let i = 0;
  const len = sql.length;

  const mark = () => {
    saw = true;
  };
  const finish = () => {
    if (saw) statements += 1;
    saw = false;
  };
  const emit = (text, keep = true) => {
    code += text;
    shape += keep ? text : " ";
  };
  const noteCall = (name, open) => {
    if (!NOT_A_CALL.has(name)) calls.push({ name, open });
  };
  const ident = (text, quoted) => {
    mark();
    const plain = plainIdent(text);
    if (quoted && !plain) opaqueQuoted = true;
    emit(text, !quoted || plain);
    const lower = text.toLowerCase();
    names.push(lower);
    const after = skipGap(sql, i);
    if (sql[after] === ".") {
      qualifier = qualifier ? `${qualifier}.${lower}` : lower;
      return;
    }
    const call = qualifier ? `${qualifier}.${lower}` : lower;
    qualifier = "";
    if (sql[after] === "(") noteCall(call, after);
  };
  const refuseUnicode = (at) => {
    if ((sql[at] !== "U" && sql[at] !== "u") || sql[at + 1] !== "&") return;
    const quote = sql[at + 2];
    if (quote !== "'" && quote !== "\"") return;
    const prev = at > 0 ? sql[at - 1] : "";
    if (isIdentPart(prev)) return;
    throw new Error("Refusing to run: SQL uses a Unicode escape.");
  };

  while (i < len) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? len : end;
      emit(" ");
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
      emit(" ");
      continue;
    }
    if (ch === "'") {
      const escape = i > 0 && (sql[i - 1] === "E" || sql[i - 1] === "e") && (i < 2 || !isIdentPart(sql[i - 2]));
      i = escape ? skipEscapeString(sql, i) : skipStandardString(sql, i);
      emit(" ");
      mark();
      continue;
    }
    if (ch === "\"") {
      const end = skipQuotedIdent(sql, i);
      const text = unquoteIdent(sql.slice(i, end));
      i = end;
      ident(text, true);
      continue;
    }
    const dollar = dollarTag(sql, i);
    if (dollar) {
      const close = sql.indexOf(dollar, i + dollar.length);
      if (close < 0) throw new Error("Refusing to run: SQL has an unterminated dollar quote.");
      i = close + dollar.length;
      emit(" ");
      mark();
      continue;
    }
    if (ch === ";") {
      finish();
      qualifier = "";
      emit(" ");
      i += 1;
      continue;
    }
    if (ch === "(") {
      const invoked = parenInvoke(sql, i);
      if (invoked) noteCall(invoked.name, invoked.open);
    }
    if (isIdentStart(ch)) {
      refuseUnicode(i);
      const start = i;
      i += 1;
      while (i < len && isIdentPart(sql[i])) i += 1;
      ident(sql.slice(start, i), false);
      continue;
    }
    if (!/\s/.test(ch) && ch !== ".") qualifier = "";
    if (!/\s/.test(ch)) mark();
    emit(ch);
    i += 1;
  }
  finish();
  return { statements, code, shape, names, calls, opaqueQuoted };
}

function parenInvoke(sql, i) {
  if (sql[i] !== "(") return null;
  let j = skipGap(sql, i + 1);
  const parts = [];
  while (j < sql.length) {
    let part = null;
    if (sql[j] === "\"") {
      const end = skipQuotedIdent(sql, j);
      part = unquoteIdent(sql.slice(j, end));
      j = end;
    } else if (isIdentStart(sql[j])) {
      const start = j;
      j += 1;
      while (j < sql.length && isIdentPart(sql[j])) j += 1;
      part = sql.slice(start, j);
    } else {
      return null;
    }
    parts.push(part.toLowerCase());
    j = skipGap(sql, j);
    if (sql[j] === ".") {
      j = skipGap(sql, j + 1);
      continue;
    }
    break;
  }
  if (!parts.length || sql[j] !== ")") return null;
  j = skipGap(sql, j + 1);
  if (sql[j] !== "(") return null;
  return { name: parts.join("."), open: j };
}

function assertSetting(sql, open, allowed) {
  const args = splitArgs(sql, open);
  const value = args.length === 1 ? onlySettingLiteral(args[0]) : null;
  if (value == null || !allowed || !allowed.has(value.toLowerCase())) {
    throw new Error("Refusing to run: current_setting is not an allowed setting.");
  }
}

function assertDocumentsRow(sql, open, shape, alias) {
  const args = splitArgs(sql, open);
  const name = args.length === 1 ? onlyIdent(args[0]) : null;
  if (typeof alias !== "string" || !/^[a-z_][a-z0-9_]*$/.test(alias) || name !== alias) {
    throw new Error("Refusing to run: to_jsonb is not limited to public.documents.");
  }
  const bindings = [];
  const toks = tokenize(shape);
  walk(toks, 0, toks.length, bindings);
  const hits = bindings.filter((binding) => binding.alias === alias);
  if (hits.length === 0 || hits.some((binding) => binding.relation !== "public.documents")) {
    throw new Error("Refusing to run: to_jsonb is not limited to public.documents.");
  }
}

function onlyStandardLiteral(raw) {
  const start = skipGap(raw, 0);
  if (raw[start] !== "'") return null;
  if (start > 0 && /[A-Za-z0-9_&]/.test(raw[start - 1])) return null;
  let parsed;
  try {
    parsed = readStandard(raw, start);
  } catch {
    return null;
  }
  if (skipGap(raw, parsed.end) !== raw.length) return null;
  return parsed.value;
}

function onlyIdent(raw) {
  const start = skipGap(raw, 0);
  if (!isIdentStart(raw[start] || "")) return null;
  let j = start + 1;
  while (j < raw.length && isIdentPart(raw[j])) j += 1;
  if (skipGap(raw, j) !== raw.length) return null;
  return raw.slice(start, j).toLowerCase();
}

function readStandard(sql, i) {
  let value = "";
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") {
        value += "'";
        j += 2;
        continue;
      }
      return { value, end: j + 1 };
    }
    value += sql[j];
    j += 1;
  }
  throw new Error("Refusing to run: SQL has an unterminated string.");
}

function splitArgs(sql, open) {
  if (sql[open] !== "(") throw new Error("Refusing to run: SQL has an unreadable call.");
  const args = [];
  let start = open + 1;
  let depth = 1;
  let j = open + 1;
  while (j < sql.length && depth > 0) {
    const ch = sql[j];
    if (ch === "-" && sql[j + 1] === "-") {
      const end = sql.indexOf("\n", j + 2);
      j = end < 0 ? sql.length : end;
      continue;
    }
    if (ch === "/" && sql[j + 1] === "*") {
      j = skipBlockComment(sql, j);
      continue;
    }
    if (ch === "'") {
      const escape = j > 0 && (sql[j - 1] === "E" || sql[j - 1] === "e") && (j < 2 || !isIdentPart(sql[j - 2]));
      j = escape ? skipEscapeString(sql, j) : skipStandardString(sql, j);
      continue;
    }
    if (ch === "\"") {
      j = skipQuotedIdent(sql, j);
      continue;
    }
    const dollar = dollarTag(sql, j);
    if (dollar) {
      const close = sql.indexOf(dollar, j + dollar.length);
      if (close < 0) throw new Error("Refusing to run: SQL has an unterminated dollar quote.");
      j = close + dollar.length;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      j += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        args.push(sql.slice(start, j));
        return args;
      }
      j += 1;
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push(sql.slice(start, j));
      start = j + 1;
      j += 1;
      continue;
    }
    j += 1;
  }
  throw new Error("Refusing to run: SQL has an unterminated call.");
}

function tokenize(shape) {
  const out = [];
  let i = 0;
  while (i < shape.length) {
    const ch = shape[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < shape.length && isIdentPart(shape[i])) i += 1;
      out.push({ k: "id", v: shape.slice(start, i).toLowerCase() });
      continue;
    }
    out.push({ k: "sym", v: ch });
    i += 1;
  }
  return out;
}

function walk(toks, start, end, bindings) {
  for (let i = start; i < end; i += 1) {
    const tok = toks[i];
    if (tok.v === "(") {
      const close = findClose(toks, i);
      if (close < 0) throw new Error("Refusing to run: SQL has an unterminated call.");
      walk(toks, i + 1, close, bindings);
      i = close;
      continue;
    }
    if (tok.v === "from" || tok.v === "join") {
      const next = parseFromList(toks, i + 1, end, bindings);
      if (next <= i) throw new Error("Refusing to run: SQL has an unreadable FROM.");
      i = next - 1;
    }
  }
}

function parseFromList(toks, i, end, bindings) {
  while (i < end) {
    const before = i;
    i = parseFromItem(toks, i, end, bindings);
    if (i <= before) i = before + 1;
    if (i >= end) break;
    if (toks[i].v === ",") {
      i += 1;
      continue;
    }
    if (toks[i].k === "id" && JOIN_WORDS.has(toks[i].v) && toks[i].v !== "outer") {
      while (i < end && toks[i].k === "id" && JOIN_WORDS.has(toks[i].v)) i += 1;
      continue;
    }
    break;
  }
  return i;
}

function parseFromItem(toks, i, end, bindings) {
  if (i >= end) return i;
  if (toks[i].v === "only" || toks[i].v === "lateral") return parseFromItem(toks, i + 1, end, bindings);
  if (toks[i].v === "(") {
    const close = findClose(toks, i);
    if (close < 0) throw new Error("Refusing to run: SQL has an unterminated call.");
    walk(toks, i + 1, close, bindings);
    const alias = readAlias(toks, close + 1);
    bindings.push({ relation: "subquery", alias: alias ? alias.name : "" });
    return alias ? alias.next : close + 1;
  }
  if (toks[i].k !== "id") return i + 1;
  let relation = toks[i].v;
  i += 1;
  if (i + 1 < end && toks[i].v === "." && toks[i + 1].k === "id") {
    relation = `${relation}.${toks[i + 1].v}`;
    i += 2;
  }
  if (i < end && toks[i].v === "(") {
    const close = findClose(toks, i);
    if (close < 0) throw new Error("Refusing to run: SQL has an unterminated call.");
    walk(toks, i + 1, close, bindings);
    const alias = readAlias(toks, close + 1);
    bindings.push({ relation: "call", alias: alias ? alias.name : relation });
    return alias ? alias.next : close + 1;
  }
  const alias = readAlias(toks, i);
  if (alias) {
    bindings.push({ relation, alias: alias.name });
    return alias.next;
  }
  const dot = relation.lastIndexOf(".");
  bindings.push({ relation, alias: dot < 0 ? relation : relation.slice(dot + 1) });
  return i;
}

function readAlias(toks, i) {
  let k = i;
  if (toks[k] && toks[k].v === "as") k += 1;
  const tok = toks[k];
  if (!tok || tok.k !== "id" || ALIAS_STOP.has(tok.v)) return null;
  return { name: tok.v, next: k + 1 };
}

function findClose(toks, open) {
  let depth = 0;
  for (let i = open; i < toks.length; i += 1) {
    if (toks[i].v === "(") depth += 1;
    else if (toks[i].v === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipGap(sql, at) {
  let j = at;
  while (j < sql.length) {
    const ch = sql[j];
    if (/\s/.test(ch)) {
      j += 1;
      continue;
    }
    if (ch === "-" && sql[j + 1] === "-") {
      const end = sql.indexOf("\n", j + 2);
      j = end < 0 ? sql.length : end;
      continue;
    }
    if (ch === "/" && sql[j + 1] === "*") {
      j = skipBlockComment(sql, j);
      continue;
    }
    break;
  }
  return j;
}

function dollarTag(sql, i) {
  if (sql[i] !== "$") return null;
  if (i > 0 && isIdentPart(sql[i - 1])) {
    throw new Error("Refusing to run: SQL uses $ in an identifier.");
  }
  if (sql.startsWith("$$", i)) return "$$";
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)\$/.exec(sql.slice(i));
  return match ? match[0] : null;
}

function skipBlockComment(sql, i) {
  let depth = 1;
  let j = i + 2;
  while (j < sql.length && depth > 0) {
    if (sql[j] === "/" && sql[j + 1] === "*") {
      depth += 1;
      j += 2;
      continue;
    }
    if (sql[j] === "*" && sql[j + 1] === "/") {
      depth -= 1;
      j += 2;
      continue;
    }
    j += 1;
  }
  if (depth !== 0) throw new Error("Refusing to run: SQL has an unterminated comment.");
  return j;
}

function skipStandardString(sql, i) {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  throw new Error("Refusing to run: SQL has an unterminated string.");
}

function skipEscapeString(sql, i) {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "\\") {
      if (j + 1 >= sql.length) break;
      j += 2;
      continue;
    }
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  throw new Error("Refusing to run: SQL has an unterminated string.");
}

function skipQuotedIdent(sql, i) {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "\"") {
      if (sql[j + 1] === "\"") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  throw new Error("Refusing to run: SQL has an unterminated identifier.");
}

function unquoteIdent(token) {
  return token.slice(1, -1).replace(/""/g, "\"");
}

function isIdentStart(ch) {
  return typeof ch === "string" && ch.length === 1 && /[\p{L}_]/u.test(ch);
}

function isIdentPart(ch) {
  return typeof ch === "string" && ch.length === 1 && /[\p{L}0-9_$]/u.test(ch);
}

function plainIdent(text) {
  return /^[\p{L}_][\p{L}0-9_$]*$/u.test(text);
}

function onlySettingLiteral(raw) {
  const standard = onlyStandardLiteral(raw);
  if (standard != null) return standard;
  const start = skipGap(raw, 0);
  if ((raw[start] !== "E" && raw[start] !== "e") || raw[start + 1] !== "'") return null;
  if (start > 0 && isIdentPart(raw[start - 1])) return null;
  let value = "";
  let j = start + 2;
  while (j < raw.length) {
    if (raw[j] === "\\") return null;
    if (raw[j] === "'") {
      if (raw[j + 1] === "'") {
        value += "'";
        j += 2;
        continue;
      }
      if (skipGap(raw, j + 1) !== raw.length) return null;
      return value;
    }
    value += raw[j];
    j += 1;
  }
  return null;
}

function relationsOf(shape) {
  const bindings = [];
  const toks = tokenize(shape);
  walk(toks, 0, toks.length, bindings);
  const out = [];
  for (const binding of bindings) {
    if (binding.relation === "subquery" || binding.relation === "call") continue;
    out.push(binding.relation);
  }
  return out;
}

function assertRoleProjection(shape) {
  const toks = tokenize(shape);
  const bindings = [];
  walk(toks, 0, toks.length, bindings);
  const sensitive = bindings.some((binding) =>
    binding.relation === "pg_catalog.pg_roles"
    || binding.relation === "pg_catalog.pg_authid"
    || binding.relation === "pg_roles"
    || binding.relation === "pg_authid");
  if (!sensitive) return;
  for (let i = 0; i < toks.length; i += 1) {
    if (toks[i].v !== "*") continue;
    const countStar = i >= 2 && toks[i - 1].v === "(" && toks[i - 2].v === "count";
    if (!countStar) throw new Error("Refusing to run: SELECT reads a role secret.");
  }
}

const ALLOWED_SETTINGS = new Set([
  "server_version",
  "transaction_read_only",
  "default_transaction_read_only",
  "standard_conforming_strings",
]);

const ALLOWED_RELATIONS = new Set([
  "information_schema.columns",
  "pg_catalog.pg_class",
  "pg_catalog.pg_extension",
  "pg_catalog.pg_namespace",
  "pg_catalog.pg_policy",
  "pg_catalog.pg_roles",
  "pg_catalog.pg_trigger",
  "public.applications",
  "public.documents",
  "storage.buckets",
  "storage.objects",
]);

/** Checklist calls for proposed/m2-preflight.sql and its session probe. */
export const PREFLIGHT_POLICY = {
  allowedCalls: new Set([
    "exists",
    "to_regprocedure",
    "to_regclass",
    "coalesce",
    "string_agg",
    "pg_catalog.aclexplode",
    "pg_catalog.acldefault",
    "count",
    "current_setting",
    "to_jsonb",
  ]),
  allowedSettings: ALLOWED_SETTINGS,
  allowedRelations: ALLOWED_RELATIONS,
  documentsAlias: "d",
};

export const ALLOWED_CALLS = PREFLIGHT_POLICY.allowedCalls;
