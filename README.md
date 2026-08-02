# AABforge

AABforge builds signed Android App Bundles for Google Play from web URLs or uploaded Capacitor projects.

## Google Play target API level policy (current)

Per Google Play's [target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878), from **August 31, 2026**:

- New apps and app updates must target **Android 16 (API 36)** or higher.
- Existing apps must target **Android 15 (API 35)** or higher to stay discoverable.
- Wear OS / Automotive: API 35+. Android TV / XR: API 34+.

AABforge therefore builds at **API 36** so uploads stay accepted past the deadline.

## Current Android build settings

- `compileSdk 36`, `targetSdk 36`, and `minSdk 22` are enforced in the build workflow.
- Toolchain: Gradle 8.11.1 + Android Gradle Plugin 8.9.1 (required to compile against API 36), Java 21.
- All Google Play ABIs are included: `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`.
- Release builds require an uploaded `.jks` / `.keystore` and are signed for Play Console upload.
- Production AdMob builds inject the AdMob app ID, ad unit IDs, Google Mobile Ads SDK, and `com.google.android.gms.permission.AD_ID`; builds without AdMob strip `AD_ID` so Play policy declarations match the artifact.
- Google Mobile Ads / Play services are pinned to minSdk-22-compatible versions.
- NDK r28+ is installed and enforced for 16 KB page-size ELF alignment.
- `android.bundle.enableUncompressedNativeLibs=true` + `jniLibs.useLegacyPackaging=false` + `android:extractNativeLibs="false"` for Play's 16 KB requirement.
- AAB is verified post-build with `bundletool` (`PAGE_ALIGNMENT_16K`), and generated APKs are re-checked with `zipalign -P 16` and `llvm-readelf` LOAD-segment alignment.

## AdMob Mediation

The Monetize tab has an **Ad mediation networks** section (visible once a real AdMob App ID is entered). Supported adapters:

| Network | Adapter |
| --- | --- |
| AppLovin MAX | `com.google.ads.mediation:applovin:13.6.3.0` (requires an AppLovin SDK key) |
| Meta Audience Network | `com.google.ads.mediation:facebook:6.22.0.0` |
| Unity Ads | `com.google.ads.mediation:unity:4.19.0.0` |
| Pangle | `com.google.ads.mediation:pangle:8.2.0.4.0` |
| Mintegral | `com.google.ads.mediation:mintegral:17.1.71.0` |
| Liftoff Monetize (Vungle) | `com.google.ads.mediation:vungle:7.7.7.0` |

`capacitor-scripts/apply-mediation.py` (run in both workflows, driven by `capacitor-scripts/mediation-config.json`) automatically:

- compiles **only the enabled adapters** — disabled networks add zero size and zero dependencies;
- adds the AppLovin / Pangle / Mintegral Maven repositories;
- realigns every Google Mobile Ads pin to `25.4.0` and forces one SDK version across all adapters (no Gradle conflicts);
- raises `minSdk` from 22 to **23** only when mediation is on (Mobile Ads 25.x requirement) — mediation-free builds stay at API 22;
- injects the `applovin.sdk.key` manifest meta-data;
- appends ProGuard/R8 keep rules for each network so adapters are not stripped;
- re-runs in `--verify` mode before Gradle so missing dependencies, repositories or the AppLovin key fail the build early.

Existing banner, interstitial, rewarded, rewarded-interstitial, native and app-open ads are unchanged — mediation is additive. Configure the ad sources themselves in the AdMob console.



## Play Console upload audit (what the builder guarantees)

| Play Console requirement | Where it is enforced |
| --- | --- |
| `targetSdk 36` (Android 16) | `capacitor-scripts/apply-overrides.mjs`, `validate-build.mjs`, `codemagic.yaml` |
| `minSdk 22` for broad device support | Same as above; hard-checked before assembly |
| Advertising ID permission (`com.google.android.gms.permission.AD_ID`) | Injected + verified only when a real AdMob App ID is configured; stripped otherwise |
| Real AdMob IDs only (no test IDs) | `ADMOB_TEST_MODE` hard-disabled in `build-aab` + builder scripts |
| 16 KB page-size native library packaging | `gradle.properties`, `build.gradle`, `AndroidManifest.xml`, verified by `verify-android-16kb.py` |
| Signed AAB with user keystore | `sign-capacitor-upload` edge function + Codemagic signing step |
| Splash screen / clipboard fully disabled when user opts out | `codemagic.yaml` strips drawables + `values-v31` theme overrides |
| User-uploaded launcher icon replaces defaults | Icon install step in both workflows (Pillow fallback) |

### What Play Console still requires you to do manually

These are **policy declarations**, not build artifacts — the builder cannot toggle them for you:

1. **Advertising ID declaration** — Play Console → App content → Advertising ID. Declare that the app uses the Advertising ID (for AdMob).
2. **Data safety form** — declare what user data AdMob / your app collects.
3. **Ads declaration** — Play Console → App content → Ads → "Yes, my app contains ads".
4. **Target audience & content** — required for all new apps.
5. **App access** — if the app has login, provide test credentials.

If Play Console keeps rejecting the AAB after a successful build, it is almost always one of the five items above — the artifact itself already satisfies technical requirements (target SDK 36, conditional AD_ID permission, 16 KB alignment, real ad IDs, signed).

## Latest build fix

The latest failed build stopped in **Force Android SDK compatibility** because Codemagic ran an older repository revision where the workflow referenced `variables` before defining `android/variables.gradle`. The current workflow defines the path first, then enforces `compileSdk 36`, `targetSdk 36`, `minSdk 22`, NDK r28+, `android.bundle.enableUncompressedNativeLibs=true`, `jniLibs.useLegacyPackaging=false`, and `android:extractNativeLibs="false"` before Gradle runs. The local workflow check verifies this script and the YAML parses successfully; start a fresh build after the connected Git repository has synced this revision.
