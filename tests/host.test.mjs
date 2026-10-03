import assert from "node:assert/strict";
import test from "node:test";
import { hasServerControl } from "../web/js/lib/host.js";

test("server controls require an advertised host capability", async () => {
  const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  assert.equal(await hasServerControl(async () => json({ ok: true, control: true })), true);
  for (const body of [{ ok: true }, { ok: true, control: false }, { control: true }, null])
    assert.equal(await hasServerControl(async () => json(body)), false);
  assert.equal(await hasServerControl(async () => new Response("<html>Not found</html>", { status: 404, headers: { "Content-Type": "text/html" } })), false);
  assert.equal(await hasServerControl(async () => new Response("invalid", { headers: { "Content-Type": "application/json" } })), false);
  assert.equal(await hasServerControl(async () => { throw new Error("unavailable"); }), false);
});
