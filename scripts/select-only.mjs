/**
 * Accept exactly one SELECT or WITH.
 * Comments, standard strings, E'' strings, dollar quotes, and quoted
 * identifiers cannot hide a second command or a write.
 */

const WRITE_KEYWORD = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge|call|do|comment|vacuum|analyze|refresh|reindex|cluster|lock|set|begin|commit|rollback|execute|prepare|listen|notify|into)\b/i;

export const SIDE_EFFECT = new Set([
  "set_config",
  "pg_advisory_lock",
  "pg_terminate_backend",
  "pg_notify",
  "pg_reload_conf",
  "pg_read_file",
]);

export function assertSelectOnly(sql) {
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
  for (const name of scanned.names) {
    if (SIDE_EFFECT.has(name)) throw new Error(`Refusing to run: SELECT calls ${name}`);
  }
}

export function scanSql(sql) {
  let code = "";
  let statements = 0;
  let saw = false;
  const names = [];
  let i = 0;
  const len = sql.length;

  const mark = () => {
    saw = true;
  };
  const finish = () => {
    if (saw) statements += 1;
    saw = false;
  };
  const ident = (text) => {
    mark();
    code += text;
    names.push(text.toLowerCase());
  };

  while (i < len) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? len : end;
      code += " ";
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
      code += " ";
      continue;
    }
    if (ch === "'") {
      const escape = i > 0 && (sql[i - 1] === "E" || sql[i - 1] === "e") && (i < 2 || !/[A-Za-z0-9_]/.test(sql[i - 2]));
      i = escape ? skipEscapeString(sql, i) : skipStandardString(sql, i);
      code += " ";
      mark();
      continue;
    }
    if (ch === "\"") {
      const end = skipQuotedIdent(sql, i);
      ident(unquoteIdent(sql.slice(i, end)));
      i = end;
      continue;
    }
    const dollar = dollarTag(sql, i);
    if (dollar) {
      const close = sql.indexOf(dollar, i + dollar.length);
      if (close < 0) throw new Error("Refusing to run: SQL has an unterminated dollar quote.");
      i = close + dollar.length;
      code += " ";
      mark();
      continue;
    }
    if (ch === ";") {
      finish();
      code += " ";
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < len && /[A-Za-z0-9_]/.test(sql[i])) i += 1;
      ident(sql.slice(start, i));
      continue;
    }
    if (!/\s/.test(ch)) mark();
    code += ch;
    i += 1;
  }
  finish();
  return { statements, code, names };
}

function dollarTag(sql, i) {
  if (sql[i] !== "$") return null;
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
