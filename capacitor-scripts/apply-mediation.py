#!/usr/bin/env python3
"""
Apply Google AdMob Mediation wiring to a generated Android project.

Works for both builder flavours:
  * classic WebView template  -> --root <repo>/android-template
  * Capacitor project         -> --root <project>/android

Everything is driven by environment variables set by the builder backend:
  ADMOB_APP_ID          AdMob application id (mediation is a no-op without it)
  MEDIATION_APPLOVIN    "true" to bundle the AppLovin MAX adapter
  MEDIATION_META        "true" to bundle the Meta Audience Network adapter
  MEDIATION_UNITY       "true" to bundle the Unity Ads adapter
  MEDIATION_PANGLE      "true" to bundle the Pangle adapter
  MEDIATION_MINTEGRAL   "true" to bundle the Mintegral adapter
  MEDIATION_LIFTOFF     "true" to bundle the Liftoff Monetize (Vungle) adapter
  APPLOVIN_SDK_KEY      required when MEDIATION_APPLOVIN=true
  GRADLE_INIT_DIR       optional, defaults to $HOME/.gradle/init.d

Modes:
  (default)  patch the project
  --verify   validate a previously patched project and exit non-zero on problems

When no network is enabled the script performs no writes at all, so builds that
do not use mediation are byte-for-byte identical to before.
"""

import argparse
import json
import os
import re
import sys

MARKER = "// LOVABLE_ADMOB_MEDIATION"
HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "mediation-config.json")

# Google Play services artifacts that the minSdk-22 alignment pins to old
# releases. The Mobile Ads SDK required by the mediation adapters needs newer
# ones, so those pins are dropped when mediation is on.
LEGACY_PIN_ARTIFACTS = (
    "play-services-ads-identifier",
    "play-services-appset",
    "play-services-base",
    "play-services-basement",
    "play-services-tasks",
    "user-messaging-platform",
)


def truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() == "true"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def enabled_networks(config: dict) -> list:
    out = []
    for key, spec in config["networks"].items():
        if truthy(spec["env"]):
            out.append((key, spec))
    return out


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def gradle_files(root: str) -> list:
    candidates = [
        os.path.join(root, "build.gradle"),
        os.path.join(root, "build.gradle.kts"),
        os.path.join(root, "settings.gradle"),
        os.path.join(root, "settings.gradle.kts"),
        os.path.join(root, "app", "build.gradle"),
        os.path.join(root, "app", "build.gradle.kts"),
        os.path.join(root, "app", "capacitor.build.gradle"),
        os.path.join(root, "capacitor.build.gradle"),
    ]
    init_dir = os.environ.get("GRADLE_INIT_DIR") or os.path.join(
        os.path.expanduser("~"), ".gradle", "init.d"
    )
    if os.path.isdir(init_dir):
        for name in sorted(os.listdir(init_dir)):
            if name.endswith(".gradle") or name.endswith(".gradle.kts"):
                candidates.append(os.path.join(init_dir, name))
    return [p for p in candidates if os.path.isfile(p)]


def app_build_gradle(root: str) -> str:
    for name in ("build.gradle", "build.gradle.kts"):
        candidate = os.path.join(root, "app", name)
        if os.path.isfile(candidate):
            return candidate
    raise SystemExit("❌ [mediation] app/build.gradle not found under %s" % root)


