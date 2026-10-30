import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ZipFile } = require("yazl");
const zip = new ZipFile();
const stableMetadata = { mtime: new Date("2020-01-01T00:00:00Z") };
for (const [source, target] of [
  ["sdk/voxora.mjs", "sdk/voxora.mjs"],
  ["examples/echo-bot.mjs", "examples/echo-bot.mjs"],
  ["examples/community-state.mjs", "examples/community-state.mjs"],
  ["examples/community-commands.mjs", "examples/community-commands.mjs"],
  ["examples/.env.example", "examples/.env.example"],
  ["examples/starter-package.json", "package.json"],
  ["examples/start-bot.bat", "start-bot.bat"],
  ["examples/start-bot.mjs", "start-bot.mjs"],
  ["docs/BOTS.md", "README.md"],
]) {
  const content = await readFile(new URL("../" + source, import.meta.url));
  zip.addBuffer(
    target.endsWith(".bat")
      ? Buffer.from(content.toString("utf8").replace(/\r?\n/g, "\r\n"))
      : content,
    "voxora-bot/" + target,
    stableMetadata,
  );
}
zip.addBuffer(Buffer.from(".env\nnode_modules/\nbot-data/\n"), "voxora-bot/.gitignore", stableMetadata);
zip.end();
const chunks = [];
for await (const chunk of zip.outputStream) chunks.push(chunk);
await writeFile(
  new URL("../public/bot-starter.zip", import.meta.url),
  Buffer.concat(chunks),
);
console.log("Built the Voxora bot starter ZIP.");
