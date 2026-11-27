import assert from "node:assert/strict";
import fs from "node:fs";
const clean = (text) => text.replace(/\r\n/g, "\n");
const source = clean(fs.readFileSync("web/public/_headers", "utf8"));
const build = clean(fs.readFileSync("dist/_headers", "utf8"));
assert.equal(build, source);
const routes = new Map();
let route;
for (const line of build.split("\n").filter(Boolean)) {
  if (!line.startsWith(" ")) { route = line; routes.set(route, new Map()); continue; }
  const split = line.indexOf(":");
  routes.get(route).set(line.slice(0, split).trim().toLowerCase(), line.slice(split + 1).trim());
}
const headers = routes.get("/*");
const policies = headers.get("content-security-policy").split(";").map((policy) => policy.trim());
for (const expected of ["connect-src 'self'", "frame-ancestors 'none'", "default-src 'self'", "object-src 'none'"]) {
  assert(policies.includes(expected), JSON.stringify({missing:expected, policies}));
}
assert.equal(headers.get("x-content-type-options"), "nosniff");
assert.equal(headers.get("x-frame-options"), "DENY");
assert.equal(routes.get("/").get("cache-control"), "no-cache");
assert.equal(routes.get("/index.html").get("cache-control"), "no-cache");
console.log("PASS: dist/_headers has scoped CSP, nosniff, frame denial and HTML no-cache");