# ---------------------------------------------------------------------------
# 1. Google Mobile Ads SDK version alignment
# ---------------------------------------------------------------------------
def realign_play_services(root: str, config: dict) -> None:
    """Move every pinned Mobile Ads reference onto the mediation-compatible SDK
    and drop the companion pins that would force incompatible old versions."""
    legacy = config["legacyAdsSdkVersion"]
    target = config["adsSdkVersion"]
    for path in gradle_files(root):
        text = read(path)
        before = text

        # play-services-ads / -lite / -base -> mediation-compatible release
        text = re.sub(
            r"(play-services-ads(?:-lite|-base)?['\"]?\s*[:,]?\s*['\"])%s(['\"])"
            % re.escape(legacy),
            r"\g<1>%s\g<2>" % target,
            text,
        )
        text = re.sub(
            r"(com\.google\.android\.gms:play-services-ads(?:-lite|-base)?:)%s"
            % re.escape(legacy),
            r"\g<1>%s" % target,
            text,
        )

        # Drop the companion pins (map entries and force() arguments).
        lines = []
        for line in text.split("\n"):
            if any(artifact in line for artifact in LEGACY_PIN_ARTIFACTS) and (
                re.search(r"['\"]\s*:\s*['\"][0-9]", line)
                or re.search(r":[0-9][0-9.]*['\"]", line)
            ):
                continue
            lines.append(line)
        text = "\n".join(lines)

        # A dangling comma before the closing paren of force(...) is a syntax
        # error in Groovy; normalize it after the removals above.
        text = re.sub(r",(\s*\n\s*\))", r"\g<1>", text)

        if text != before:
            write(path, text)
            print("[mediation] realigned Mobile Ads pins in %s" % path)


# ---------------------------------------------------------------------------
# 2. minSdk (Mobile Ads 24+ requires API 23)
# ---------------------------------------------------------------------------
def raise_min_sdk(root: str, config: dict) -> None:
    min_sdk = int(config["mediationMinSdk"])
    for name in ("build.gradle", "build.gradle.kts"):
        path = os.path.join(root, "app", name)
        if not os.path.isfile(path):
            continue
        text = read(path)
        before = text

        def bump(match):
            current = int(match.group(2))
            if current >= min_sdk:
                return match.group(0)
            return "%s%d" % (match.group(1), min_sdk)

        text = re.sub(r"(minSdk(?:Version)?\s+)(\d+)", bump, text)
        text = re.sub(r"(minSdk(?:Version)?\s*=\s*)(\d+)", bump, text)
        text = re.sub(r"(minSdk(?:Version)?\(\s*)(\d+)(?=\s*\))", bump, text)
        if text != before:
            write(path, text)
            print(
                "[mediation] raised minSdk to %d in %s "
                "(Mobile Ads %s requires API %d)"
                % (min_sdk, path, config["adsSdkVersion"], min_sdk)
            )


# ---------------------------------------------------------------------------
# 3. Repositories
# ---------------------------------------------------------------------------
def repo_snippet(url: str, kts: bool) -> str:
    if kts:
        return '        maven { setUrl("%s") }' % url
    return "        maven { url '%s' }" % url


def ensure_repositories(root: str, urls: list) -> None:
    if not urls:
        return
    targets = [
        os.path.join(root, "build.gradle"),
        os.path.join(root, "build.gradle.kts"),
        os.path.join(root, "settings.gradle"),
        os.path.join(root, "settings.gradle.kts"),
    ]
    injected_anywhere = False
    for path in targets:
        if not os.path.isfile(path):
            continue
        kts = path.endswith(".kts")
        text = read(path)
        missing = [u for u in urls if u not in text]
        if not missing:
            injected_anywhere = True
            continue
        block = "\n".join(repo_snippet(u, kts) for u in missing)

        # Inject into every repositories { } block that already lists google()
        # so both allprojects{} and dependencyResolutionManagement{} get them.
        def inject(match):
            return "%s\n%s" % (match.group(0), block)

        new_text, count = re.subn(
            r"^[ \t]*(?:google\(\)|mavenCentral\(\))[ \t]*$",
            inject,
            text,
            count=1,
            flags=re.M,
        )
        if count:
            write(path, new_text)
            injected_anywhere = True
            print("[mediation] added %d mediation repositories to %s" % (len(missing), path))

    if not injected_anywhere:
        # Last resort: create an allprojects repositories block at the root.
        path = os.path.join(root, "build.gradle")
        if os.path.isfile(path):
            text = read(path)
            block = "\n".join(repo_snippet(u, False) for u in urls)
            text += "\n\n%s\nallprojects {\n    repositories {\n%s\n    }\n}\n" % (MARKER, block)
            write(path, text)
            print("[mediation] appended mediation repositories block to %s" % path)


