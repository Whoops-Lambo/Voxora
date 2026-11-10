# Install Voxora on Android or iPhone

All mobile versions connect to **https://voxora-public.onrender.com/app**, using the same public account, communities, friends and messages as the shared Windows app. They do not start separate local servers or create new platform owners. Earlier local desktop accounts remain separate.

## Android APK

Download `mobile-releases/Voxora-Android-3.4.0.apk` from this repository, open it in Downloads, and allow your browser/file manager to install it when Android asks. Requires Android 7/API 24 or later and an up-to-date Android System WebView. Microphone/camera access is requested when you choose to use a call. The package uses HTTPS and does not back up browser sessions to Android cloud backup.

This is a release APK signed with Voxora's private Android signing key. Future APKs must use the same key and a higher version code to install as updates. The key and password are kept outside the source repository; they must never be committed or published. Native builds use Capacitor 8.6.0 and a shared HTTPS backend. The native shell is not an embedded desktop server.

## iPhone — no App Store or signing account

1. Open **https://voxora-public.onrender.com/app** in Safari.
2. Tap **Share → Add to Home Screen**.
3. Leave **Open as Web App** enabled if shown and select **Add**.
4. Open Voxora from the new Home Screen icon and sign in.

This installed web app has its own icon and standalone window. It does not expire weekly and does not require Apple review or a developer subscription. The service worker caches only the offline information page and public app icon; accounts, messages, attachments, APIs and application scripts are not cached by it. If background notifications are enabled, the worker stores one account identifier for delivery isolation; it stores no message history. Drafts keep using the existing device-local storage. Safari controls browser capabilities and background execution.

## iPhone — native IPA without App Store submission

Download `mobile-releases/Voxora-iOS-3.4.0-unsigned.ipa`. Requires iOS 16.4 or later. The IPA is deliberately unsigned: Apple requires a valid signature and device provisioning before it can run on a physical iPhone.

Use **AltStore Classic/AltServer** from <https://altstore.io> or **Sideloadly** from <https://sideloadly.io> on your Mac/Windows computer to sign and install it with your own Apple ID. Follow that tool's device-pairing and Developer Mode instructions. Free Apple ID provisioning generally expires after seven days and must be renewed; paid developer provisioning has different limits. Downloading an IPA or opening a link in Safari does not bypass these requirements. No Apple ID credentials are collected by Voxora.

The iPhone simulator build is compiled, installed and launched in CI. Physical-device signing and installation must be completed using your own Apple account/device. The Home Screen web app above provides installation without that signing process.

## Updating and building

Deploy backend changes to Render so every mobile client receives the current chat interface. Enable **Auto-Deploy → On Commit** or use **Manual Deploy → Deploy latest commit**. Reopen/reload the app after deployment. A desktop EXE does not update the hosted service. Sounds/live updates operate while Voxora is running. The Home Screen web app supports opt-in Web Push as described below. Native background calling is not included.

Native projects are in `mobile/android` and `mobile/ios`. Run `npm ci` in `mobile`, then `npm run sync`. Android uses JDK 21, SDK/build-tools 36 and the included Gradle wrapper. iOS builds require macOS/Xcode. The Mobile packages workflow builds unsigned candidates, launches Android and iPhone simulator builds, and records source commits and SHA-256 checksums on `mobile-artifacts/android-<version>-<source-sha>` and `mobile-artifacts/ios-<version>-<source-sha>` branches. Android candidates are signed privately before publication. Keep the Android keystore/password in a secure backup; losing them prevents compatible APK updates.

## iPhone background notifications with a free Apple ID

A native IPA signed with a free Apple ID cannot use APNs background notifications. Sideloadly or AltStore cannot enable that Apple entitlement. Use the free Home Screen web app for closed-app notifications instead:

1. Use iOS/iPadOS 16.4 or later. Open the shared `/app` URL in Safari.
2. Share → Add to Home Screen, then launch **that Home Screen icon** and sign in.
3. User Settings → Notifications → **Enable Background Notifications**, then allow the iPhone permission prompt.
4. Choose **Send Test Notification**. Check iPhone Settings → Notifications and Focus settings if alerts or sounds are silenced.

DMs and eligible server/thread mentions use encrypted Web Push, with read state, mutes, DND, blocks and access rechecked before delivery. Previews default off. Disabling notifications or signing out revokes the session's subscription. Device/browser settings and push-provider delivery determine whether a particular alert arrives; this feature does not guarantee delivery. The native IPA keeps its foreground alerts and links to these installation steps.

Deploy Voxora 3.3.1 or newer on the shared backend first. Keep `push-keys.json` **private** and back it up with the persistent data directory. The server creates VAPID keys automatically; no Apple developer account or APNs certificate is needed for Web Push. Configure `VOXORA_PUSH_SUBJECT` with an operator HTTPS contact URL or mailto address if desired. Losing those keys requires clients to enable notifications again.

## Phone and tablet update (3.4.0)

The new native clients explicitly disable webview zoom and iPhone viewport bounce. The hosted chat interface prevents pinch/double-tap and focus zoom, keeps text fields at readable sizes and adapts to the keyboard, safe areas and tablet orientation. Deploy the new backend to activate the hosted layout, voice messages, forwarding and advanced search. See [Mobile, voice and sharing](MOBILE-AND-SHARING.md).
