import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export async function fixture({extraEnv={}}={}) {
  const dir = await mkdtemp("/tmp/voxora-feature-");
  let child, origin;
  async function start() {
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../../server.js", import.meta.url))],
      {
        env: {
          ...process.env,
          ...extraEnv,
          PORT: "0",
          VOXORA_HOST: "127.0.0.1",
          VOXORA_DATA_DIR: dir,
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    origin = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => reject(Error("Server exited " + code)));
      createInterface({ input: child.stdout }).on("line", (line) => {
        const m = line.match(/port (\d+)/);
        if (m) resolve("http://127.0.0.1:" + m[1]);
      });
    });
  }
  async function stop() {
    if (child?.exitCode === null && child.signalCode === null) {
      const done = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await done;
    }
    child = null;
  }
  async function call(who, path, method = "GET", data) {
    const r = await fetch(origin + "/api" + path, {
      method,
      headers: {
        ...(who?.cookie ? { Cookie: who.cookie } : {}),
        ...(who?.token ? { Authorization: "Bot " + who.token } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function register(username) {
    const r = await call(null, "/auth/register", "POST", {
      username,
      displayName: username,
      password: "Fixture-password-987",
    });
    if (r.status !== 200)
      throw Error("Fixture registration failed with " + r.status);
    return { id: r.data.me.id, cookie: r.cookie, data: r.data };
  }
  async function gateway(token) {
    const controller = new AbortController(),
      events = [];
    const response = await fetch(origin + "/api/bot/events", {
      headers: { Authorization: "Bot " + token },
      signal: controller.signal,
    });
    if (!response.ok) throw Error("Gateway failed with " + response.status);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let closed = false;
    const task = (async () => {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const part = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          for (const line of part.split("\n"))
            if (line.startsWith("data: "))
              events.push(JSON.parse(line.slice(6)));
        }
      }
    })()
      .catch((e) => {
        if (!controller.signal.aborted) throw e;
      })
      .finally(() => {
        closed = true;
      });
    return {
      events,
      closed: () => closed,
      close: async () => {
        controller.abort();
        await task;
      },
    };
  }
  await start();
  return {
    dir,
    get origin() {
      return origin;
    },
    start,
    stop,
    call,
    register,
    gateway,
    cleanup: async () => {
      await stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
export async function until(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw Error("Expected asynchronous condition was not met.");
}