# ---------------------------------------------------------------------------
# 4. Adapter dependencies
# ---------------------------------------------------------------------------
def ensure_dependencies(root: str, config: dict, networks: list) -> None:
    path = app_build_gradle(root)
    kts = path.endswith(".kts")
    text = read(path)
    if MARKER in text:
        text = re.sub(
            r"\n*%s\n(?:.|\n)*?// LOVABLE_ADMOB_MEDIATION_END\n" % re.escape(MARKER),
            "\n",
            text,
        )

    ads = "com.google.android.gms:play-services-ads:%s" % config["adsSdkVersion"]
    artifacts = [ads] + [spec["artifact"] for _, spec in networks]

    def dep(coord):
        if kts:
            return '    implementation("%s")' % coord
        return "    implementation '%s'" % coord

    body = "\n".join(dep(a) for a in artifacts)
    block = (
        "\n\n%s\n"
        "// Google Mobile Ads SDK + mediation adapters (only the networks enabled\n"
        "// in the builder configuration are compiled in, keeping the AAB small).\n"
        "dependencies {\n%s\n}\n"
        "configurations.all {\n"
        "    resolutionStrategy {\n"
        "        force '%s'\n"
        "        eachDependency { details ->\n"
        "            if (details.requested.group == 'com.google.android.gms' &&\n"
        "                details.requested.name.startsWith('play-services-ads')) {\n"
        "                details.useVersion '%s'\n"
        "                details.because 'Single Mobile Ads SDK version across all mediation adapters'\n"
        "            }\n"
        "        }\n"
        "    }\n"
        "}\n"
        "// LOVABLE_ADMOB_MEDIATION_END\n"
    ) % (MARKER, body, ads, config["adsSdkVersion"])

    write(path, text.rstrip("\n") + "\n" + block)
    print("[mediation] wired %d adapter dependencies into %s" % (len(networks), path))


# ---------------------------------------------------------------------------
# 5. Manifest entries
# ---------------------------------------------------------------------------
def manifest_path(root: str) -> str:
    return os.path.join(root, "app", "src", "main", "AndroidManifest.xml")


def ensure_manifest(root: str, networks: list) -> None:
    keys = dict(networks)
    if "applovin" not in keys:
        return
    sdk_key = os.environ.get("APPLOVIN_SDK_KEY", "").strip()
    if not sdk_key:
        raise SystemExit(
            "❌ [mediation] AppLovin is enabled but APPLOVIN_SDK_KEY is empty. "
            "Add the AppLovin SDK key in the builder's Monetize tab."
        )
    path = manifest_path(root)
    if not os.path.isfile(path):
        raise SystemExit("❌ [mediation] AndroidManifest.xml not found at %s" % path)
    text = read(path)
    text = re.sub(
        r"\n\s*<meta-data\s+android:name=\"applovin\.sdk\.key\"[^/]*/>",
        "",
        text,
    )
    meta = (
        '\n        <meta-data android:name="applovin.sdk.key" '
        'android:value="%s" />' % sdk_key.replace('"', "&quot;")
    )
    text, count = re.subn(r"(\n\s*</application>)", meta + r"\g<1>", text, count=1)
    if not count:
        raise SystemExit("❌ [mediation] Could not inject applovin.sdk.key — no </application> tag")
    write(path, text)
    print("[mediation] injected applovin.sdk.key meta-data")


