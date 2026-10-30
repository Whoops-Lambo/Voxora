# Building bots for Voxora

Voxora has its own bot API. Discord tokens, discord.js and Discord OAuth applications do not connect to it. The included JavaScript SDK uses Node.js 22+, built-in `fetch`, and the SSE gateway; it needs no npm dependencies.

## Create and install your bot

1. Open `/developers` on your Voxora backend and sign in.
2. Choose **New Application**, enter its name and description, and create it.
3. Copy the one-time bot token. Listings never reveal tokens again. **Rotate Token** generates a replacement and immediately invalidates the old token and its gateway connections. **Revoke Token** disconnects the bot without deleting its application.
4. Choose **Install Bot**, or enter the application ID in **Server Settings → Bots & Apps → Add a Bot**. Installation requires Manage Server.
5. Download **Bot Starter**, extract it, and configure the backend URL and token. The bot must connect to the same backend as its community. Separate desktop installations initially run separate backends; the local desktop URL is `http://127.0.0.1:43127`, while `npm start` defaults to port 3000.

Never put tokens in a URL, client-side JavaScript, a Git commit, or a log. Voxora stores a hash rather than the original token. Use HTTPS for a remote backend; the SDK permits HTTP only for localhost.

## Run the starter

Install **Node.js 22 or later** from [nodejs.org](https://nodejs.org/), then extract the Bot Starter ZIP to a folder.

On Windows, double-click **`start-bot.bat`** inside the extracted `voxora-bot` folder. The first launch creates `.env` and opens it in Notepad. Fill in your backend URL and bot token, save the file, then double-click `start-bot.bat` again. Existing `.env` settings are preserved. The console stays open so you can see connection messages or errors; keep it open while the bot is running.

Use these two settings in `.env`:

```dotenv
VOXORA_URL=https://your-voxora-server.example
VOXORA_BOT_TOKEN=your_token_from_the_portal
```

For the desktop app running on this computer, use `VOXORA_URL=http://127.0.0.1:43127` and keep Voxora open. A backend started with `npm start` defaults to `http://127.0.0.1:3000`. For another computer, use your shared backend's HTTPS address.

From a terminal on Windows, macOS, or Linux, run this inside the extracted bot folder:

```sh
node start-bot.mjs
```

`npm start` runs the same launcher; no `npm install` is needed. On the first terminal launch, edit the generated `.env` and run it again. You can edit `examples/echo-bot.mjs` to customize your bot.

The example registers `/echo` and `/bothelp`, responds to slash commands, and responds to the text `!ping`. Keep the process running to keep its gateway connection online. Stop it with Ctrl+C. Voxora does not execute third-party bot source code inside its server.

## JavaScript SDK

```js
import { VoxoraBot } from "./sdk/voxora.mjs";

const bot = new VoxoraBot({
  url: process.env.VOXORA_URL,
  token: process.env.VOXORA_BOT_TOKEN,
});

await bot.registerCommands([
  { name: "hello", description: "Say hello", usage: "/hello" },
]);

bot.on("ready", ({ user, servers }) => {
  console.log(`${user.displayName} connected to ${servers.length} servers.`);
});
bot.on("interaction", async (interaction) => {
  await interaction.respond(`Hello, ${interaction.user.displayName}!`);
});
bot.on("message", async (message) => {
  if (!message.bot && message.text === "!ping") {
    await bot.sendMessage(message.channel, {
      text: "Pong!",
      replyTo: message.id,
    });
  }
});
bot.on("error", (error) => console.error(error.message));
process.once("SIGINT", () => bot.close());
await bot.connect();
```

SDK methods include `getState`, `registerCommands`, `getMessages(channel, afterId)`, `sendMessage`, `editMessage`, `deleteMessage`, `react`, `createPoll`, `endPoll`, `pendingInteractions`, `respond`, `connect`, and `close`. `VoxoraAPIError` exposes `status` and `retryAfter`; handle rate limits in your application rather than retrying writes blindly.

Gateway event callbacks: `ready`, `stateUpdate`, `message`, `messageUpdate`, `messageDelete`, `interaction`, `event`, and `error`. The SDK reconnects with bounded backoff. It stops reconnecting on 401/403 so a revoked or suspended application does not keep retrying.

## Authentication and REST

All bot routes use:

```http
Authorization: Bot <token>
```

| Method and path                          | Behavior                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/bot/me`                        | Bot identity, application metadata, installed servers and accessible text channels.                     |
| `GET /api/bot/events`                    | SSE gateway. Up to four connections per application.                                                    |
| `PUT /api/bot/commands`                  | Register `{ "commands": [...] }`, replacing all definitions. Up to 25 unique command names.             |
| `GET /api/bot/interactions`              | List accessible pending, unexpired slash-command interactions.                                          |
| `POST /api/bot/interactions/:id/respond` | Respond with `{ "text": "..." }` or `{ "poll": ... }`. One response per interaction, within 15 minutes. |
| `GET /api/bot/channels/:id/messages`     | Latest 200 accessible messages. `?after=<message ID>` returns the next 200 after that message.          |
| `POST /api/bot/channels/:id/messages`    | Send `{ "text": "...", "replyTo": "optional-message-ID" }` or a poll.                                   |
| `PATCH /api/bot/messages/:id`            | Edit the bot's own non-poll message with `{ "text": "..." }`.                                           |
| `DELETE /api/bot/messages/:id`           | Delete an own message, or another message with Manage Messages.                                         |
| `POST /api/bot/messages/:id/reactions`   | Toggle `{ "emoji": "✅" }` with Add Reactions.                                                          |
| `POST /api/bot/messages/:id/poll-close`  | End an own poll, or another poll with Manage Messages.                                                  |

Command definitions use a lowercase name matching `[a-z][a-z0-9_-]{0,31}`, a description of up to 100 characters, and an optional usage hint of up to 100 characters. Invocation arguments are a string of up to 1,000 characters. Commands and their arguments are visible in the channel; ephemeral responses are not implemented.

Bot REST traffic is limited to 300 requests per minute per application. Direct message sends have a further limit of 60 per minute. Responses return ordinary HTTP errors such as 401, 403, 404, 409 and 429. Tokens authenticate only the bot API, not human or platform administration endpoints.

## Gateway, recovery and responses

The SSE gateway emits JSON `data` events with types `READY`, `STATE_UPDATE`, `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, and `INTERACTION_CREATE`. Gateway authentication belongs in the Authorization header, not a query parameter. The SDK handles streaming UTF-8 and heartbeat comments.

`READY` and `STATE_UPDATE` contain the bot identity, application metadata and currently accessible servers/channels. Message events contain a `message` object, except deletion events, which contain `channel` and `id`. Interaction events contain `interaction` with `id`, `applicationId`, `serverId`, `channel`, `messageId`, `command`, `arguments`, `user`, `createdAt`, and `expiresAt`.

There is no message-event replay log. After reconnecting, backfill through message history and deduplicate by message ID. The SDK queries pending slash commands on reconnect and suppresses duplicate interaction events within the process. If a handler fails, inspect `pendingInteractions()` and decide whether to retry it. A successful response is accepted once, even if repeated delivery reaches your handler. A second response returns 409.

Interactions are reauthorized when read and when answered. Revoking channel access, removing the bot, deleting the command message, suspending the application or its owner, and replacing an installation prevent old commands from producing new messages. Pending interactions expire after 15 minutes; the queue is bounded and old records are pruned.

## Roles, installation scopes and moderation

Bots inherit `@everyone` and any roles assigned in **Server Settings → Members** or **Bots & Apps → Manage Bot Roles**. Channel overrides, timeouts and role hierarchy apply. Grant only the permissions the bot needs. Bots cannot become server owners or platform staff.

An installation's channel selection is an additional restriction, including for bots with Administrator. `null` means every text channel the bot can view through its roles; an empty list allows no channels. Disabling or removing an installation stops access immediately. Kicking or banning a bot also stops access. To reinstall a banned bot, revoke its ban first.

Bots bypass text slowmode but remain subject to API rate limits and Send Messages. Editing requires ownership and Send Messages; deleting other messages requires Manage Messages. Bots cannot use human sessions, friend requests, DMs, voice APIs, file uploads, arbitrary human routes or platform staff APIs through a bot token.

Platform staff can disable abusive applications. Suspending an application's human owner also pauses its bot access. Tokens are never included in admin application listings. Application deletion removes installations and invalidates credentials while preserving the public bot identity on historical messages.

## Polls

Send a poll through `sendMessage` or `createPoll`:

```js
await bot.createPoll(channelId, {
  question: "What should we play?",
  answers: ["Co-op adventure", "Party games"],
  multiple: false,
  durationHours: 24,
});
```

Polls accept 2–10 distinct answers, questions up to 300 characters, answers up to 80 characters, and durations of 1, 4, 8, 24, 72 or 168 hours. Members vote in the app with Add Reactions. They can change their choices or withdraw votes before closure. Poll creators and message moderators can end polls; the person who invoked a bot's poll command can also end that poll. Questions and answers are immutable after posting. Votes and closure persist across restarts.

## Built-in Voxora Helper

Install **Voxora Helper** from **Bots & Apps**; no token or external process is needed. It provides `/help`, `/ping`, `/roll NdM` (1–20 dice, 2–1000 sides), `/server`, and `/poll Question | Choice 1 | Choice 2`. Its access follows the same installation scopes and role permissions as custom bots.
