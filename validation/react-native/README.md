# Nexora React Native validation fixture

This bare React Native Community CLI app runs under Hermes and imports Nexora from a packed npm archive through Metro. It contains native checks for package exports, cookie omission and cache isolation, managed bearer-token redirects, request cancellation, retry-delay cancellation, response-body cancellation, and the `structuredClone` fallback.

The fixture is pinned to React Native 0.86.3, the proposed minimum validation target. A current-release matrix has not yet been generated or run. Record the exact React Native, Hermes, Metro, OS, device, and build-mode versions with each result. A successful Node/Vitest run or bundle build is not evidence of native compatibility. Run `npm run check` from the repository root to type-check and lint fixture sources alongside Nexora.

## Requirements

- Node.js 22.11 or newer
- Android Studio, Android SDK, Java 17, and an Android emulator or device for Android validation
- macOS and Xcode for iOS simulator or device validation
- A test hostname with a trusted HTTPS certificate reachable by the target device
- A local test-service TLS certificate and private key, or a separately hosted compatible service

The fixture uses disposable test data. Do not use production credentials. Do not disable TLS validation. For physical devices, `localhost` refers to the device itself; use a device-reachable host. For the standard Android emulator, `10.0.2.2` reaches the host computer.

## Prepare Nexora and install the fixture

From the repository root, run:

```powershell
npm --prefix .\validation\react-native run prepare:nexora
```

The script builds Nexora, creates `validation/react-native/nexora-0.1.0.tgz`, and installs the fixture dependencies from its package manifest. The archive is ignored by Git. The root build excludes test files; the package root import resolves Nexora's `exports` entry rather than a source alias.

On macOS, use `npm --prefix validation/react-native run prepare:nexora`. After editing Nexora, rerun the preparation script so the fixture consumes the updated archive.

## Run the HTTPS test service

Supply a certificate whose trust chain is accepted by the target device and whose subject alternative names include the hostname or IP address entered in the app. Keep private keys outside the repository.

```powershell
$env:NEXORA_TLS_KEY = "C:\path\to\test-key.pem"
$env:NEXORA_TLS_CERT = "C:\path\to\test-certificate.pem"
$env:NEXORA_PRIMARY_PORT = "8443"
$env:NEXORA_SECONDARY_PORT = "8444"
node .\validation\react-native\server.mjs
```

The service binds to `0.0.0.0` by default and starts primary and secondary HTTPS origins on ports 8443 and 8444. Restrict access to a trusted test network. The secondary origin must use the same device-reachable host and a different origin (the default configuration uses the second port). The service provides `/health`, `/cookie/set`, `/cookie/echo`, `/redirect/same-origin`, `/redirect/cross-origin`, `/redirect/target`, `/slow`, `/retry`, `/stream-retry`, and `/stats`.

The server certificate must be trusted by both the app platform and the device. The Android debug variant trusts system CAs and user-installed CAs; install a development CA through the Android security settings before testing. Android release and iOS builds use their normal system trust stores. Do not add certificate bypasses to the app. If local trust cannot be established, use a test endpoint on a hostname with a publicly trusted certificate.

## Run on Android

From `validation/react-native`, with Metro running in another terminal:

```powershell
npm start
npm run android
```

The initial values in the app target the standard Android emulator. For a physical device, enter the reachable HTTPS host and ports. Build and validate a release Hermes variant as well as a development build. Device cancellation and cookie behavior should be checked on a physical Android device before making a broad platform claim.

To check Metro package resolution without installing on a device, run from the fixture directory:

```powershell
npx react-native bundle --entry-file index.js --platform android --dev false --bundle-output .\build\android.bundle --assets-dest .\build\android-assets
npx react-native bundle --entry-file index.js --platform ios --dev false --bundle-output .\build\ios.bundle --assets-dest .\build\ios-assets
```

These bundle checks validate package exports and bundling only; they do not execute Hermes on either platform.

## Run on iOS

iOS builds require macOS and Xcode. From `validation/react-native`:

```sh
npm install
cd ios
bundle install
bundle exec pod install
cd ..
npm start
npm run ios
```

Set the origins in the app to a host reachable by the simulator or device. Run a release Hermes build and, where practical, repeat on a physical device. This validation cannot be performed from Windows.

## Result interpretation

- `credentials omit and cookie isolation` first proves the native cookie jar can store and return the disposable cookie using `credentials: "include"`. If that setup fails, omission is reported as inconclusive rather than passed.
- Redirect checks require managed-auth redirects to reject and verify that the cross-origin target did not receive the bearer token.
- Request cancellation requires both an `AbortError` in the app and a canceled connection observed by the server.
- Retry-delay cancellation waits beyond the retry interval and verifies that the canceled request did not retry.
- Response-body cancellation requires the service to observe closure of the streamed retry response before its body completes.
- The structured-clone check removes the global only temporarily and restores its original property descriptor afterward.
- The Metro export check is meaningful only after the app has been installed from the packed Nexora archive, not from a workspace alias.

A failed or inconclusive native check must be reported with the platform and runtime version. Do not infer success on one platform from the other or from Vitest.