# ---------------------------------------------------------------------------
# 6. ProGuard / R8 rules
# ---------------------------------------------------------------------------
def ensure_proguard(root: str, networks: list) -> None:
    path = os.path.join(root, "app", "proguard-rules.pro")
    text = read(path) if os.path.isfile(path) else ""
    start = "# LOVABLE_ADMOB_MEDIATION"
    end = "# LOVABLE_ADMOB_MEDIATION_END"
    text = re.sub(r"\n*%s\n(?:.|\n)*?%s\n" % (re.escape(start), re.escape(end)), "\n", text)

    rules = [
        start,
        "# Google Mobile Ads SDK",
        "-keep class com.google.android.gms.ads.** { *; }",
        "-keep class com.google.ads.** { *; }",
        "-dontwarn com.google.android.gms.ads.**",
        "-keep public class com.google.android.gms.ads.MobileAdsInitProvider { *; }",
        "-keep class * extends com.google.android.gms.ads.mediation.Adapter { *; }",
        "-keep class * implements com.google.android.gms.ads.mediation.MediationAdapter { *; }",
    ]
    for _key, spec in networks:
        rules.append("# %s" % spec["label"])
        rules.extend(spec["proguard"])
    rules.append(end)

    write(path, text.rstrip("\n") + "\n\n" + "\n".join(rules) + "\n")
    print("[mediation] appended ProGuard rules for %d networks" % len(networks))


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
def verify(root: str, config: dict, networks: list) -> None:
    errors = []
    app_gradle = app_build_gradle(root)
    gradle_text = read(app_gradle)
    root_text = ""
    for name in ("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"):
        candidate = os.path.join(root, name)
        if os.path.isfile(candidate):
            root_text += read(candidate)

    ads_coord = "com.google.android.gms:play-services-ads:%s" % config["adsSdkVersion"]
    if ads_coord not in gradle_text:
        errors.append("Mobile Ads SDK %s is not declared in %s" % (config["adsSdkVersion"], app_gradle))

    if re.search(r"play-services-ads(?:-lite|-base)?:%s" % re.escape(config["legacyAdsSdkVersion"]), gradle_text + root_text):
        errors.append(
            "Conflicting Mobile Ads version %s is still pinned; mediation adapters require %s"
            % (config["legacyAdsSdkVersion"], config["adsSdkVersion"])
        )

    for _key, spec in networks:
        if spec["artifact"] not in gradle_text:
            errors.append("%s adapter dependency missing (%s)" % (spec["label"], spec["artifact"]))
        for url in spec["repositories"]:
            if url not in root_text:
                errors.append("%s repository missing: %s" % (spec["label"], url))

    min_sdk_values = [int(v) for v in re.findall(r"minSdk(?:Version)?[\s=(]+(\d+)", gradle_text)]
    if min_sdk_values and min(min_sdk_values) < int(config["mediationMinSdk"]):
        errors.append(
            "minSdk %d is below %d required by Mobile Ads %s"
            % (min(min_sdk_values), int(config["mediationMinSdk"]), config["adsSdkVersion"])
        )

    if dict(networks).get("applovin"):
        manifest = manifest_path(root)
        text = read(manifest) if os.path.isfile(manifest) else ""
        if "applovin.sdk.key" not in text:
            errors.append("AppLovin enabled but applovin.sdk.key meta-data missing from AndroidManifest.xml")

    proguard = os.path.join(root, "app", "proguard-rules.pro")
    if not os.path.isfile(proguard) or "LOVABLE_ADMOB_MEDIATION" not in read(proguard):
        errors.append("Mediation ProGuard rules missing from app/proguard-rules.pro")

    admob_manifest = manifest_path(root)
    if os.path.isfile(admob_manifest):
        if "com.google.android.gms.ads.APPLICATION_ID" not in read(admob_manifest):
            errors.append("AdMob APPLICATION_ID meta-data missing — the app would crash on launch")

    if errors:
        print("❌ [mediation] validation failed:")
        for item in errors:
            print("   - %s" % item)
        sys.exit(2)

    print(
        "✅ [mediation] verified %d adapter(s): %s"
        % (len(networks), ", ".join(spec["label"] for _k, spec in networks))
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="Android project root")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        raise SystemExit("❌ [mediation] Android root not found: %s" % root)

    config = load_config()
    networks = enabled_networks(config)
    admob_app_id = os.environ.get("ADMOB_APP_ID", "").strip()

    if not networks:
        print("[mediation] no mediation networks enabled — nothing to do")
        return
    if not admob_app_id:
        print("[mediation] AdMob is disabled — skipping mediation adapters")
        return

    if args.verify:
        verify(root, config, networks)
        return

    print(
        "[mediation] enabling %s"
        % ", ".join(spec["label"] for _k, spec in networks)
    )
    realign_play_services(root, config)
    raise_min_sdk(root, config)
    repos = []
    for _key, spec in networks:
        for url in spec["repositories"]:
            if url not in repos:
                repos.append(url)
    ensure_repositories(root, repos)
    ensure_dependencies(root, config, networks)
    ensure_manifest(root, networks)
    ensure_proguard(root, networks)
    print("[mediation] configuration applied")


if __name__ == "__main__":
    main()
