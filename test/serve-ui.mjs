import { mkdtemp, rm } from "node:fs/promises";
const dir = await mkdtemp("/tmp/voxora-ui-");
process.env.VOXORA_DATA_DIR = dir;
process.env.PORT = "3490";
process.env.VOXORA_HOST = "127.0.0.1";
const { shutdown } = await import("../server.js");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await shutdown();
  await rm(dir, { recursive: true, force: true });
  process.exit();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
