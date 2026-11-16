# First Google Play release

Application ID: com.voxora.app. Version: 3.8.0 (versionCode 3008000).
Target SDK: 36. Minimum SDK: 24. Keep the package ID stable and increase versionCode
for every subsequent Play upload.

Build with Java 21, Android SDK 36/build tools 36.0.0 and the locked mobile dependencies:

    npm ci --prefix mobile
    cd mobile
    ./node_modules/.bin/cap sync android
    cd android
    ./gradlew --no-daemon bundleRelease

For a signed upload set VOXORA_UPLOAD_STORE to an absolute upload-keystore path and
VOXORA_UPLOAD_ALIAS, VOXORA_UPLOAD_STORE_PASSWORD and VOXORA_UPLOAD_KEY_PASSWORD
securely in the build process. Without these, release builds remain unsigned.
Never commit the keystore or passwords. Back up the upload key and credentials
outside the environment before publishing or discarding it.

Output: mobile/android/app/build/outputs/bundle/release/app-release.aab.
Verify with jarsigner -verify and bundletool validate. This is an upload-signed
bundle for Play App Signing, not an APK to sideload. Enroll in Play App Signing
on the first upload and retain the upload certificate for future releases.

Developer account verification may block Console upload or publication, but does not
prevent creating this bundle. Finish verification, the store listing, app access
instructions, privacy policy, Data safety, content rating and any required testing in
Play Console. Do not claim account verification or policy approval from a successful
local build. The app connects to the existing HTTPS Voxora service; deploy matching
backend changes separately.

The manually dispatched Google Play upload bundle workflow uses GitHub Actions secrets
VOXORA_UPLOAD_KEY_BASE64, VOXORA_UPLOAD_ALIAS, VOXORA_UPLOAD_STORE_PASSWORD and
VOXORA_UPLOAD_KEY_PASSWORD. Configure these securely before running it. Its artifact
contains only the signed AAB; it does not publish to Play or modify the existing APK
and iPhone workflows.
