import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ZipFile } = require("yazl");
const zip = new ZipFile();
for (const [source, target] of [
  ["sdk/voxora.mjs", "sdk/voxora.mjs"],
  ["examples/echo-bot.mjs", "examples/echo-bot.mjs"],
  ["examples/.env.example", "examples/.env.example"],
  ["examples/starter-package.json", "package.json"],
  ["docs/BOTS.md", "README.md"],
])
  zip.addBuffer(
    await readFile(new URL("../" + source, import.meta.url)),
    "voxora-bot/" + target,
  );
zip.addBuffer(Buffer.from(".env\nnode_modules/\n"), "voxora-bot/.gitignore");
zip.end();
const chunks = [];
for await (const chunk of zip.outputStream) chunks.push(chunk);
await writeFile(
  new URL("../public/bot-starter.zip", import.meta.url),
  Buffer.concat(chunks),
);
console.log("Built the Voxora bot starter ZIP.");
