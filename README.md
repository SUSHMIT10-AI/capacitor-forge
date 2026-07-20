# AABforge

AABforge builds signed Android App Bundles for Google Play from web URLs or uploaded Capacitor projects.

## Current Android build settings

- `compileSdk 35`, `targetSdk 35`, and `minSdk 22` are enforced in the build workflow.
- All Google Play ABIs are included: `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`.
- Release builds require an uploaded `.jks` / `.keystore` and are signed for Play Console upload.
- Production AdMob builds inject the AdMob app ID, ad unit IDs, and `com.google.android.gms.permission.AD_ID`.
- Google Mobile Ads / Play services are pinned to minSdk-22-compatible versions.
- NDK r28+ is installed and enforced for 16 KB page-size ELF alignment.
- `android.bundle.enableUncompressedNativeLibs=true` + `jniLibs.useLegacyPackaging=false` + `android:extractNativeLibs="false"` for Play's 16 KB requirement.
- AAB is verified post-build with `bundletool` (`PAGE_ALIGNMENT_16K`), and generated APKs are re-checked with `zipalign -P 16` and `llvm-readelf` LOAD-segment alignment.

## Play Console upload audit (what the builder guarantees)

| Play Console requirement | Where it is enforced |
| --- | --- |
| `targetSdk 35` (Android 15) | `capacitor-scripts/apply-overrides.mjs`, `validate-build.mjs`, `codemagic.yaml` |
| `minSdk 22` for broad device support | Same as above; hard-checked before assembly |
| Advertising ID permission (`com.google.android.gms.permission.AD_ID`) | Base `AndroidManifest.xml`, re-injected + verified in `codemagic.yaml` |
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

If Play Console keeps rejecting the AAB after a successful build, it is almost always one of the five items above — the artifact itself already satisfies technical requirements (target SDK 35, AD_ID permission, 16 KB alignment, real ad IDs, signed).

## Latest build fix

The `mapfile` bash builtin was unavailable in the Codemagic shell, causing the 16 KB verification step to exit `127`. Replaced with a POSIX-safe `find`/`xargs` collector. NDK r28 is forced in every Gradle path and the verifier now also runs Play-style APK-set checks (`zipalign -P 16` + `llvm-readelf`) on APKs generated from the AAB.
