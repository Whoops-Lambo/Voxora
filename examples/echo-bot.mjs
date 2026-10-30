import { VoxoraBot } from "../sdk/voxora.mjs";

const bot = new VoxoraBot({
  url: process.env.VOXORA_URL,
  token: process.env.VOXORA_BOT_TOKEN,
});
await bot.registerCommands([
  {
    name: "echo",
    description: "Repeat your message.",
    usage: "/echo Your message",
  },
  {
    name: "bothelp",
    description: "Learn how this example works.",
    usage: "/bothelp",
  },
]);
bot.on("ready", ({ user, servers }) =>
  console.log(
    user.displayName + " connected to " + servers.length + " servers.",
  ),
);
bot.on("interaction", async (interaction) => {
  if (interaction.command === "echo")
    await interaction.respond(
      interaction.arguments || "Try /echo followed by a message.",
    );
  else if (interaction.command === "bothelp")
    await interaction.respond(
      "I’m a custom Voxora bot. My source and the SDK are included in the developer starter kit.",
    );
});
bot.on("message", async (message) => {
  if (!message.bot && message.text === "!ping")
    await bot.sendMessage(message.channel, {
      text: "Pong from your custom bot!",
      replyTo: message.id,
    });
});
bot.on("error", (error) => console.error(error.message));
process.once("SIGINT", () => bot.close());
process.once("SIGTERM", () => bot.close());
await bot.connect();
