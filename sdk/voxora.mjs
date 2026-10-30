import { EventEmitter } from "node:events";

export class VoxoraAPIError extends Error {
  constructor(status, message, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const connectionHint =
  "Check VOXORA_URL in .env. For the Windows desktop app use http://127.0.0.1:43127 and keep Voxora open. For a shared server use its HTTPS address. The backend must run Voxora 2.4 or later.";
function connectionError(status, message) {
  const error = new VoxoraAPIError(status, message);
  error.connectionProblem = true;
  return error;
}
async function responseJSON(response, origin, label = "Bot API") {
  let value;
  try {
    value = await response.json();
    if (value === null || typeof value !== "object") throw new SyntaxError();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const failure = new VoxoraAPIError(
      response.status,
      `${label} at ${origin} returned HTTP ${response.status} without a valid JSON response. ${connectionHint}`,
      Number(response.headers.get("retry-after")) || 0,
    );
    failure.connectionProblem = response.status < 500 && response.status !== 429;
    throw failure;
  }
  if (!response.ok)
    throw new VoxoraAPIError(
      response.status,
      typeof value.error === "string" ? value.error : `${label} request failed.`,
      Number(response.headers.get("retry-after")) || value.retryAfter || 0,
    );
  return value;
}
export class VoxoraBot extends EventEmitter {
  constructor({ url = "http://127.0.0.1:3000", token }) {
    super();
    const base = new URL(url);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      (base.protocol !== "https:" &&
        !(
          base.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
        ))
    )
      throw Error("Use an HTTPS Voxora origin, or HTTP on localhost.");
    if (typeof token !== "string" || !/^vxb_[a-f0-9]{64}$/.test(token))
      throw Error("Set a valid Voxora bot token.");
    this.url = base.origin;
    Object.defineProperty(this, "token", { value: token });
    this.controller = null;
    this.running = false;
    this.seenInteractions = new Set();
  }
  async verifyServer() {
    let response;
    try {
      response = await fetch(this.url + "/api/info", {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw connectionError(0, `Cannot reach Voxora at ${this.url}. ${connectionHint}`);
    }
    const info = await responseJSON(response, this.url, "Server check");
    if (info.name !== "Voxora")
      throw connectionError(
        response.status,
        `${this.url} is not a Voxora backend. ${connectionHint}`,
      );
    const version = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(info.version || "");
    if (
      version &&
      (Number(version[1]) < 2 ||
        (Number(version[1]) === 2 && Number(version[2]) < 4))
    )
      throw new VoxoraAPIError(
        426,
        `The Voxora backend at ${this.url} is version ${version[0]}, which does not support bots. Install Voxora 2.4 or later and close older running copies. If using a shared backend, upgrade that server too.`,
      );
    return info;
  }
  async api(path, method = "GET", data) {
    if (!path.startsWith("/") || path.includes(".."))
      throw Error("Use a bot API path starting with /.");
    const r = await fetch(this.url + "/api/bot" + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: "Bot " + this.token,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return responseJSON(r, this.url);
  }
  getState() {
    return this.api("/me");
  }
  registerCommands(commands) {
    return this.api("/commands", "PUT", { commands });
  }
  getInteractionContext(id) {
    return this.api("/interactions/" + encodeURIComponent(id) + "/context");
  }
  moderateInteraction(id, options) {
    return this.api("/interactions/" + encodeURIComponent(id) + "/moderation", "POST", options);
  }
  getMessages(channel, after) {
    return this.api(
      "/channels/" +
        encodeURIComponent(channel) +
        "/messages" +
        (after ? "?after=" + encodeURIComponent(after) : ""),
    );
  }
  sendMessage(channel, message) {
    return this.api(
      "/channels/" + encodeURIComponent(channel) + "/messages",
      "POST",
      typeof message === "string" ? { text: message } : message,
    );
  }
  editMessage(id, text) {
    return this.api("/messages/" + encodeURIComponent(id), "PATCH", { text });
  }
  deleteMessage(id) {
    return this.api("/messages/" + encodeURIComponent(id), "DELETE");
  }
  react(id, emoji) {
    return this.api(
      "/messages/" + encodeURIComponent(id) + "/reactions",
      "POST",
      { emoji },
    );
  }
  createPoll(channel, poll) {
    return this.sendMessage(channel, { poll });
  }
  endPoll(id) {
    return this.api(
      "/messages/" + encodeURIComponent(id) + "/poll-close",
      "POST",
      {},
    );
  }
  pendingInteractions() {
    return this.api("/interactions");
  }
  respond(id, response) {
    return this.api(
      "/interactions/" + encodeURIComponent(id) + "/respond",
      "POST",
      typeof response === "string" ? { text: response } : response,
    );
  }
  dispatch(name, value) {
    for (const listener of this.listeners(name))
      Promise.resolve()
        .then(() => listener(value))
        .catch((error) => this.report(error));
  }
  report(error) {
    if (this.listenerCount("error"))
      for (const listener of this.listeners("error"))
        Promise.resolve()
          .then(() => listener(error))
          .catch(() => {});
    else console.error("Voxora bot:", error.message);
  }
  interaction(value) {
    if (this.seenInteractions.has(value.id)) return;
    this.seenInteractions.add(value.id);
    if (this.seenInteractions.size > 1000)
      this.seenInteractions.delete(this.seenInteractions.values().next().value);
    this.dispatch("interaction", {
      ...value,
      respond: (response) => this.respond(value.id, response),
      context: () => this.getInteractionContext(value.id),
      moderate: (options) => this.moderateInteraction(value.id, options),
    });
  }
  async connect() {
    if (this.running) throw Error("This bot client is already connected.");
    this.running = true;
    let backoff = 500;
    try {
      while (this.running) {
        this.controller = new AbortController();
        try {
          const response = await fetch(this.url + "/api/bot/events", {
            headers: {
              Authorization: "Bot " + this.token,
              Accept: "text/event-stream",
            },
            signal: this.controller.signal,
            redirect: "error",
          });
          if (!response.ok)
            await responseJSON(response, this.url, "Bot gateway");
          if (
            !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")
          ) {
            await response.body?.cancel();
            throw connectionError(
              response.status,
              `The server at ${this.url} did not provide a Voxora bot gateway. ${connectionHint}`,
            );
          }
          backoff = 500;
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          try {
            while (this.running) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              if (buffer.length > 2 * 1024 * 1024)
                throw Error("Gateway event exceeded the client buffer limit.");
              let end;
              while ((end = buffer.indexOf("\n\n")) >= 0) {
                const block = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const data = block
                  .split("\n")
                  .filter((line) => line.startsWith("data: "))
                  .map((line) => line.slice(6))
                  .join("\n");
                if (!data) continue;
                const event = JSON.parse(data);
                this.dispatch("event", event);
                if (event.type === "READY") {
                  this.dispatch("ready", event);
                  // The gateway has no replay log. Recover queued slash commands on reconnect.
                  for (const interaction of await this.pendingInteractions())
                    this.interaction(interaction);
                } else if (event.type === "INTERACTION_CREATE")
                  this.interaction(event.interaction);
                else if (event.type === "MESSAGE_CREATE")
                  this.dispatch("message", event.message);
                else if (event.type === "MESSAGE_UPDATE")
                  this.dispatch("messageUpdate", event.message);
                else if (event.type === "MESSAGE_DELETE")
                  this.dispatch("messageDelete", event);
                else if (event.type === "STATE_UPDATE")
                  this.dispatch("stateUpdate", event);
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        } catch (error) {
          if (!this.running) break;
          this.report(error);
          if ([401, 403, 404, 405].includes(error.status) || error.connectionProblem)
            throw error;
        }
        if (this.running) {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, backoff);
            this.controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true },
            );
          });
          backoff = Math.min(backoff * 2, 15000);
        }
      }
    } finally {
      this.running = false;
      this.controller = null;
    }
  }
  close() {
    this.running = false;
    this.controller?.abort();
  }
}
