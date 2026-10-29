const {
  app,
  BrowserWindow,
  dialog,
  session,
  ipcMain,
  desktopCapturer,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
let mainWindow,
  backend,
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
        if (!result.ok || (await result.json()).name !== "Voxora")
          throw new Error("This address is not a reachable Voxora server.");
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
      ipcMain.handle("voxora:connect", async (event, value) => {
        if (
          event.sender !== mainWindow.webContents ||
          new URL(event.senderFrame.url).origin !== appOrigin
        )
          throw new Error("Untrusted request.");
        const origin = trustedURL(value);
        await verify(origin);
        await fs.writeFile(configPath, JSON.stringify({ server: origin }));
        appOrigin = origin;
        await mainWindow.loadURL(origin);
        return { ok: true };
      });
      mainWindow.once("ready-to-show", () => mainWindow.show());
      await mainWindow.loadURL(appOrigin);
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
