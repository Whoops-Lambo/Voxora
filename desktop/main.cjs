const {
  app,
  BrowserWindow,
  dialog,
  session,
  ipcMain,
  desktopCapturer,
  shell,
  Menu,
  net,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { DesktopUpdater } = require("./updater.cjs");
const { launchWindowsInstaller } = require("./install-update.cjs");
let mainWindow,
  backend,
  updater,
  quitting = false,
  appOrigin;
app.setName("Voxora");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      process.env.PORT = "43127";
      process.env.VOXORA_HOST = "127.0.0.1";
      process.env.VOXORA_DATA_DIR = path.join(
        app.getPath("userData"),
        "chat-data",
      );
      backend = await import(
        pathToFileURL(path.join(__dirname, "..", "server.js")).href
      );
      const address = await backend.ready;
      const localOrigin = `http://127.0.0.1:${address.port}`;
      appOrigin = localOrigin;
      const configPath = path.join(app.getPath("userData"), "connection.json");
      const trustedURL = (value) => {
        const url = new URL(value);
        if (
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error(
            "Enter a server origin without a path or credentials.",
          );
        if (
          url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["127.0.0.1", "localhost"].includes(url.hostname)
          )
        )
          throw new Error("Use an HTTPS server address.");
        return url.origin;
      };
      async function verify(origin) {
        const result = await fetch(origin + "/api/info", {
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        const info = await result.json();
        if (!result.ok || info.name !== "Voxora")
          throw new Error("This address is not a reachable Voxora server.");
        return info.appPath === "/app" ? "/app" : "/";
      }
      try {
        const config = JSON.parse(await fs.readFile(configPath, "utf8"));
        const remote = trustedURL(config.server);
        await verify(remote);
        appOrigin = remote;
      } catch (error) {
        if (error.code !== "ENOENT")
          dialog.showErrorBox(
            "Server unavailable",
            "Opening the local server instead. You can change the server connection from User Settings.",
          );
      }
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, origin) =>
          contents === mainWindow?.webContents &&
          ["media", "display-capture", "notifications"].includes(permission) &&
          new URL(origin).origin === appOrigin,
      );
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) => {
          let trusted = false;
          try {
            trusted =
              new URL(details.requestingUrl || contents.getURL()).origin ===
              appOrigin;
          } catch {}
          callback(
            contents === mainWindow?.webContents &&
              trusted &&
              ["media", "display-capture", "notifications"].includes(
                permission,
              ),
          );
        },
      );
      session.defaultSession.setDisplayMediaRequestHandler(
        async (request, callback) => {
          try {
            if (new URL(request.frame.url).origin !== appOrigin)
              return callback({});
            const sources = await desktopCapturer.getSources({
              types: ["screen", "window"],
            });
            const selection = await dialog.showMessageBox(mainWindow, {
              type: "question",
              title: "Share your screen",
              message: "Choose what to share",
              buttons: [...sources.map((s) => s.name), "Cancel"],
              cancelId: sources.length,
            });
            callback(
              selection.response < sources.length
                ? { video: sources[selection.response] }
                : {},
            );
          } catch {
            callback({});
          }
        },
        { useSystemPicker: true },
      );
      mainWindow = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 700,
        minHeight: 550,
        title: "Voxora",
        backgroundColor: "#313338",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: "deny" };
      });
      mainWindow.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== appOrigin) event.preventDefault();
      });
      const trustedIPC = (event) => {
        if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== appOrigin)
          throw new Error("Untrusted request.");
      };
      updater = new DesktopUpdater({
        version: app.getVersion(), directory: path.join(app.getPath("userData"), "updates"),
        fetch: (url, options) => net.fetch(url, { ...options, credentials: "omit" }),
        supported: app.isPackaged && process.platform === "win32" && process.arch === "x64",
        launchInstaller: launchWindowsInstaller, quit: () => app.quit(),
      });
      await updater.initialize();
      let offer, promptedVersion;
      function offerInstall(manual = false) {
        if (offer) return offer;
        if (updater.phase !== "ready" || (!manual && promptedVersion === updater.release.version)) return Promise.resolve(updater.snapshot());
        promptedVersion = updater.release.version;
        offer = (async () => {
          const result = await dialog.showMessageBox(mainWindow, { type: "info", title: "Voxora update ready", message: `Voxora ${updater.release.version} is ready to install`, detail: "Restart Voxora to install the update. Active calls will disconnect. Your accounts, messages, and settings are preserved.\n\n" + updater.release.notes, buttons: ["Restart and Install", "Later"], defaultId: 1, cancelId: 1 });
          if (result.response === 0) await updater.install();
          return updater.snapshot();
        })().finally(() => { offer = null; });
        return offer;
      }
      updater.on("change", (state) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("voxora:update-state", state);
        const item = Menu.getApplicationMenu()?.getMenuItemById("install-update"); if (item) item.enabled = state.phase === "ready";
        if (state.phase === "ready" && mainWindow.isVisible()) offerInstall().catch(error => dialog.showErrorBox("Update could not install", error.message));
      });
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: "Voxora", submenu: [
          { label: "Check for Updates…", enabled: updater.supported, click: async () => {
            try {
              const state = await updater.check();
              if (state.phase === "ready") await offerInstall(true);
              else if (state.phase === "available") {
                const result = await dialog.showMessageBox(mainWindow, { title: "Voxora update available", message: `Download Voxora ${state.availableVersion}?`, detail: state.notes, buttons: ["Download", "Later"], cancelId: 1 });
                if (result.response === 0) await updater.download();
              } else if (!["checking", "downloading", "installing"].includes(state.phase)) await dialog.showMessageBox(mainWindow, { title: "Voxora Updates", message: state.error || `Voxora ${state.currentVersion} is up to date.` });
            } catch (error) { dialog.showErrorBox("Update check failed", error.message); }
          } },
          { id: "install-update", label: "Restart and Install Update…", enabled: updater.phase === "ready", click: () => offerInstall(true).catch(error => dialog.showErrorBox("Update could not install", error.message)) },
          { type: "separator" }, { role: "quit" },
        ] }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
      ]));
      for (const [channel, action] of Object.entries({
        "voxora:update-state": () => updater.snapshot(), "voxora:update-check": () => updater.check(),
        "voxora:update-download": () => updater.download(), "voxora:update-install": () => offerInstall(true),
        "voxora:update-settings": (value) => updater.settings(value),
      })) ipcMain.handle(channel, (event, value) => { trustedIPC(event); return action(value); });
      ipcMain.handle("voxora:connect", async (event, value) => {
        trustedIPC(event);
        const origin = trustedURL(value);
        const appPath = await verify(origin);
        await fs.writeFile(configPath, JSON.stringify({ server: origin }));
        appOrigin = origin;
        await mainWindow.loadURL(origin + appPath);
        return { ok: true };
      });
      mainWindow.once("ready-to-show", () => mainWindow.show());
      await mainWindow.loadURL(appOrigin + (await verify(appOrigin)));
      updater.start();
      if (updater.phase === "ready") offerInstall().catch(error => dialog.showErrorBox("Update could not install", error.message));
    } catch (error) {
      dialog.showErrorBox(
        "Voxora could not start",
        `${error.message}\n\nClose any other program using port 43127 and try again.`,
      );
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    updater?.stop();
    if (backend && !quitting) {
      event.preventDefault();
      quitting = true;
      backend
        .shutdown()
        .catch(console.error)
        .finally(() => app.quit());
    }
  });
}
