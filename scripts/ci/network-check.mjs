import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
// sysfs belongs to the host mount namespace; netlink reports this process network namespace.
const links = JSON.parse(execFileSync("ip", ["-j", "link"], { encoding: "utf8" }));
assert.deepEqual(links.map((link) => link.ifname).sort(), ["lo"]);
assert.deepEqual(JSON.parse(execFileSync("ip", ["-j", "route"], { encoding: "utf8" })), []);
const status = readFileSync("/proc/self/status", "utf8");
assert.match(status, /NoNewPrivs:\s+1/);
assert.match(status, /CapBnd:\s+0+\s/);
assert.notEqual(process.getuid(), 0);
// Documentation-only address; never a production endpoint.
await new Promise((resolve, reject) => {
  const socket = net.connect({ host: "192.0.2.1", port: 443 });
  socket.setTimeout(1500, () => {
    socket.destroy();
    reject(Error("Expected immediate no-route rejection"));
  });
  socket.on("connect", () => {
    socket.destroy();
    reject(Error("External network unexpectedly reachable"));
  });
  socket.on("error", (e) => {
    socket.destroy();
    if (["ENETUNREACH", "EHOSTUNREACH"].includes(e.code)) resolve();
    else reject(e);
  });
});
console.log("Loopback-only namespace, no capabilities, no-new-privileges verified");
