# Desktop updates and release publishing

Install **Voxora 2.8 or later once manually**. Older copies have no update checker and cannot receive this feature remotely. Automatic updates support the installed Windows x64 app; source-mode Electron and other operating systems show an unsupported status.

## Receiving updates

Voxora checks 15 seconds after startup and every 15 minutes while open. Downloads are automatic by default. **User Settings → Updates** lets you disable automatic downloads, check manually, download a release, inspect progress/notes, and select **Restart and Install**. Press Alt for the native **Voxora** menu when connected to a backend whose web UI predates this feature.

A native dialog always asks before a restart. Select **Later** to keep chatting. Installing disconnects calls, cleanly closes the local backend, waits for the app to exit, and runs the installer silently in the existing installation directory before relaunching. The installer preserves `%APPDATA%\Voxora\chat-data`, browser sessions/preferences, and the saved server connection. It does not upgrade a remote backend or a separately running bot process.

The updater uses a fixed HTTPS feed at `https://raw.githubusercontent.com/Whoops-Lambo/Voxora/main/updates/stable.json`. Feed entries must reference a full commit SHA and the matching version's installer in the official repository. Download redirects cannot switch repositories or commits. SHA-256, exact size, and Windows executable headers are verified before a download is marked ready and again at installation. Older or equal versions are never installed. Requests use Electron's networking and system proxy settings, without account cookies or bot tokens.

Updates are **unsigned**. Checksums verify the bytes published by the official GitHub repository; they do not provide a code-signing identity independent of that repository. The repository and feed must remain publicly readable. Native Windows update installation/relaunch has not been validated on a Windows machine.

## Publishing a release

The source checkout includes a release pusher. Install Node.js 22+, Git, and Git LFS, run `npm ci`, and authenticate Git for write access to **Whoops-Lambo/Voxora**. Use your usual Git credential manager; no token belongs in the application, source, feed, or downloaded bot starter.

1. Finish and test the source changes. Increase the stable version with `npm version patch --no-git-tag-version` (or choose the next minor version). Update documentation/download links as appropriate. Add optional release notes at `docs/releases/<version>.md`, up to 8,000 characters.
2. Commit those source changes. The pusher requires a clean working tree and a newer stable version; it never automatically commits unrelated work or force-pushes.
3. Preview with `npm run release:push -- --dry-run`.
4. Run **`npm run release:push`**, or double-click **`push-update.bat`** on Windows. You can use `--notes-file path/to/notes.md` for another notes file.
5. After publishing, open **Platform Admin → Updates → Notify Desktop Clients** on your shared backend to request an immediate check. This is owner-only, audited, and limited to once a minute. Apps that are offline or connected elsewhere check on their own schedule.

The pusher checks remote ancestry, runs syntax/backend tests, builds the Windows app, verifies its ASAR files against the committed source, and generates the source ZIP. It commits the installer through Git LFS, its SHA-256 manifest, and `Voxora.zip`; a second commit adds the feed pinned to the first commit. Both commits are pushed together to main, after LFS uploads complete. Keep full browser regression testing in your release routine (`npm run test:ui`).

The source ZIP includes the SDK, bot starter, updater, installer script, and release pusher. It excludes installers, runtime chat/economy data, `.env` credentials, and the mutable update feed, which is published after the artifact commit. Windows builds use `build/windows.cjs` to allow the pinned NSIS compressor up to ten minutes on slower machines, without changing installer behavior.

`npm run release:push -- --reuse-build` reuses an existing `dist` build after the same source/bundle verification; use it only for a build you just completed and tested. Installer files and versions are immutable: publish a newer version rather than replacing an existing release.

## Recovering from failures

- **Download interrupted, offline, or checksum failed:** the partial file is discarded, the existing app keeps running, and the Updates screen offers another download. A completed verified update survives app restarts. Close/reopen the app if a manual check was just throttled; normal checks retry automatically.
- **Restart declined:** the verified installer stays cached until you choose Restart and Install.
- **Installation failed:** the helper records the result and attempts to reopen Voxora. The old app shows that the update did not complete. Retry from Updates or download the official installer manually. The helper never force-kills a stuck app.
- **Release upload failed:** local release commits are retained. Run `npm run release:push -- --resume` from the clean checkout to finish the same release; the pusher rechecks the committed installer checksum and feed. Do not reset or overwrite a version to retry. If main advanced, merge/rebase your unpublished commits, then resume without force-pushing.
- **Old shared backend:** the app's native updater works independently of the backend. Its web UI may lack the Updates tab and owner notification control until you upgrade that backend.

The updater cache is under `%APPDATA%\Voxora\updates`; it is separate from chat data. Installation messages, installer paths, and update preferences are local desktop state, never exposed through server administration APIs. A server owner can ask clients to check the official feed; they cannot choose an executable URL, bypass verification, or force a restart.
