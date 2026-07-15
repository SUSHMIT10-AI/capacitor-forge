# AABforge

AABforge builds signed Android App Bundles for Google Play from web URLs or uploaded Capacitor projects.

## Current Android build settings

- `compileSdk 35`, `targetSdk 35`, and `minSdk 22` are enforced in the build workflow.
- All Google Play ABIs are included: `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`.
- Release builds require an uploaded `.jks` / `.keystore` and are signed for Play Console upload.
- Production AdMob builds inject the AdMob app ID, ad unit IDs, and `com.google.android.gms.permission.AD_ID`.
- Google Mobile Ads / Play services are pinned to minSdk-22-compatible versions to avoid Play services `minSdkVersion 23` manifest merge failures.

## Latest build fix

The Codemagic `Build Android App Bundle` step was failing because `com.google.android.gms:play-services-base:18.9.0` requires Android API 23, while the app is intentionally kept at `minSdk 22` for wider device support. The workflow now forces compatible Google Play services and Mobile Ads versions while keeping `minSdk 22`.
