import process from "node:process";
import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

try {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw Error("Install Node.js 22 or later from https://nodejs.org/.");

  const config = new URL("./.env", import.meta.url);
  try {
    await copyFile(
      new URL("./examples/.env.example", import.meta.url),
      config,
      constants.COPYFILE_EXCL,
    );
    console.log("Created .env for your bot settings.");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  process.loadEnvFile(fileURLToPath(config));

  if (
    !process.env.VOXORA_URL?.trim() ||
    !/^vxb_[a-f0-9]{64}$/.test(process.env.VOXORA_BOT_TOKEN || "")
  ) {
    console.error(
      "Edit .env in this folder: set VOXORA_URL to your Voxora server and VOXORA_BOT_TOKEN to the token from Developer Portal.",
    );
    console.error(
      "For the desktop app on this computer, use http://127.0.0.1:43127. Keep the token private.",
    );
    process.exitCode = 2;
  } else {
    console.log(
      "Checking Voxora and starting the bot. Keep this window open; press Ctrl+C to stop.",
    );
    await import("./examples/echo-bot.mjs");
  }
} catch (error) {
  console.error("Could not start the Voxora bot: " + error.message);
  process.exitCode = error.connectionProblem ? 2 : 1;
}
