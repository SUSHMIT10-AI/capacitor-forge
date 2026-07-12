## Plan

1. Add an early Codemagic guard that writes a Gradle init script before any Android Gradle command runs.
   - It will redirect every `org.bouncycastle` `jdk18on` request to the available `jdk15on:1.70` artifacts for both normal project dependencies and Gradle/buildscript classpaths.
   - This is stronger than the current `allprojects { configurations.all { ... } }` patch, which can miss dependencies resolved before the root project configuration is applied.

2. Apply the same guard to both build workflows.
   - The standard Android template workflow.
   - The Capacitor upload workflow that fails at `Build Android App Bundle`.

3. Keep the existing `build.gradle` pin as a second layer of protection.
   - No removal of the current fix.
   - Add cache cleanup or `--refresh-dependencies` only where useful so Codemagic does not reuse a previously transformed `bcprov-jdk18on-1.79.jar`.

4. Strengthen the generated Capacitor override script.
   - Update `capacitor-scripts/apply-overrides.mjs` so generated Android projects also get a buildscript-level Bouncy Castle alignment marker, not only project dependency alignment.

5. Add a validation check before the final bundle build.
   - Print/verify that generated Gradle files contain the Bouncy Castle alignment marker.
   - Fail early with a clear message if the protection was not injected.

## Technical details

The latest failure mentions `bcprov-jdk18on-1.78.1.jar`, so `1.78.1` still contains Java 21 multi-release classes that Gradle on JDK 17 cannot instrument. The fix is to keep Bouncy Castle on the older `jdk15on:1.70` line and redirect `jdk18on` requests there before Gradle resolves the buildscript classpath.