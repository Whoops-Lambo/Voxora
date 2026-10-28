# Voxora

A Discord-inspired community chat app for Windows and the web, with five channels, display names, search, persistent messages, and live updates between sessions connected to the same server.

## Install on Windows

1. Download [Voxora Setup 1.1.0](installers/Voxora-Setup-1.1.0.exe) using GitHub's **Download raw file** button.
2. Run the installer and choose your install folder. Installation is for your Windows account and does not require an administrator account.
3. Launch **Voxora** from the desktop or Start menu.

The installer includes the app and its runtime: no Node.js, terminal, or separate server installation is needed. Requires **64-bit Windows 10 or later**. This build is unsigned; Windows may display an unknown-publisher warning. Verify the downloaded file against `installers/SHA256SUMS.txt` if needed.

The desktop app runs its own server on `127.0.0.1:43127`. It keeps messages in `%APPDATA%\Voxora\chat-data\messages.json`, outside the installation folder, and preserves them through updates and uninstall. The display name is kept in the desktop browser profile. Another application must not be using port 43127.

**This is a local prototype.** Separate desktop installations do not share messages. Member presence is illustrative, and accounts, voice calls, and additional communities are not implemented. A hosted backend, authentication, access control, rate limits, and moderation are needed before public use.

## Develop

Requires Node.js 22 or newer for the desktop toolchain (the web server alone supports Node.js 20+).

```sh
npm ci
npm run check
npm test
npm start
```

The web server listens on port 3000. `PORT` and `VOXORA_HOST` override its listener; `VOXORA_DATA_DIR` overrides the default `.data` storage directory. Select a channel, use the gear button to choose a display name, and send messages with Enter.

### Run and build the desktop application

```sh
npm run desktop
npm run dist:win
```

`dist:win` creates an x64 NSIS installer at `dist/Voxora-Setup-1.1.0.exe`. It can be built on Windows or Linux. The application uses an isolated Electron renderer with Node integration disabled, and the desktop server only listens on loopback.

On restricted cloud machines, use writable caches:

```sh
npm ci --cache /workspace/.cache/npm
XDG_CACHE_HOME=/workspace/.cache ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder npm run dist:win
```

The Windows installer is cross-built on Linux. Backend persistence and messaging are tested automatically; Windows installation and GUI launch require a Windows machine for final validation. No signing certificate is configured.
