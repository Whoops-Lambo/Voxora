import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { VoxoraBot, VoxoraAPIError } from "../sdk/voxora.mjs";

async function mockBackend(t) {
  let handler;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, authorization: req.headers.authorization });
    handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    requests,
    url: "http://127.0.0.1:" + server.address().port,
    reply(status, value, headers = {}) {
      handler = (req, res) => {
        res.writeHead(status, headers);
        res.end(typeof value === "string" ? value : JSON.stringify(value));
      };
    },
  };
}

test("SDK diagnoses wrong backends and preserves HTTP errors without leaking response bodies", async (t) => {
  const server = await mockBackend(t);
  const token = "vxb_" + "a".repeat(64);
  const bot = new VoxoraBot({ url: server.url, token });
  server.reply(404, "Not found " + token, { "Content-Type": "text/plain" });
  await assert.rejects(bot.verifyServer(), (error) => {
    assert.ok(error instanceof VoxoraAPIError);
    assert.equal(error.status, 404);
    assert.equal(error.connectionProblem, true);
    assert.match(error.message, /43127/);
    assert.match(error.message, /VOXORA_URL/);
    assert.ok(!error.message.includes(token));
    assert.ok(!error.message.includes("Unexpected token"));
    return true;
  });
  server.reply(200, { name: "Another app", version: "2.4.0" });
  await assert.rejects(bot.verifyServer(), /not a Voxora backend/);
  server.reply(200, { name: "Voxora", version: "2.3.0" });
  await assert.rejects(bot.verifyServer(), (error) => {
    assert.equal(error.status, 426);
    assert.match(error.message, /upgrade that server too/);
    return true;
  });
  server.reply(200, { name: "Voxora", version: "2.4.0" });
  assert.equal((await bot.verifyServer()).version, "2.4.0");
  assert.ok(server.requests.every((r) => r.path === "/api/info" && !r.authorization));

  server.reply(404, "Not found");
  await assert.rejects(bot.registerCommands([]), (error) => {
    assert.equal(error.status, 404);
    assert.match(error.message, /Bot API/);
    assert.match(error.message, /43127/);
    return true;
  });
  server.reply(401, { error: "Bot token is invalid." });
  await assert.rejects(bot.getState(), (error) => error.status === 401 && error.message === "Bot token is invalid.");
  server.reply(429, "Too many requests", { "Retry-After": "7" });
  await assert.rejects(bot.getState(), (error) => error.status === 429 && error.retryAfter === 7 && !error.connectionProblem);
  server.reply(429, { error: "Slow down", retryAfter: 3 });
  await assert.rejects(bot.getState(), (error) => error.status === 429 && error.retryAfter === 3);
  server.reply(200, []);
  assert.deepEqual(await bot.getMessages("channel"), []);
  assert.equal(server.requests.at(-1).authorization, "Bot " + token);
});

test("SDK stops invalid gateways instead of reconnecting to missing or HTML endpoints", async (t) => {
  const server = await mockBackend(t);
  for (const [status, body, type] of [
    [404, "Not found", "text/plain"],
    [404, { error: "Not found." }, "application/json"],
    [200, "<html>Website</html>", "text/html"],
    [401, "Unauthorized", "text/plain"],
  ]) {
    server.reply(status, body, { "Content-Type": type });
    const bot = new VoxoraBot({ url: server.url, token: "vxb_" + "b".repeat(64) });
    const errors = [];
    bot.on("error", (error) => errors.push(error));
    const count = server.requests.length;
    await assert.rejects(bot.connect(), (error) => error instanceof VoxoraAPIError && error.status === status);
    assert.equal(bot.running, false);
    assert.equal(server.requests.length, count + 1);
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].message.includes("Unexpected token"));
  }
});
