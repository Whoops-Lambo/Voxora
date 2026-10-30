import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VoxoraBot, VoxoraAPIError } from "../sdk/voxora.mjs";
import { CommunityStore } from "./community-state.mjs";
import { commands, handleCommand } from "./community-commands.mjs";

const bot = new VoxoraBot({ url: process.env.VOXORA_URL, token: process.env.VOXORA_BOT_TOKEN });
const info = await bot.verifyServer();
if (!info.capabilities?.botModeration)
  throw Error("This community template needs Voxora 2.5 or later. Upgrade the desktop app or shared backend, then keep it running. Download: https://github.com/Whoops-Lambo/Voxora#install-on-windows");
const identity = await bot.getState();
const namespace = createHash("sha256").update(identity.application.id).digest("hex").slice(0, 24);
const dataDir = process.env.VOXORA_BOT_DATA_DIR ? path.resolve(process.env.VOXORA_BOT_DATA_DIR) : fileURLToPath(new URL("../bot-data", import.meta.url));
const store = await new CommunityStore(path.join(dataDir, namespace + ".json")).open();
let stopping = false;
async function stop() { stopping = true; bot.close(); await store.close(); }
try {
  await bot.registerCommands(commands);
  bot.on("ready", ({ user, servers }) => console.log(user.displayName + " connected to " + servers.length + " servers. 25 commands ready; use /bothelp."));
  bot.on("interaction", async (interaction) => {
    if (stopping) return;
    try {
      const context = await interaction.context();
      if (stopping) return;
      const response = await handleCommand(interaction, context, store);
      if (!stopping) await interaction.respond(response);
    } catch (error) {
      if (error instanceof VoxoraAPIError && [404, 409, 410].includes(error.status)) return;
      console.error("Command /" + interaction.command + ": " + error.message);
      if (!stopping) await interaction.respond({ text: error instanceof VoxoraAPIError && error.status < 500 ? error.message : "Could not complete this command. Check the bot console and try again." }).catch(() => {});
    }
  });
  bot.on("message", async (message) => {
    if (!stopping && !message.bot && message.text === "!ping")
      await bot.sendMessage(message.channel, { text: "Pong from your custom bot!", replyTo: message.id });
  });
  bot.on("error", (error) => console.error(error.message));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await bot.connect();
} finally { await stop(); }
