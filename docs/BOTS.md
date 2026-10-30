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

The community example registers 25 moderation, economy, and utility commands and also responds to the text `!ping`. It requires **Voxora 2.5 or later**; upgrade your desktop app or shared backend before running this template. Keep the process running to keep its gateway connection online. Stop it with Ctrl+C. Voxora does not execute third-party bot source code inside its server.

### Connection problems

The launcher checks `/api/info` before registering commands. If it reports **Not found**, **invalid JSON**, or **not a Voxora backend**, check `VOXORA_URL` in your existing `.env`. The Windows desktop app uses `http://127.0.0.1:43127`; port `3000` is for a separately started Node backend. Keep the desktop app open. Use the same backend on which you created the token, especially if your desktop client connects to a shared server.

The basic bot API requires **Voxora 2.4 or later**; this community template requires **Voxora 2.5 or later**. An older running app or shared backend must be upgraded; replacing the bot starter alone does not upgrade the backend. If the token is rejected, use a token from that backend's Developer Portal. Rotate a token that was shared and update `.env` locally.

Starter updates preserve existing `.env` files, so change a previously saved port `3000` yourself when using the desktop app. Never paste the token into a support message. The SDK reports HTTP status and connection guidance without printing an unexpected response body.

## Community template commands

Use `/bothelp` for an overview or `/bothelp moderation`, `/bothelp economy`, and `/bothelp utility` for detailed usage. Select this bot in the command picker if another installed bot registers the same name.

| Category | Commands |
| --- | --- |
| Moderation | `/warn @user reason`, `/warnings @user`, `/clearwarns @user [reason]`, `/timeout @user 10m [reason]`, `/untimeout @user [reason]`, `/kick @user [reason]`, `/ban @user [reason]`, `/unban @user-or-id [reason]`, `/purge 1–50 [reason]` |
| Economy | `/balance [@user]`, `/daily`, `/work`, `/pay @user amount`, `/leaderboard`, `/shop`, `/buy item-id`, `/inventory [@user]` |
| Utilities | `/bothelp [category]`, `/echo message`, `/roll 2d6`, `/choose first | second`, `/eightball question`, `/serverinfo`, `/userinfo [@user]`, `/poll question | choice one | choice two` |

Mention members using their unique `@username` or user ID. Timeout durations accept `s`, `m`, `h`, or `d`, up to 28 days. Warning reasons are required. Purge skips pinned messages and its own command invocation. All command arguments and replies are visible in their channel.

### Moderator setup

Install the bot, create a server role in **Server Settings → Roles**, enable only the permissions you need, and assign it in **Bots & Apps → Manage Bot Roles**. Place that role above members the bot should moderate. Warn/review/clear warnings and timeout commands need **Timeout Members** (`moderateMembers`); kicks need Kick Members; bans/unbans need Ban Members; purge needs Manage Messages in that channel.

The API checks both the original command user's and bot's current permissions. Both must outrank a target, and owners remain protected. Timeouts also protect administrators. The bot's token alone cannot invent a human requester: moderation requires an accessible, pending interaction belonging to that application. Mutations recheck access after receiving the request body. The backend saves a single action receipt with its state change; replaying the same interaction returns its result rather than repeating the action. Reusing it for another action is rejected. Audit logs include the bot and human requester. Warning records persist in backend state and are excluded from ordinary server views.

### Economy and backups

`/daily` awards 250 credits every 24 hours. `/work` awards 25–100 credits every 15 minutes. `/pay` accepts positive whole numbers up to 1,000,000 credits and cannot pay yourself or a bot. Balances are capped at 1,000,000,000 credits. The shop sells one each of bronze (250), silver (1,000), and diamond (5,000) collectible badges. These are cosmetic bot inventory items; they do not assign Voxora roles or permissions.

Data lives beside the starter in **`bot-data/`**, in a JSON file per application with separate accounts per server. Keep that folder when updating, rotating tokens, or restarting. `VOXORA_BOT_DATA_DIR` optionally chooses a persistent folder. Back it up while the bot is stopped. Do not commit it. A process lock prevents simultaneous instances from writing the same file; stop the old console before starting another. A crashed process's stale lock is recovered on the next launch. Atomic writes and receipts prevent overlapping or replayed commands from duplicating credits or overspending. Receipts are retained for one day, capped at 10,000. This starter is intended for one running process per data file; use a transactional database when building a distributed bot.

## JavaScript SDK

```js
import { VoxoraBot } from "./sdk/voxora.mjs";

const bot = new VoxoraBot({
  url: process.env.VOXORA_URL,
  token: process.env.VOXORA_BOT_TOKEN,
});

await bot.verifyServer();
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

SDK methods include `getInteractionContext`, `moderateInteraction`, `verifyServer`, `getState`, `registerCommands`, `getMessages(channel, afterId)`, `sendMessage`, `editMessage`, `deleteMessage`, `react`, `createPoll`, `endPoll`, `pendingInteractions`, `respond`, `connect`, and `close`. `verifyServer` checks the backend's public identity/version without sending your bot token. `VoxoraAPIError` exposes `status` and `retryAfter`; handle rate limits in your application rather than retrying writes blindly.

Interaction callbacks also expose `interaction.context()` and `interaction.moderate(options)`, alongside `interaction.respond(response)`. Context and moderation are authorized against the original command and current access.

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
| `GET /api/bot/interactions/:id/context` | Current invoking user permissions, server/member metadata and scoped ban identities. Requires Voxora 2.5+. |
| `POST /api/bot/interactions/:id/moderation` | Perform an authorized moderation action with `{ action, targetId, reason, durationSeconds?, count? }`. One action receipt per interaction. Requires Voxora 2.5+. |
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
