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
  clipboard,
  powerMonitor,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { DesktopUpdater } = require("./updater.cjs");
const { launchWindowsInstaller, recordDesktopStartup } = require("./install-update.cjs");
const { DEFAULT_SERVER, LOCAL_SERVER, trustedURL, verifyServer, readConnection, saveConnection, isSetupURL } = require("./connection.cjs");
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
      const configPath = path.join(app.getPath("userData"), "connection.json");
      const setupURL = pathToFileURL(path.join(__dirname, "connection.html")).href;
      let connectionConfig = null, connectionMessage = "", selectingConnection = true, connecting = false;
      try { connectionConfig = await readConnection(configPath); }
      catch (error) { connectionMessage = error.message; }
      async function startPrivateBackend() {
        if (backend) { await backend.ready; return LOCAL_SERVER; }
        process.env.PORT = "43127";
        process.env.VOXORA_HOST = "127.0.0.1";
        process.env.VOXORA_PRIVATE_WORKSPACE = "1";
        process.env.VOXORA_DATA_DIR = path.join(app.getPath("userData"), "chat-data");
        backend = await import(pathToFileURL(path.join(__dirname, "..", "server.js")).href);
        await backend.ready;
        return LOCAL_SERVER;
      }
      const verify = (origin, instanceId) => verifyServer(origin, { instanceId, fetch: (url,options) => net.fetch(url,options) });
      async function showConnection(message = "") {
        selectingConnection = true; connectionMessage = message;
        await mainWindow.loadURL(setupURL); mainWindow.show();
        await recordDesktopStartup(path.join(app.getPath('userData'), 'updates'), app.getVersion(), undefined, 'setup').catch(console.error);
      }
      async function activateConnection(value, expectedInstance = null) {
        const origin = value.mode === "host" ? await startPrivateBackend() : trustedURL(value.server);
        const info = await verify(origin, expectedInstance);
        const next = { mode: value.mode, server: origin, instanceId: info.instanceId };
        await saveConnection(configPath, next);
        connectionConfig = next; appOrigin = origin; selectingConnection = false;
        await mainWindow.loadURL(origin + info.appPath);
        await recordDesktopStartup(path.join(app.getPath("userData"), "updates"), app.getVersion()).catch(console.error);
        return { ok: true };
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
        if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
          !(selectingConnection && isSetupURL(event.senderFrame.url,path.join(__dirname,'connection.html'))) && new URL(event.senderFrame.url).origin !== appOrigin)
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
        if (state.phase === "ready" && !state.error && mainWindow.isVisible()) offerInstall().catch(error => dialog.showErrorBox("Update could not install", error.message));
      });
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: "Voxora", submenu: [
          { label: "Check for Updates…", enabled: updater.supported, click: async () => {
            try {
              const state = await updater.check({force:true});
              if (state.phase === "ready") await offerInstall(true);
              else if (state.phase === "available") {
                const result = await dialog.showMessageBox(mainWindow, { title: "Voxora update available", message: `Download Voxora ${state.availableVersion}?`, detail: state.notes, buttons: ["Download", "Later"], cancelId: 1 });
                if (result.response === 0) await updater.download();
              } else if (!["checking", "downloading", "installing"].includes(state.phase)) await dialog.showMessageBox(mainWindow, { title: "Voxora Updates", message: state.error || `Voxora ${state.currentVersion} is up to date.` });
            } catch (error) { dialog.showErrorBox("Update check failed", error.message); }
          } },
          { id: "install-update", label: "Restart and Install Update…", enabled: updater.phase === "ready", click: () => offerInstall(true).catch(error => dialog.showErrorBox("Update could not install", error.message)) },
          { label: "Copy Update Diagnostics", click: async () => clipboard.writeText(await updater.diagnostics()) },
          { label: "Server Connection…", click: () => showConnection().catch(error => dialog.showErrorBox("Connection setup", error.message)) },
          { type: "separator" }, { role: "quit" },
        ] }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
      ]));
      for (const [channel, action] of Object.entries({
        "voxora:update-state": () => updater.snapshot(), "voxora:update-check": () => updater.check({force:true}),
        "voxora:update-download": () => updater.download(), "voxora:update-install": () => offerInstall(true),
        "voxora:update-settings": (value) => updater.settings(value),
        "voxora:update-diagnostics": async () => { clipboard.writeText(await updater.diagnostics()); return {ok:true}; },
      })) ipcMain.handle(channel, (event, value) => { trustedIPC(event); return action(value); });
      const trustedConnection = event => {
        if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
          !(selectingConnection && isSetupURL(event.senderFrame.url,path.join(__dirname,'connection.html'))) && new URL(event.senderFrame.url).origin !== appOrigin)
          throw Error("Untrusted connection request.");
      };
      ipcMain.handle("voxora:connection-info", async event => {
        trustedConnection(event);
        if (!selectingConnection || !isSetupURL(event.senderFrame.url,path.join(__dirname,'connection.html'))) throw Error("Open Server Connection to inspect setup.");
        return { server: connectionConfig?.server || DEFAULT_SERVER, message: connectionMessage,
          hasLocalData: await fs.stat(path.join(app.getPath("userData"), "chat-data", "state.json")).then(() => true, () => false) };
      });
      ipcMain.handle("voxora:connect", async (event, value) => {
        trustedConnection(event);
        if (connecting) throw Error("A connection attempt is already in progress.");
        connecting = true;
        try { const server = trustedURL(value); return await activateConnection({mode: backend && server === LOCAL_SERVER ? "host" : "remote", server}); }
        finally { connecting = false; }
      });
      ipcMain.handle("voxora:private-workspace", async event => {
        trustedConnection(event);
        if (!selectingConnection || !isSetupURL(event.senderFrame.url,path.join(__dirname,'connection.html'))) throw Error("Choose a private workspace from Server Connection.");
        if (connecting) throw Error("A connection attempt is already in progress.");
        connecting = true;
        try { return await activateConnection({mode:"host",server:LOCAL_SERVER}); }
        finally { connecting = false; }
      });
      mainWindow.once("ready-to-show", () => mainWindow.show());
      await showConnection(connectionMessage || (connectionConfig ? "Connecting to your saved Voxora server…" : ""));
      if (process.argv.includes("--voxora-private-host") || connectionConfig) {
        connecting = true;
        try {
          const selected = process.argv.includes("--voxora-private-host") ? {mode:"host",server:LOCAL_SERVER} : connectionConfig;
          await activateConnection(selected, selected.instanceId);
        } catch (error) { await showConnection(error.message + " Your saved workspace has not been replaced."); }
        finally { connecting = false; }
      }
      if (updater.recoveryMessage) dialog.showErrorBox("Voxora update did not finish", updater.recoveryMessage);
      updater.start();
      mainWindow.on('focus', () => updater.wake());
      powerMonitor.on('resume', () => updater.wake());
      if (updater.phase === "ready" && !updater.error) offerInstall().catch(error => dialog.showErrorBox("Update could not install", error.message));
    } catch (error) {
      dialog.showErrorBox(
        "Voxora could not start",
        error.message,
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
