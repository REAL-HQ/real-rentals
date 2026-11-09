const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function pgBin() {
  const fromEnv = process.env.PG_BIN && process.env.PG_BIN.trim();
  if (fromEnv) return fromEnv;
  const bindir = execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  if (!bindir) throw new Error("pg_config --bindir was empty");
  return bindir;
}

function pgProgram(name) {
  return path.join(pgBin(), name);
}

function makeDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = { pgBin, pgProgram, makeDataDir };
