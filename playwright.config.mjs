import { defineConfig } from "@playwright/test";
let args = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
];
if (process.env.VOXORA_BROWSER_MODULE) {
  const { default: chromium } = await import(process.env.VOXORA_BROWSER_MODULE);
  args = [
    ...chromium.args.filter((arg) => arg !== "--single-process"),
    ...args,
  ];
}
export default defineConfig({
  testDir: "./test/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3490",
    viewport: { width: 1440, height: 900 },
    headless: true,
    permissions: ["microphone", "camera"],
    launchOptions: {
      executablePath: process.env.VOXORA_BROWSER_PATH || undefined,
      args,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node test/serve-ui.mjs",
    url: "http://127.0.0.1:3490/api/info",
    reuseExistingServer: false,
    timeout: 20000,
  },
});
