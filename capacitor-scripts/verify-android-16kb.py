#!/usr/bin/env python3
"""Verify Google Play 16 KB page-size compatibility for APK/AAB artifacts.

Checks the two things Google calls out:
  1. AAB requests PAGE_ALIGNMENT_16K, or APK passes zipalign -P 16.
  2. Every shipped native .so has LOAD segment alignment >= 16 KB.

This intentionally fails the CI build with the exact bad files if a third-party
prebuilt native SDK is still 4 KB aligned; packaging flags cannot repair those.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


BUNDLETOOL_URL = "https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar"
BUNDLETOOL_JAR = Path("/tmp/bundletool-all-1.17.2.jar")
MIN_ALIGN = 16 * 1024
ANDROID_JAR = Path(os.environ.get("ANDROID_JAR", "")) if os.environ.get("ANDROID_JAR") else None


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=check)


def version_key(path: str) -> list[int]:
    nums = re.findall(r"\d+", path)
    return [int(n) for n in nums] if nums else [0]


def find_build_tool(name: str) -> str | None:
    sdk = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if sdk:
        candidates = sorted(glob.glob(str(Path(sdk) / "build-tools" / "*" / name)), key=version_key)
        if candidates:
            return candidates[-1]
    return shutil.which(name)


def find_readelf() -> str | None:
    sdk = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if sdk:
        candidates = sorted(
            glob.glob(str(Path(sdk) / "ndk" / "*" / "toolchains" / "llvm" / "prebuilt" / "*" / "bin" / "llvm-readelf")),
            key=version_key,
        )
        if candidates:
            return candidates[-1]
    return shutil.which("llvm-readelf") or shutil.which("readelf")


def ensure_bundletool() -> Path:
    if not BUNDLETOOL_JAR.exists() or BUNDLETOOL_JAR.stat().st_size == 0:
        print(f"Downloading bundletool: {BUNDLETOOL_URL}")
        urllib.request.urlretrieve(BUNDLETOOL_URL, BUNDLETOOL_JAR)
    return BUNDLETOOL_JAR


def parse_align(token: str) -> int | None:
    token = token.strip().rstrip(",")
    power = re.fullmatch(r"2\*\*(\d+)", token)
    if power:
        return 1 << int(power.group(1))
    try:
        return int(token, 0)
    except ValueError:
        return None


def readelf_load_alignments(readelf: str, so_path: Path) -> list[int]:
    attempts = [[readelf, "-lW", str(so_path)], [readelf, "-l", str(so_path)]]
    output = ""
    for args in attempts:
        proc = run(args, check=False)
        output = proc.stdout
        if proc.returncode == 0:
            break
    else:
        raise RuntimeError(f"readelf failed for {so_path}:\n{output}")

    aligns: list[int] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped.startswith("LOAD"):
            continue
        # GNU/LLVM readelf put Align in the last column. llvm-objdump-like
        # output may include "align 2**14"; support both formats.
        match = re.search(r"\balign\s+(2\*\*\d+|0x[0-9a-fA-F]+|\d+)\b", stripped)
        value = parse_align(match.group(1)) if match else parse_align(stripped.split()[-1])
        if value is not None:
            aligns.append(value)
    return aligns


def verify_so_elf_alignment(artifact: Path) -> None:
    readelf = find_readelf()
    with zipfile.ZipFile(artifact) as zf:
        so_entries = [name for name in zf.namelist() if name.endswith(".so")]

        if not so_entries:
            print(f"✅ {artifact.name}: no native .so files found; ELF alignment check not needed.")
            return

        if not readelf:
            raise SystemExit("❌ Native .so files are present, but llvm-readelf/readelf was not found. Install Android NDK r28+ before verification.")

        print(f"Inspecting {len(so_entries)} native .so file(s) with {readelf}")
        bad: list[str] = []
        with tempfile.TemporaryDirectory(prefix="lovable-16kb-so-") as tmp:
            tmpdir = Path(tmp)
            for i, entry in enumerate(so_entries):
                out = tmpdir / f"lib-{i}.so"
                out.write_bytes(zf.read(entry))
                aligns = readelf_load_alignments(readelf, out)
                too_small = [a for a in aligns if 0 < a < MIN_ALIGN]
                if too_small:
                    bad.append(f"{entry} LOAD alignments={aligns}")
                else:
                    print(f"  ✓ {entry} LOAD alignments={aligns or ['none']}")

        if bad:
            print("❌ 16 KB ELF alignment failed. These native libraries must be rebuilt with NDK r28+ or linker flags -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384:")
            for item in bad:
                print(f"  - {item}")
            raise SystemExit(1)

        print(f"✅ {artifact.name}: all native .so LOAD segments are 16 KB aligned.")


def has_native_libraries(artifact: Path) -> bool:
    with zipfile.ZipFile(artifact) as zf:
        return any(name.endswith(".so") for name in zf.namelist())


def verify_aab_page_alignment(aab: Path) -> None:
    jar = ensure_bundletool()
    proc = run(["java", "-jar", str(jar), "dump", "config", f"--bundle={aab}"])
    config = proc.stdout
    alignment_lines = [line.strip() for line in config.splitlines() if "ALIGNMENT" in line.upper()]
    if alignment_lines:
        print("AAB alignment config:")
        for line in alignment_lines:
            print(f"  {line}")
    if "PAGE_ALIGNMENT_16K" not in config:
        if "PAGE_ALIGNMENT_4K" in config:
            raise SystemExit(f"❌ {aab.name} requests PAGE_ALIGNMENT_4K. Set android.bundle.enableUncompressedNativeLibs=true and build with AGP 8.5.1+.")
        raise SystemExit(f"❌ {aab.name} does not show PAGE_ALIGNMENT_16K in bundletool config; Play may generate 4 KB-aligned APKs.")
    print(f"✅ {aab.name}: AAB requests PAGE_ALIGNMENT_16K.")


def find_android_jar() -> Path | None:
    if ANDROID_JAR and ANDROID_JAR.exists():
        return ANDROID_JAR
    sdk = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if not sdk:
        return None
    candidates = sorted(glob.glob(str(Path(sdk) / "platforms" / "android-*" / "android.jar")), key=version_key)
    return Path(candidates[-1]) if candidates else None


def verify_aab_generated_apks(aab: Path) -> None:
    """Build universal APKs from the AAB and run the same checks Play applies.

    `bundletool dump config` verifies the bundle requests 16 KB alignment, but
    Play Console ultimately generates APKs from the bundle. This catches gaps
    where the AAB metadata looks right while the produced APK still fails
    zipalign -P 16 or contains bad .so files.
    """
    jar = ensure_bundletool()
    android_jar = find_android_jar()
    if not android_jar:
        raise SystemExit("❌ android.jar not found; install Android SDK platforms before AAB APK-set verification.")

    with tempfile.TemporaryDirectory(prefix="lovable-16kb-apks-") as tmp:
        tmpdir = Path(tmp)
        apks = tmpdir / "generated.apks"
        extract_dir = tmpdir / "extracted"
        proc = run(
            [
                "java",
                "-jar",
                str(jar),
                "build-apks",
                f"--bundle={aab}",
                f"--output={apks}",
                "--mode=universal",
                f"--android-jar={android_jar}",
            ],
            check=False,
        )
        print(proc.stdout)
        if proc.returncode != 0:
            raise SystemExit(f"❌ bundletool could not generate APKs from {aab.name} for 16 KB verification.")

        with zipfile.ZipFile(apks) as zf:
            zf.extractall(extract_dir)
        apk_files = sorted(extract_dir.rglob("*.apk"))
        if not apk_files:
            raise SystemExit(f"❌ bundletool generated no APKs from {aab.name}; cannot verify Play output.")
        print(f"Generated {len(apk_files)} APK(s) from {aab.name}; verifying Play-style outputs.")
        for apk in apk_files:
            verify_apk_zip_alignment(apk)
            verify_so_elf_alignment(apk)


def verify_apk_zip_alignment(apk: Path) -> None:
    zipalign = find_build_tool("zipalign")
    if not zipalign:
        raise SystemExit("❌ zipalign not found in Android build-tools; cannot verify APK 16 KB zip alignment.")
    proc = run([zipalign, "-v", "-c", "-P", "16", "4", str(apk)], check=False)
    print(proc.stdout)
    if proc.returncode != 0:
        raise SystemExit(f"❌ {apk.name} failed zipalign -P 16 verification.")
    print(f"✅ {apk.name}: APK zip alignment passes -P 16.")


def main() -> None:
    artifacts = [Path(arg) for arg in sys.argv[1:] if arg.strip()]
    if not artifacts:
        raise SystemExit("Usage: verify-android-16kb.py <artifact.aab|artifact.apk> [...]")

    for artifact in artifacts:
        if not artifact.exists():
            raise SystemExit(f"❌ Artifact not found: {artifact}")
        print(f"\n=== Verifying 16 KB page-size compatibility: {artifact} ===")
        suffix = artifact.suffix.lower()
        has_native = has_native_libraries(artifact)
        if suffix == ".aab":
            if has_native:
                verify_aab_page_alignment(artifact)
                verify_aab_generated_apks(artifact)
            else:
                print(f"✅ {artifact.name}: no native .so files found; AAB page-alignment config is not required.")
        elif suffix == ".apk":
            if has_native:
                verify_apk_zip_alignment(artifact)
            else:
                print(f"✅ {artifact.name}: no native .so files found; APK zipalign -P 16 is not required.")
        else:
            raise SystemExit(f"❌ Unsupported artifact type: {artifact}")
        verify_so_elf_alignment(artifact)

    print("\n✅ All Android artifacts are 16 KB page-size compatible.")


if __name__ == "__main__":
    main()