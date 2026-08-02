# AdMob Mediation Support for the AAB Builder

Goal: every generated Android app can use AdMob mediation with zero manual work — the user just enables networks in the builder and configures them in the AdMob console. Existing AdMob behaviour (banner, interstitial, rewarded, rewarded interstitial, native, app open) stays exactly as-is.

## 1. Configuration surface (builder UI + backend)

- New database columns on `build_configs`, all defaulting to `false`, plus one text field:
  - `mediation_applovin`, `mediation_meta`, `mediation_unity`, `mediation_pangle`, `mediation_mintegral`, `mediation_liftoff`
  - `applovin_sdk_key` (text, required only when AppLovin is enabled — AppLovin needs its SDK key in the manifest)
- Migration includes GRANTs and keeps existing RLS untouched.
- **Monetize tab** in the build form gets a new "Ad mediation networks" section: six switches, shown only when an AdMob App ID is entered, with a short note that each network must also be configured in the AdMob console. AppLovin switch reveals its SDK-key input.
- Client-side validation: enabling AppLovin without a valid SDK key blocks submission; mediation flags are ignored/stripped when AdMob is off.
- The save path keeps the existing "missing column" fallback message pattern so old databases give a clear instruction instead of a raw error.

## 2. Passing config to the builder

`supabase/functions/build-aab/index.ts` adds mediation env vars to the Codemagic payload, gated the same way the existing ad-unit vars are (empty unless `enable_admob` and a valid App ID):

```
MEDIATION_APPLOVIN, MEDIATION_META, MEDIATION_UNITY,
MEDIATION_PANGLE, MEDIATION_MINTEGRAL, MEDIATION_LIFTOFF,
APPLOVIN_SDK_KEY
```

Server-side validation mirrors the client (AppLovin key required when enabled, mediation forced off when ads are off) so a bad config fails fast with a clear message instead of at Gradle time.

## 3. Gradle wiring (size-optimised: only enabled adapters ship)

Classic template (`android-template/app/build.gradle`) and the Capacitor override script both:

- Bump `play-services-ads` to the latest stable release compatible with minSdk 22 and add each adapter **only when its flag is true**:
  - AppLovin: `com.google.ads.mediation:applovin`
  - Meta: `com.google.ads.mediation:facebook`
  - Unity: `com.google.ads.mediation:unity`
  - Pangle: `com.google.ads.mediation:pangle`
  - Mintegral: `com.google.ads.mediation:mintegral`
  - Liftoff/Vungle: `com.google.ads.mediation:vungle`
- Adapter versions are resolved to the latest stable set from Google's official mediation docs at implementation time, and pinned as exact versions (no dynamic `+`) so builds are reproducible.
- Extra repositories added to `allprojects`/`settings.gradle` in both the classic template and the Capacitor project: AppLovin, Pangle, Mintegral, Unity. Repository ordering keeps the existing `mavenCentral()`-first guard intact so the Bouncy Castle pinning that fixed earlier failures is not disturbed.
- A resolution-strategy block forces one consistent `play-services-ads` / `com.google.android.gms` version across all adapters to prevent the classic mediation dependency-conflict failures.
- No adapters and no extra repositories are added when mediation is entirely off — byte-for-byte the current output.

## 4. Manifest, ProGuard, initialization

- Manifest injection step in `codemagic.yaml` (both workflows) extends the existing AdMob `APPLICATION_ID` logic:
  - AppLovin `applovin.sdk.key` meta-data when AppLovin is on.
  - Meta/Unity/Pangle/Mintegral required entries per official docs (activities/providers come from adapter manifests via merger; only what the docs require manually is injected).
  - The `AD_ID` permission handling is untouched — it already uses `tools:node="replace"`.
- ProGuard rules appended to `proguard-rules.pro` for each enabled adapter, following each network's official consumer rules (keeps are additive; existing rules unchanged).
- `MainActivity.java`: `MobileAds.initialize()` already runs; mediation adapters self-register, so the only change is logging each adapter's initialization status from the callback for diagnostics. No behavioural change to existing ad loading, and the AdMob JS bridge/shim stays identical.

## 5. Build validation

Extend `capacitor-scripts/validate-build.mjs` (and the classic workflow's verification step) with a mediation gate that runs before the Gradle build and hard-fails on:
- an adapter enabled but its dependency line missing from the resolved Gradle files
- an adapter enabled but its required repository missing
- AppLovin enabled but `applovin.sdk.key` meta-data absent from the merged manifest
- conflicting `play-services-ads` versions in the dependency graph

Post-build, the existing merged-manifest check is extended to confirm the AdMob `APPLICATION_ID` and (when enabled) the AppLovin key survived merging.

## 6. Non-goals / safety

- No changes to signing, 16 KB alignment, SDK 36 targeting, minSdk 22, launcher-activity normalization, billing, or icon pipeline.
- Mediation is opt-in per build; a build with all switches off produces the same AAB as today.

## Verification

- Node/YAML syntax checks on every edited script and `codemagic.yaml`.
- A dry run of the override + validation scripts against a synthetic project with (a) all networks off and (b) all six on, asserting the correct dependency/repository/manifest/ProGuard output in each case.
- Then a real Codemagic build with a couple of networks enabled to confirm the AAB resolves without dependency conflicts.
