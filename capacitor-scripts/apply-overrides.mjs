#!/usr/bin/env node
/*
 * Patches the user's uploaded Capacitor project with build-form overrides
 * BEFORE `npx cap sync android` runs. Operates on:
 *   - capacitor.config.{ts,json}: appId, appName, plugins block, optional server.url
 *   - package.json: name, version, Capacitor core + auto-installed plugins
 *   - android/gradle.properties: AndroidX, Jetifier, MultiDex flags
 *   - android/app/build.gradle: applicationId, versionCode, versionName,
 *     MultiDex, Google Services, Kotlin support, AdMob SDK
 *   - android/app/src/main/AndroidManifest.xml: AdMob meta-data, permissions
 *   - android/app/src/main/res/values/strings.xml: app_name
 *   - webDir/index.html: bridge bootstrap (MobileAds init for AdMob)
 *
 * Env:
 *   PROJECT_DIR      - absolute path to the unzipped Capacitor project root
 *   APP_ID           - Android applicationId / Capacitor appId (e.g. com.example.app)
 *   APP_NAME         - App display name
 *   VERSION_NAME     - Semver like 1.2.3
 *   VERSION_CODE     - Integer Play version code
 *   ADMOB_APP_ID     - Optional ca-app-pub-...~... id; injected as meta-data
 *   ENABLE_BILLING   - "true" to bundle Play Billing plugin
 *   EXTRA_PLUGINS    - Comma-separated extra Capacitor plugin npm names to bundle
 *   STRICT_VALIDATION - "true" to fail hard if validation reports issues
 */
import fs from 'node:fs'
import path from 'node:path'

const PROJECT_DIR = process.env.PROJECT_DIR
if (!PROJECT_DIR || !fs.existsSync(PROJECT_DIR)) {
  console.error(`PROJECT_DIR is missing or does not exist: ${PROJECT_DIR}`)
  process.exit(1)
}
const APP_ID = (process.env.APP_ID || '').trim()
const APP_NAME = (process.env.APP_NAME || '').trim()
const VERSION_NAME = (process.env.VERSION_NAME || '1.0.0').trim()
const VERSION_CODE = Number.parseInt(process.env.VERSION_CODE || '1', 10) || 1
const ADMOB_APP_ID = (process.env.ADMOB_APP_ID || '').trim()
const ADMOB_BANNER_ID = (process.env.ADMOB_BANNER_ID || '').trim()
const ADMOB_INTERSTITIAL_ID = (process.env.ADMOB_INTERSTITIAL_ID || '').trim()
const ADMOB_REWARDED_ID = (process.env.ADMOB_REWARDED_ID || '').trim()
const ADMOB_REWARDED_INTERSTITIAL_ID = (process.env.ADMOB_REWARDED_INTERSTITIAL_ID || '').trim()
const ADMOB_APP_OPEN_ID = (process.env.ADMOB_APP_OPEN_ID || '').trim()
const ADMOB_ENABLED = !!ADMOB_APP_ID
// AdMob test mode is force-disabled at the build layer — production AABs must
// always serve real ad creatives from the user's configured ad unit IDs.
const ADMOB_TEST_MODE = false
const ENABLE_BILLING = (process.env.ENABLE_BILLING || '').toLowerCase() === 'true'
// When the user disables the native splash toggle in the build form, we
// completely neuter the Capacitor SplashScreen plugin so no logo/bitmap
// flashes at launch. Default = true (splash on) to match legacy behavior.
const ENABLE_NATIVE_SPLASH = (process.env.ENABLE_NATIVE_SPLASH || 'true').toLowerCase() === 'true'
const LOVABLE_NDK_VERSION = (process.env.LOVABLE_NDK_VERSION || '28.0.13004108').trim()
const EXTRA_PLUGINS = (process.env.EXTRA_PLUGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const STRICT_VALIDATION = (process.env.STRICT_VALIDATION || '').toLowerCase() === 'true'

if (!APP_ID || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(APP_ID)) {
  console.error(`Invalid APP_ID: ${APP_ID}`)
  process.exit(1)
}
if (ADMOB_APP_ID && !/^ca-app-pub-\d+~\d+$/.test(ADMOB_APP_ID)) {
  console.error(
    `Invalid ADMOB_APP_ID format: "${ADMOB_APP_ID}". Expected ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`,
  )
  process.exit(1)
}

const GOOGLE_ADMOB_SAMPLE_PUBLISHER = 'ca-app-pub-3940256099942544'
const ADMOB_UNIT_IDS = [
  ['ADMOB_BANNER_ID', ADMOB_BANNER_ID],
  ['ADMOB_INTERSTITIAL_ID', ADMOB_INTERSTITIAL_ID],
  ['ADMOB_REWARDED_ID', ADMOB_REWARDED_ID],
  ['ADMOB_REWARDED_INTERSTITIAL_ID', ADMOB_REWARDED_INTERSTITIAL_ID],
  ['ADMOB_APP_OPEN_ID', ADMOB_APP_OPEN_ID],
]
if (ADMOB_APP_ID && ADMOB_APP_ID.startsWith(GOOGLE_ADMOB_SAMPLE_PUBLISHER)) {
  console.error('Google sample/test AdMob App IDs are not allowed. Use your real AdMob App ID from your AdMob account.')
  process.exit(1)
}
for (const [name, value] of ADMOB_UNIT_IDS) {
  if (!value) continue
  if (!/^ca-app-pub-\d+\/\d+$/.test(value)) {
    console.error(`Invalid ${name} format: "${value}". Expected ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY`)
    process.exit(1)
  }
  if (value.startsWith(GOOGLE_ADMOB_SAMPLE_PUBLISHER)) {
    console.error(`Google sample/test ${name} is not allowed. Use a real ad unit ID from your AdMob account.`)
    process.exit(1)
  }
}

const log = (...a) => console.log('[apply-overrides]', ...a)
const warn = (...a) => console.warn('[apply-overrides][warn]', ...a)

const GOOGLE_PLAY_MINSDK22_MARKER = '// LOVABLE_GOOGLE_PLAY_SERVICES_MINSDK22_ALIGN'
const GOOGLE_PLAY_MINSDK22_BLOCK = `

${GOOGLE_PLAY_MINSDK22_MARKER}
allprojects {
    configurations.all {
        resolutionStrategy.eachDependency { details ->
            if (details.requested.group == 'com.google.android.gms') {
                def forced = [
                    'play-services-ads': '23.6.0',
                    'play-services-ads-lite': '23.6.0',
                    'play-services-ads-base': '23.6.0',
                    'play-services-ads-identifier': '18.0.0',
                    'play-services-appset': '16.0.1',
                    'play-services-base': '18.7.2',
                    'play-services-basement': '18.7.1',
                    'play-services-tasks': '18.3.2'
                ][details.requested.name]
                if (forced != null) {
                    details.useVersion forced
                    details.because 'Keep Google Play services compatible with app minSdk 22; newer releases require minSdk 23+'
                }
            }
            if (details.requested.group == 'com.google.android.ump' && details.requested.name == 'user-messaging-platform') {
                details.useVersion '3.0.0'
                details.because 'Mobile Ads 23.6.0 companion UMP release remains compatible with minSdk 22'
            }
        }
        resolutionStrategy.force(
            'com.google.android.gms:play-services-ads:23.6.0',
            'com.google.android.gms:play-services-ads-lite:23.6.0',
            'com.google.android.gms:play-services-ads-base:23.6.0',
            'com.google.android.gms:play-services-ads-identifier:18.0.0',
            'com.google.android.gms:play-services-appset:16.0.1',
            'com.google.android.gms:play-services-base:18.7.2',
            'com.google.android.gms:play-services-basement:18.7.1',
            'com.google.android.gms:play-services-tasks:18.3.2',
            'com.google.android.ump:user-messaging-platform:3.0.0'
        )
    }
}
`

function ensureRepositoryOrder(source) {
  const repoBlock = `repositories {
        mavenCentral()
        google()
        gradlePluginPortal()
    }`
  const dependencyRepoBlock = `repositories {
        mavenCentral()
        google()
    }`

  let next = source
  if (/pluginManagement\s*\{[\s\S]*?repositories\s*\{/m.test(next)) {
    next = next.replace(
      /pluginManagement\s*\{[\s\S]*?repositories\s*\{[\s\S]*?\n\s*\}[\s\S]*?\n\s*\}/m,
      `pluginManagement {\n    ${repoBlock}\n}`,
    )
  } else {
    next = `pluginManagement {\n    ${repoBlock}\n}\n\n${next}`
  }

  if (/dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{/m.test(next)) {
    next = next.replace(
      /dependencyResolutionManagement\s*\{[\s\S]*?repositoriesMode\.set\([^)]*\)[\s\S]*?repositories\s*\{[\s\S]*?\n\s*\}[\s\S]*?\n\s*\}/m,
      `dependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)\n    ${dependencyRepoBlock}\n}`,
    )
    next = next.replace(
      /dependencyResolutionManagement\s*\{(?![\s\S]*?repositoriesMode\.set)[\s\S]*?repositories\s*\{[\s\S]*?\n\s*\}[\s\S]*?\n\s*\}/m,
      `dependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)\n    ${dependencyRepoBlock}\n}`,
    )
  } else {
    const block = `dependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)\n    ${dependencyRepoBlock}\n}\n\n`
    const pluginMatch = next.match(/pluginManagement\s*\{[\s\S]*?\n\}/m)
    if (pluginMatch) {
      next = next.replace(pluginMatch[0], `${pluginMatch[0]}\n\n${block.trimEnd()}`)
    } else {
      next = `${block}${next}`
    }
  }

  return next
}

function repairBouncyCastleAlignment(source) {
  const staleRewrite = new RegExp(
    String.raw`\s*def replacement = name\.replace\('-jdk15on', '-jdk18on'\)\n` +
      String.raw`\s*details\.useTarget group: 'org\.bouncycastle', name: replacement, version: '1\.78\.1'\n` +
      String.raw`\s*details\.because 'Redirect legacy jdk15on to jdk18on 1\.78\.1 \(jdk15on has no 1\.78\.1 release\)'`,
    'g',
  )
  const staleReason = new RegExp(
    String.raw`Redirect legacy jdk15on to jdk18on 1\.78\.1 \(jdk15on has no 1\.78\.1 release\)`,
    'g',
  )
  return source
    .replace(
      staleRewrite,
      `
                    details.useVersion '1.70'
                    details.because 'Bouncy Castle jdk15on 1.70 avoids Java 21 bytecode in newer multi-release jars'`,
    )
    .replace(
      /org\.bouncycastle:([A-Za-z0-9-]+-jdk15on):1\.78\.1/g,
      'org.bouncycastle:$1:1.70',
    )
    .replace(/['"]org\.bouncycastle:[A-Za-z0-9-]+-jdk18on:1\.78\.1['"],?\s*/g, '')
    .replace(/,\s*'/g, ", '")
    .replace(/force\s+,\s*/g, 'force ')
    .replace(
      /details\.useVersion '1\.78\.1'\n\s*details\.because 'Bouncy Castle 1\.79 contains Java 21 multi-release classes that break JDK 17 Android bundle builds'/g,
      `def replacement = name.replace('-jdk18on', '-jdk15on')
                    details.useTarget group: 'org.bouncycastle', name: replacement, version: '1.70'
                    details.because 'Use Bouncy Castle jdk15on 1.70 because jdk18on 1.78+ ships Java 21 classes that Gradle on JDK 17 cannot instrument'`,
    )
    .replace(staleReason, 'Bouncy Castle jdk15on 1.70 avoids Java 21 bytecode in newer multi-release jars')
}

function forceAndroidSdkCompatibility(source) {
  let next = source
    .replace(/compileSdkVersion\s+rootProject\.ext\.compileSdkVersion/g, 'compileSdk 35')
    .replace(/compileSdk\s+rootProject\.ext\.compileSdkVersion/g, 'compileSdk 35')
    .replace(/compileSdkVersion\s*=\s*rootProject\.ext\.compileSdkVersion/g, 'compileSdkVersion = 35')
    .replace(/compileSdk\s*=\s*rootProject\.ext\.compileSdkVersion/g, 'compileSdk = 35')
    .replace(/targetSdkVersion\s+rootProject\.ext\.targetSdkVersion/g, 'targetSdk 35')
    .replace(/targetSdk\s+rootProject\.ext\.targetSdkVersion/g, 'targetSdk 35')
    .replace(/targetSdkVersion\s*=\s*rootProject\.ext\.targetSdkVersion/g, 'targetSdkVersion = 35')
    .replace(/targetSdk\s*=\s*rootProject\.ext\.targetSdkVersion/g, 'targetSdk = 35')
    .replace(/minSdkVersion\s+rootProject\.ext\.minSdkVersion/g, 'minSdk 22')
    .replace(/minSdk\s+rootProject\.ext\.minSdkVersion/g, 'minSdk 22')
    .replace(/minSdkVersion\s*=\s*rootProject\.ext\.minSdkVersion/g, 'minSdkVersion = 22')
    .replace(/minSdk\s*=\s*rootProject\.ext\.minSdkVersion/g, 'minSdk = 22')
    .replace(/compileSdkVersion\s+\d+/g, 'compileSdkVersion 35')
    .replace(/compileSdk\s+\d+/g, 'compileSdk 35')
    .replace(/compileSdkVersion\s*=\s*\d+/g, 'compileSdkVersion = 35')
    .replace(/compileSdk\s*=\s*\d+/g, 'compileSdk = 35')
    .replace(/compileSdkVersion\(\s*\d+\s*\)/g, 'compileSdkVersion(35)')
    .replace(/compileSdk\(\s*\d+\s*\)/g, 'compileSdk(35)')
    .replace(/targetSdkVersion\s+\d+/g, 'targetSdkVersion 35')
    .replace(/targetSdk\s+\d+/g, 'targetSdk 35')
    .replace(/targetSdkVersion\s*=\s*\d+/g, 'targetSdkVersion = 35')
    .replace(/targetSdk\s*=\s*\d+/g, 'targetSdk = 35')
    .replace(/targetSdkVersion\(\s*\d+\s*\)/g, 'targetSdkVersion(35)')
    .replace(/targetSdk\(\s*\d+\s*\)/g, 'targetSdk(35)')
    .replace(/minSdkVersion\s+\d+/g, 'minSdkVersion 22')
    .replace(/minSdk\s+\d+/g, 'minSdk 22')
    .replace(/minSdkVersion\s*=\s*\d+/g, 'minSdkVersion = 22')
    .replace(/minSdk\s*=\s*\d+/g, 'minSdk = 22')
    .replace(/minSdkVersion\(\s*\d+\s*\)/g, 'minSdkVersion(22)')
    .replace(/minSdk\(\s*\d+\s*\)/g, 'minSdk(22)')

  if (!/\bcompileSdk(?:Version)?\b/.test(next)) {
    next = next.replace(/android\s*\{/, (m) => `${m}\n    compileSdk 35`)
  }

  if (!/\btargetSdk(?:Version)?\b/.test(next)) {
    next = next.replace(/defaultConfig\s*\{/, (m) => `${m}\n        targetSdk 35`)
  }

  if (!/\bminSdk(?:Version)?\b/.test(next)) {
    next = next.replace(/defaultConfig\s*\{/, (m) => `${m}\n        minSdk 22`)
  }

  return next
}

function force16KbJniPackaging(source, isKts = false) {
  let next = source
    // Existing user projects sometimes explicitly opt into legacy extracted
    // native libraries. That produces 4 KB-aligned APK entries from the AAB,
    // which is exactly what Play Console flags. Normalize every form we see.
    .replace(/useLegacyPackaging\s*=\s*true/g, 'useLegacyPackaging = false')
    .replace(/useLegacyPackaging\s+true/g, 'useLegacyPackaging = false')
    .replace(/useLegacyPackaging\s*\(\s*true\s*\)/g, 'useLegacyPackaging = false')
    .replace(/useLegacyPackaging\s+false/g, 'useLegacyPackaging = false')

  if (/useLegacyPackaging\s*=\s*false/.test(next)) return next

  const block = isKts
    ? `
    // LOVABLE_16KB_JNILIBS — 16 KB page-size compatibility for Play (API 35+)
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
`
    : `
    // LOVABLE_16KB_JNILIBS — 16 KB page-size compatibility for Play (API 35+)
    packagingOptions {
        jniLibs {
            useLegacyPackaging = false
        }
    }
`

  if (/android\s*\{/.test(next)) {
    next = next.replace(/android\s*\{/, (m) => `${m}\n${block}`)
  }
  return next
}

function forceNdk28(source, isKts = false) {
  if (!LOVABLE_NDK_VERSION) return source
  const ndkLine = isKts ? `ndkVersion = "${LOVABLE_NDK_VERSION}"` : `ndkVersion "${LOVABLE_NDK_VERSION}"`
  let next = source
    .replace(/ndkVersion\s*=\s*["'][^"']+["']/g, ndkLine)
    .replace(/ndkVersion\s+["'][^"']+["']/g, ndkLine)
    .replace(/ndkVersion\s*=\s*rootProject\.ext\.ndkVersion/g, ndkLine)
    .replace(/ndkVersion\s+rootProject\.ext\.ndkVersion/g, ndkLine)
    .replace(/ndkVersion\s*=\s*project\.ext\.ndkVersion/g, ndkLine)
    .replace(/ndkVersion\s+project\.ext\.ndkVersion/g, ndkLine)

  if (!/ndkVersion\s*(?:=\s*)?["']/.test(next) && /android\s*\{/.test(next)) {
    next = next.replace(/android\s*\{/, (m) => `${m}\n    ${ndkLine}`)
  }
  return next
}

function forceVariablesGradleNdk(source) {
  const lines = source.split(/(?<=\n)/)
  let extDepth = 0
  let found = false
  const next = lines.map((line) => {
    const inExtBlock = extDepth > 0
    const match = line.match(/^(\s*)(?:ext\.)?ndkVersion\s*=\s*["'][^"']+["'][^\S\r\n]*(\r?\n)?$/)
    let out = line
    if (match) {
      found = true
      out = inExtBlock
        ? `${match[1]}ndkVersion = '${LOVABLE_NDK_VERSION}'${match[2] ?? ''}`
        : `${match[1]}ext.ndkVersion = '${LOVABLE_NDK_VERSION}'${match[2] ?? ''}`
    }

    if (/^\s*ext\s*\{/.test(line)) extDepth += (line.match(/\{/g) || []).length
    if (extDepth > 0) extDepth -= (line.match(/\}/g) || []).length
    if (extDepth < 0) extDepth = 0
    return out
  }).join('')

  if (found) return next
  return `${next.endsWith('\n') || next === '' ? next : `${next}\n`}ext.ndkVersion = '${LOVABLE_NDK_VERSION}'\n`
}

/* ---------- Supported Capacitor plugin catalog ----------
 * Plugins listed here will be auto-installed when:
 *   a) the user's package.json already references them (detected)
 *   b) they appear in EXTRA_PLUGINS
 *   c) they are flagged on by a feature env (AdMob, Billing)
 * Versions track Capacitor 6 stable releases.
 */
const PLUGIN_CATALOG = {
  '@capacitor/app': '^6.0.0',
  '@capacitor/browser': '^6.0.0',
  '@capacitor/camera': '^6.0.0',
  '@capacitor/clipboard': '^6.0.0',
  '@capacitor/device': '^6.0.0',
  '@capacitor/filesystem': '^6.0.0',
  '@capacitor/geolocation': '^6.0.0',
  '@capacitor/haptics': '^6.0.0',
  '@capacitor/keyboard': '^6.0.0',
  '@capacitor/local-notifications': '^6.0.0',
  '@capacitor/network': '^6.0.0',
  '@capacitor/preferences': '^6.0.0',
  '@capacitor/push-notifications': '^6.0.0',
  '@capacitor/share': '^6.0.0',
  '@capacitor/splash-screen': '^6.0.0',
  '@capacitor/status-bar': '^6.0.0',
  '@capacitor-community/admob': '^6.0.0',
  '@capacitor-community/in-app-review': '^6.0.0',
  '@capgo/capacitor-purchases': '^6.0.0', // Play Billing wrapper
}

/* ---------- capacitor.config.{ts,json} ---------- */
const capJsonPath = path.join(PROJECT_DIR, 'capacitor.config.json')
const capTsPath = path.join(PROJECT_DIR, 'capacitor.config.ts')

function detectWebDir() {
  for (const d of ['dist', 'www', 'build', 'public']) {
    if (fs.existsSync(path.join(PROJECT_DIR, d, 'index.html'))) return d
  }
  return 'dist'
}

function patchCapacitorConfigJson() {
  const cfg = fs.existsSync(capJsonPath)
    ? JSON.parse(fs.readFileSync(capJsonPath, 'utf8'))
    : { appId: APP_ID, appName: APP_NAME || 'App', webDir: detectWebDir() }

  cfg.appId = APP_ID
  if (APP_NAME) cfg.appName = APP_NAME
  if (!cfg.webDir) cfg.webDir = detectWebDir()
  if (cfg.server && typeof cfg.server === 'object') {
    delete cfg.server.url
    if (Object.keys(cfg.server).length === 0) delete cfg.server
  }
  // Sensible Android defaults
  cfg.android = {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    ...(cfg.android || {}),
  }
  // Ensure plugins block exists so Capacitor sync registers every plugin
  cfg.plugins = cfg.plugins || {}
  if (ADMOB_APP_ID) {
    cfg.plugins.AdMob = {
      ...(cfg.plugins.AdMob || {}),
      appId: ADMOB_APP_ID,
      initializeForTesting: false,
      testingDevices: [],
    }
  } else if (cfg.plugins.AdMob) {
    delete cfg.plugins.AdMob
  }
  if (ENABLE_NATIVE_SPLASH) {
    cfg.plugins.SplashScreen = {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      ...(cfg.plugins.SplashScreen || {}),
    }
  } else {
    // Splash disabled → force zero-duration + immediate auto-hide so the
    // Capacitor SplashScreen plugin never renders the app icon at launch.
    // We overwrite any user-supplied values because the build-form toggle
    // must win over stale project config.
    cfg.plugins.SplashScreen = {
      launchShowDuration: 0,
      launchAutoHide: true,
      launchFadeOutDuration: 0,
      backgroundColor: '#00000000',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: false,
      splashImmersive: false,
    }
    log('ENABLE_NATIVE_SPLASH=false → SplashScreen plugin neutralized')
  }

  fs.writeFileSync(capJsonPath, JSON.stringify(cfg, null, 2) + '\n')
  log(`Wrote capacitor.config.json appId=${APP_ID} webDir=${cfg.webDir}`)
}

if (fs.existsSync(capTsPath) && !fs.existsSync(capJsonPath)) {
  // Convert/append in-place by editing the TS file lightly; safer than parsing
  let src = fs.readFileSync(capTsPath, 'utf8')
  src = src.replace(/appId:\s*['"`][^'"`]*['"`]/, `appId: '${APP_ID}'`)
  if (APP_NAME)
    src = src.replace(
      /appName:\s*['"`][^'"`]*['"`]/,
      `appName: '${APP_NAME.replace(/'/g, "\\'")}'`,
    )
  src = src.replace(/url:\s*['"`][^'"`]*['"`]\s*,?/g, '// url: removed by builder,')
  fs.writeFileSync(capTsPath, src)
  log(`Patched capacitor.config.ts appId=${APP_ID}`)
  // Additionally write a JSON twin so plugin block is always honored
  patchCapacitorConfigJson()
} else {
  patchCapacitorConfigJson()
}

/* ---------- package.json (deps + plugin auto-install) ---------- */
const pkgPath = path.join(PROJECT_DIR, 'package.json')
const installedPlugins = new Set()

if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.version = VERSION_NAME
  if (!pkg.name) pkg.name = APP_ID.replace(/\./g, '-')
  pkg.dependencies = pkg.dependencies || {}
  pkg.devDependencies = pkg.devDependencies || {}

  const ensureDep = (name, version, dev = false, force = false) => {
    if (!force && (pkg.dependencies[name] || pkg.devDependencies[name])) {
      installedPlugins.add(name)
      return
    }
    if (dev) delete pkg.dependencies[name]
    else delete pkg.devDependencies[name]
    ;(dev ? pkg.devDependencies : pkg.dependencies)[name] = version
    installedPlugins.add(name)
    log(`${force ? 'Forced' : 'Added'} ${dev ? 'devDependency' : 'dependency'} ${name}@${version}`)
  }

  // Always wire core — FORCE the major version so it stays in lockstep with the
  // plugin catalog (all pinned to ^6.x). Otherwise @capacitor/core@^8 from the
  // user's project collides with @capacitor/splash-screen@^6 peer range and
  // `npm install` fails with ERESOLVE.
  ensureDep('@capacitor/core', '^6.2.1', false, true)
  ensureDep('@capacitor/android', '^6.2.1', false, true)
  ensureDep('@capacitor/cli', '^6.2.1', true, true)

  // Also realign any user-pinned plugin to the catalog version so peer ranges
  // resolve cleanly against @capacitor/core@^6.
  for (const [name, version] of Object.entries(PLUGIN_CATALOG)) {
    if (pkg.dependencies[name]) pkg.dependencies[name] = version
    if (pkg.devDependencies[name]) pkg.devDependencies[name] = version
  }

  // Detect plugins already present in package.json — keep them, mark installed
  for (const name of Object.keys(PLUGIN_CATALOG)) {
    if (pkg.dependencies[name] || pkg.devDependencies[name]) installedPlugins.add(name)
  }

  // Feature-driven bundling
  if (ADMOB_APP_ID) ensureDep('@capacitor-community/admob', PLUGIN_CATALOG['@capacitor-community/admob'])
  if (ENABLE_BILLING) ensureDep('@capgo/capacitor-purchases', PLUGIN_CATALOG['@capgo/capacitor-purchases'])

  // Always include the safe baseline so most apps Just Work natively
  for (const name of [
    '@capacitor/app',
    '@capacitor/preferences',
    '@capacitor/status-bar',
    '@capacitor/splash-screen',
    '@capacitor/network',
    '@capacitor/device',
    '@capacitor/haptics',
  ]) {
    ensureDep(name, PLUGIN_CATALOG[name])
  }

  // User-requested extras
  for (const name of EXTRA_PLUGINS) {
    const version = PLUGIN_CATALOG[name] || 'latest'
    ensureDep(name, version)
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  log(`Patched package.json version=${VERSION_NAME} plugins=${installedPlugins.size}`)
} else {
  warn('No package.json in PROJECT_DIR — Capacitor sync will likely fail')
}

/* ---------- webDir bootstrap: auto-init MobileAds when AdMob is on ---------- */
function injectAdMobBootstrap() {
  if (!ADMOB_APP_ID) return
  const webDir = (() => {
    if (fs.existsSync(capJsonPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(capJsonPath, 'utf8'))
        if (cfg.webDir) return cfg.webDir
      } catch {}
    }
    return detectWebDir()
  })()
  const webRoot = path.join(PROJECT_DIR, webDir)
  const indexHtml = path.join(webRoot, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    warn(`webDir/index.html not found at ${indexHtml}; skipping AdMob bootstrap injection`)
    return
  }
  const bootstrapDir = path.join(webRoot, 'capacitor-bootstrap')
  fs.mkdirSync(bootstrapDir, { recursive: true })
  const bootstrapFile = path.join(bootstrapDir, 'admob-init.js')
  const js = `// Auto-generated by capacitor-scripts/apply-overrides.mjs
// Initializes Google Mobile Ads at app startup so banner/interstitial/rewarded
// /rewarded-interstitial/app-open ads are ready to call from the web layer.
(function () {
  if (typeof window === 'undefined') return;
  function init() {
    try {
      var Capacitor = window.Capacitor;
      if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;
      var AdMob = (Capacitor.Plugins && Capacitor.Plugins.AdMob) || window.AdMob;
      if (!AdMob || typeof AdMob.initialize !== 'function') return;
      var ids = (window.__ADMOB_IDS__ || {});
      AdMob.initialize({
        requestTrackingAuthorization: true,
        testingDevices: [],
        initializeForTesting: false,
      }).then(function () {
        window.dispatchEvent(new CustomEvent('capacitor-admob-ready'));
      }).catch(function (err) { console.warn('[AdMob init failed]', err); });
    } catch (e) { console.warn('[AdMob bootstrap]', e); }
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
`
  fs.writeFileSync(bootstrapFile, js)

  // Ship the full AdMobBridge alongside the init script. The bridge provides
  // window.AdMobBridge with banner/interstitial/rewarded/rewarded-interstitial/
  // app-open methods AND forwards every native callback as a DOM event.
  const here = path.dirname(new URL(import.meta.url).pathname)
  const bridgeSrc = path.join(here, 'web-bridge', 'admob.js')
  let bridgeInjected = false
  if (fs.existsSync(bridgeSrc)) {
    fs.copyFileSync(bridgeSrc, path.join(bootstrapDir, 'admob.js'))
    bridgeInjected = true
  } else {
    warn(`AdMob bridge source missing at ${bridgeSrc}; web layer will only have raw Capacitor.Plugins.AdMob.`)
  }

  // Write per-build ad-unit IDs as a tiny global so the web layer can call
  // AdMob.showInterstitialAd() / showRewardedAd() / showBannerAd() without
  // hardcoding any IDs. The bridge + helper read from window.__ADMOB_IDS__.
  const idsFile = path.join(bootstrapDir, 'admob-ids.js')
  const idsPayload = {
    appId: ADMOB_APP_ID,
    banner: ADMOB_BANNER_ID,
    interstitial: ADMOB_INTERSTITIAL_ID,
    rewarded: ADMOB_REWARDED_ID,
    rewardedInterstitial: ADMOB_REWARDED_INTERSTITIAL_ID,
    appOpen: ADMOB_APP_OPEN_ID,
    testMode: false,
  }
  fs.writeFileSync(
    idsFile,
    `// Auto-generated by capacitor-scripts/apply-overrides.mjs\n` +
      `// Per-build AdMob configuration injected from the dashboard form.\n` +
      `window.__ADMOB_IDS__ = ${JSON.stringify(idsPayload, null, 2)};\n`,
  )
  log(`Wrote AdMob IDs config (banner=${!!ADMOB_BANNER_ID} interstitial=${!!ADMOB_INTERSTITIAL_ID} rewarded=${!!ADMOB_REWARDED_ID} rewardedInterstitial=${!!ADMOB_REWARDED_INTERSTITIAL_ID} appOpen=${!!ADMOB_APP_OPEN_ID} test=${ADMOB_TEST_MODE})`)

  let html = fs.readFileSync(indexHtml, 'utf8')
  const tags = []
  // IDs first so the bridge/init scripts see them when they run.
  if (!html.includes('capacitor-bootstrap/admob-ids.js')) {
    tags.push(`<script src="capacitor-bootstrap/admob-ids.js"></script>`)
  }
  if (bridgeInjected && !html.includes('capacitor-bootstrap/admob.js')) {
    tags.push(`<script src="capacitor-bootstrap/admob.js" defer></script>`)
  }
  if (!html.includes('capacitor-bootstrap/admob-init.js')) {
    tags.push(`<script src="capacitor-bootstrap/admob-init.js" defer></script>`)
  }
  if (tags.length) {
    const block = tags.map((t) => `  ${t}`).join('\n')
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${block}\n  </body>`)
    else html += `\n${block}\n`
    fs.writeFileSync(indexHtml, html)
    log(`Injected AdMob scripts into webDir/index.html (${tags.length} tag(s))`)
  }
}
injectAdMobBootstrap()

/* ---------- webDir bootstrap: Play Billing bridge ----------
 * Copies `capacitor-scripts/web-bridge/play-billing.js` into webDir and
 * injects a <script> tag so window.PlayBilling is available before the
 * app loads. Runs when ENABLE_BILLING=true OR when the user has wired
 * billing manually (we still ship the bridge — it no-ops without native).
 */
function injectPlayBillingBootstrap() {
  if (!ENABLE_BILLING) return
  const webDir = (() => {
    if (fs.existsSync(capJsonPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(capJsonPath, 'utf8'))
        if (cfg.webDir) return cfg.webDir
      } catch {}
    }
    return detectWebDir()
  })()
  const webRoot = path.join(PROJECT_DIR, webDir)
  const indexHtml = path.join(webRoot, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    warn(`webDir/index.html not found at ${indexHtml}; skipping Play Billing bootstrap`)
    return
  }
  // Source lives alongside this script
  const here = path.dirname(new URL(import.meta.url).pathname)
  const src = path.join(here, 'web-bridge', 'play-billing.js')
  if (!fs.existsSync(src)) {
    warn(`Play Billing bridge source missing at ${src}; skipping injection`)
    return
  }
  const bootstrapDir = path.join(webRoot, 'capacitor-bootstrap')
  fs.mkdirSync(bootstrapDir, { recursive: true })
  const dest = path.join(bootstrapDir, 'play-billing.js')
  fs.copyFileSync(src, dest)

  let html = fs.readFileSync(indexHtml, 'utf8')
  const tag = `<script src="capacitor-bootstrap/play-billing.js" defer></script>`
  if (!html.includes('capacitor-bootstrap/play-billing.js')) {
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `  ${tag}\n  </body>`)
    else html += `\n${tag}\n`
    fs.writeFileSync(indexHtml, html)
    log('Injected Play Billing bootstrap script into webDir/index.html')
  }
}
injectPlayBillingBootstrap()


/* ---------- android/ overrides ---------- */
const androidDir = path.join(PROJECT_DIR, 'android')
if (fs.existsSync(androidDir)) {
  patchAndroid(androidDir)
} else {
  log('No android/ directory present yet; overrides will re-apply after `cap add android`.')
}

export function patchAndroid(root) {
  /* settings.gradle — make Maven Central available before Google/Plugin Portal so
   * legacy AGP buildscript deps (notably Bouncy Castle jdk15on) resolve reliably.
   */
  const settingsGradle = path.join(root, 'settings.gradle')
  if (fs.existsSync(settingsGradle)) {
    let s = fs.readFileSync(settingsGradle, 'utf8')
    const patched = ensureRepositoryOrder(s)
    if (patched !== s) {
      s = patched
      fs.writeFileSync(settingsGradle, s)
      log('Ensured Maven Central / Google repositories in settings.gradle')
    }
  }

  /* gradle.properties — AndroidX, Jetifier, MultiDex, 16 KB page-size compat */
  const gradleProps = path.join(root, 'gradle.properties')
  const requiredProps = {
    'android.useAndroidX': 'true',
    'android.enableJetifier': 'true',
    'org.gradle.jvmargs': '-Xmx2048m -Dfile.encoding=UTF-8',
    'android.nonTransitiveRClass': 'true',
    // 16 KB page-size compatibility (Play requirement for API 35+).
    // Keeps .so files uncompressed & 16 KB-aligned inside the AAB.
    'android.bundle.enableUncompressedNativeLibs': 'true',
  }
  let props = fs.existsSync(gradleProps) ? fs.readFileSync(gradleProps, 'utf8') : ''
  for (const [k, v] of Object.entries(requiredProps)) {
    const re = new RegExp(`^${k.replace(/\./g, '\\.')}=.*$`, 'm')
    if (re.test(props)) props = props.replace(re, `${k}=${v}`)
    else props += `${props.endsWith('\n') || props === '' ? '' : '\n'}${k}=${v}\n`
  }
  fs.writeFileSync(gradleProps, props)
  log('Ensured AndroidX / Jetifier / nonTransitiveRClass / 16KB-native-libs in gradle.properties')


  /* app/build.gradle — applicationId/version, MultiDex, Google Services, Kotlin */
  const buildGradle = path.join(root, 'app', 'build.gradle')
  const buildGradleKts = path.join(root, 'app', 'build.gradle.kts')
  const appGradlePath = fs.existsSync(buildGradle) ? buildGradle : (fs.existsSync(buildGradleKts) ? buildGradleKts : '')
  if (appGradlePath) {
    const isKts = appGradlePath.endsWith('.kts')
    let g = fs.readFileSync(appGradlePath, 'utf8')
    g = g.replace(/applicationId\s+["'][^"']+["']/, `applicationId "${APP_ID}"`)
    g = g.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`)
    g = g.replace(/versionName\s+["'][^"']+["']/, `versionName "${VERSION_NAME}"`)
    g = forceAndroidSdkCompatibility(g)
    g = forceNdk28(g, isKts)
    // AGP 8 requires `namespace` in every module. Capacitor 6 sets it, but if a
    // user shipped an older template or removed it, Gradle fails with
    //   "Namespace not specified. Specify a namespace in the module's build file."
    if (!/^\s*namespace\s+["']/m.test(g)) {
      g = g.replace(/android\s*\{/, (m) => `${m}\n    namespace "${APP_ID}"`)
    } else {
      g = g.replace(/namespace\s+["'][^"']+["']/, `namespace "${APP_ID}"`)
    }
    // MultiDex
    if (!/multiDexEnabled\s+true/.test(g)) {
      g = g.replace(/defaultConfig\s*\{/, (m) => `${m}\n        multiDexEnabled true`)
    }
    if (!/androidx\.multidex:multidex/.test(g)) {
      g = g.replace(/dependencies\s*\{/, (m) => `${m}\n    implementation 'androidx.multidex:multidex:2.0.1'`)
    }
    // 16 KB page-size compatibility — required by Google Play from Nov 2025 for
    // apps targeting API 35+. Keep .so files uncompressed & page-aligned so
    // they can be mmap'd directly from the APK on 16 KB-page devices.
    g = force16KbJniPackaging(g, isKts)

    if (ENABLE_BILLING && !/com\.android\.billingclient:billing/.test(g)) {
      g = g.replace(
        /dependencies\s*\{/,
        (m) => `${m}\n    implementation 'com.android.billingclient:billing:7.1.1'`,
      )
    }

    // AdMob SDK — Capacitor AdMob plugin already pulls play-services-ads, but be defensive
    if (ADMOB_APP_ID && !/play-services-ads/.test(g)) {
      g = g.replace(
        /dependencies\s*\{/,
        (m) => `${m}\n    implementation 'com.google.android.gms:play-services-ads:23.6.0'`,
      )
    }
    // Google Services plugin (only if google-services.json present in app/)
    const gsJson = path.join(root, 'app', 'google-services.json')
    if (fs.existsSync(gsJson) && !/com\.google\.gms\.google-services/.test(g)) {
      g = `apply plugin: 'com.google.gms.google-services'\n${g}`
      log('Applied google-services plugin (google-services.json detected)')
    }
    fs.writeFileSync(appGradlePath, g)
    log(
      `Patched app/build.gradle (applicationId=${APP_ID} versionCode=${VERSION_CODE} versionName=${VERSION_NAME})`,
    )
  }

  const variablesGradle = path.join(root, 'variables.gradle')
  if (fs.existsSync(variablesGradle)) {
    const vars = fs.readFileSync(variablesGradle, 'utf8')
    let next = forceVariablesGradleNdk(forceAndroidSdkCompatibility(vars))
    if (next !== vars) {
      fs.writeFileSync(variablesGradle, next)
      log('Locked android/variables.gradle to compileSdk 35, targetSdk 35, minSdk 22, and safe NDK r28+ extra property')
    }
  }

  /* Root build.gradle — Google Services classpath if needed */
  const rootGradle = path.join(root, 'build.gradle')
  if (fs.existsSync(rootGradle)) {
    let g = fs.readFileSync(rootGradle, 'utf8')
    const agpAligned = g
      .replace(/id\s+['"]com\.android\.application['"]\s+version\s+['"][^'"]+['"]/g, "id 'com.android.application' version '8.6.1'")
      .replace(/id\s+['"]com\.android\.library['"]\s+version\s+['"][^'"]+['"]/g, "id 'com.android.library' version '8.6.1'")
      .replace(/classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"]/g, "classpath 'com.android.tools.build:gradle:8.6.1'")
    if (agpAligned !== g) {
      g = agpAligned
      fs.writeFileSync(rootGradle, g)
      log('Aligned Android Gradle Plugin to 8.6.1 for Java 21 / Gradle 8.7 builds')
    }
    const repaired = repairBouncyCastleAlignment(g)
    if (repaired !== g) {
      g = repaired
      fs.writeFileSync(rootGradle, g)
      log('Repaired stale Bouncy Castle jdk15on alignment in root build.gradle')
    }
    if (!/LOVABLE_BOUNCY_CASTLE_JDK17_ALIGN/.test(g)) {
      g += `

// LOVABLE_BOUNCY_CASTLE_JDK17_ALIGN
allprojects {
    configurations.all {
        resolutionStrategy.eachDependency { details ->
            if (details.requested.group == 'org.bouncycastle') {
                def name = details.requested.name
                if (name.endsWith('-jdk15on')) {
                    details.useVersion '1.70'
                    details.because 'Bouncy Castle jdk15on 1.70 avoids Java 21 bytecode in newer multi-release jars'
                } else if (name.endsWith('-jdk18on')) {
                    def replacement = name.replace('-jdk18on', '-jdk15on')
                    details.useTarget group: 'org.bouncycastle', name: replacement, version: '1.70'
                    details.because 'Use Bouncy Castle jdk15on 1.70 because jdk18on 1.78+ ships Java 21 classes that Gradle on JDK 17 cannot instrument'
                }
            }
        }
        resolutionStrategy.force 'org.bouncycastle:bcprov-jdk15on:1.70', 'org.bouncycastle:bcpkix-jdk15on:1.70', 'org.bouncycastle:bcutil-jdk15on:1.70', 'org.bouncycastle:bctls-jdk15on:1.70'
    }
}
`
      fs.writeFileSync(rootGradle, g)
      log('Pinned Bouncy Castle dependencies to jdk15on 1.70 for JDK 17 Android builds')
    }
    g = fs.readFileSync(rootGradle, 'utf8')
    if (!g.includes(GOOGLE_PLAY_MINSDK22_MARKER)) {
      g += GOOGLE_PLAY_MINSDK22_BLOCK
      fs.writeFileSync(rootGradle, g)
      log('Pinned Google Play services / Mobile Ads to minSdk 22-compatible versions')
    }
    g = fs.readFileSync(rootGradle, 'utf8')
    if (!/LOVABLE_BOUNCY_CASTLE_BUILDSCRIPT_JDK17_ALIGN/.test(g)) {
      g += `

// LOVABLE_BOUNCY_CASTLE_BUILDSCRIPT_JDK17_ALIGN
gradle.beforeProject { project ->
    project.buildscript.repositories { repos ->
        repos.mavenCentral()
        repos.google()
        repos.gradlePluginPortal()
    }
    project.repositories { repos ->
        repos.mavenCentral()
        repos.google()
    }
    project.buildscript.configurations.configureEach { cfg ->
        cfg.resolutionStrategy.eachDependency { details ->
            if (details.requested.group == 'org.bouncycastle') {
                def name = details.requested.name
                if (name.endsWith('-jdk15on')) {
                    details.useVersion '1.70'
                    details.because 'Bouncy Castle jdk15on 1.70 avoids Java 21 bytecode in newer multi-release jars'
                } else if (name.endsWith('-jdk18on')) {
                    def replacement = name.replace('-jdk18on', '-jdk15on')
                    details.useTarget group: 'org.bouncycastle', name: replacement, version: '1.70'
                    details.because 'Use Bouncy Castle jdk15on 1.70 because jdk18on 1.78+ ships Java 21 classes that Gradle on JDK 17 cannot instrument'
                }
            }
        }
        cfg.resolutionStrategy.force 'org.bouncycastle:bcprov-jdk15on:1.70', 'org.bouncycastle:bcpkix-jdk15on:1.70', 'org.bouncycastle:bcutil-jdk15on:1.70', 'org.bouncycastle:bctls-jdk15on:1.70'
    }
}
allprojects { project ->
    project.buildscript.repositories { repos ->
        repos.mavenCentral()
        repos.google()
        repos.gradlePluginPortal()
    }
    project.repositories { repos ->
        repos.mavenCentral()
        repos.google()
    }
    project.buildscript.configurations.configureEach { cfg ->
        cfg.resolutionStrategy.eachDependency { details ->
            if (details.requested.group == 'org.bouncycastle') {
                def name = details.requested.name
                if (name.endsWith('-jdk15on')) {
                    details.useVersion '1.70'
                    details.because 'Bouncy Castle jdk15on 1.70 avoids Java 21 bytecode in newer multi-release jars'
                } else if (name.endsWith('-jdk18on')) {
                    def replacement = name.replace('-jdk18on', '-jdk15on')
                    details.useTarget group: 'org.bouncycastle', name: replacement, version: '1.70'
                    details.because 'Use Bouncy Castle jdk15on 1.70 because jdk18on 1.78+ ships Java 21 classes that Gradle on JDK 17 cannot instrument'
                }
            }
        }
        cfg.resolutionStrategy.force 'org.bouncycastle:bcprov-jdk15on:1.70', 'org.bouncycastle:bcpkix-jdk15on:1.70', 'org.bouncycastle:bcutil-jdk15on:1.70', 'org.bouncycastle:bctls-jdk15on:1.70'
    }
}
`
      fs.writeFileSync(rootGradle, g)
      log('Pinned Bouncy Castle buildscript dependencies to jdk15on 1.70 for JDK 17 Android builds')
    }
  }
  if (fs.existsSync(rootGradle) && fs.existsSync(path.join(root, 'app', 'google-services.json'))) {
    let g = fs.readFileSync(rootGradle, 'utf8')
    if (!/com\.google\.gms:google-services/.test(g)) {
      g = g.replace(
        /dependencies\s*\{/,
        (m) => `${m}\n        classpath 'com.google.gms:google-services:4.4.2'`,
      )
      fs.writeFileSync(rootGradle, g)
      log('Added google-services classpath to root build.gradle')
    }
  }

  /* strings.xml */
  const stringsPath = path.join(root, 'app', 'src', 'main', 'res', 'values', 'strings.xml')
  if (fs.existsSync(stringsPath) && APP_NAME) {
    let s = fs.readFileSync(stringsPath, 'utf8')
    const escaped = APP_NAME.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    s = s.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${escaped}</string>`)
    s = s.replace(
      /<string name="title_activity_main">[^<]*<\/string>/,
      `<string name="title_activity_main">${escaped}</string>`,
    )
    fs.writeFileSync(stringsPath, s)
    log(`Patched strings.xml app_name=${APP_NAME}`)
  }

  /* AndroidManifest.xml — perms + AdMob meta-data */
  const manifestPath = path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml')
  if (fs.existsSync(manifestPath)) {
    let m = fs.readFileSync(manifestPath, 'utf8')
    // Ensure xmlns:tools so we can use tools:replace below.
    if (!/xmlns:tools=/.test(m)) {
      m = m.replace(
        /<manifest\b([^>]*)>/,
        (_match, attrs) => `<manifest${attrs} xmlns:tools="http://schemas.android.com/tools">`,
      )
    }
    const stripPerm = (perm) => {
      const escaped = perm.replace(/\./g, '\\.')
      m = m.replace(
        new RegExp(`\\n\\s*<uses-permission[^>]+android:name=["']${escaped}["'][^>]*(?:/>|>\\s*</uses-permission>)`, 'g'),
        '',
      )
    }
    const ensurePerm = (perm, forcePositive = false) => {
      if (forcePositive) stripPerm(perm)
      if (!new RegExp(`uses-permission[^>]+${perm.replace(/\./g, '\\.')}`).test(m)) {
        m = m.replace(
          /<manifest([^>]*)>/,
          `<manifest$1>\n    <uses-permission android:name="${perm}" />`,
        )
      }
    }
    ensurePerm('android.permission.INTERNET')
    ensurePerm('android.permission.ACCESS_NETWORK_STATE')
    if (installedPlugins.has('@capacitor/push-notifications')) {
      ensurePerm('android.permission.POST_NOTIFICATIONS')
    }
    if (installedPlugins.has('@capacitor/geolocation')) {
      ensurePerm('android.permission.ACCESS_COARSE_LOCATION')
      ensurePerm('android.permission.ACCESS_FINE_LOCATION')
    }
    if (installedPlugins.has('@capacitor/camera')) {
      ensurePerm('android.permission.CAMERA')
    }
    if (ENABLE_BILLING) ensurePerm('com.android.vending.BILLING')
    // Google Play requires com.google.android.gms.permission.AD_ID on any
    // app targeting Android 13+ that can display ads (native AdMob, web ads
    // inside the WebView, or third-party ad SDKs). Always declare it and
    // strip any stale tools:node="remove" nodes so the merged manifest ends
    // up with a single positive declaration.
    stripPerm('com.google.android.gms.permission.AD_ID')
    ensurePerm('com.google.android.gms.permission.AD_ID', true)
    if (!ADMOB_ENABLED) {
      m = m.replace(
        /\n\s*<meta-data\s+android:name=["']com\.google\.android\.gms\.ads\.APPLICATION_ID["'][^>]*(?:\/>|>\s*<\/meta-data>)/g,
        '',
      )
    }


    // 16 KB page-size compatibility — ensure <application> declares
    // android:extractNativeLibs="false" so the OS mmap's the .so files
    // directly from the APK at their 16 KB alignment (Play requirement).
    if (/<application\b/.test(m)) {
      if (!/android:extractNativeLibs\s*=/.test(m)) {
        m = m.replace(/<application\b([^>]*)>/, (_full, attrs) =>
          `<application${attrs} android:extractNativeLibs="false">`,
        )
      } else {
        m = m.replace(/android:extractNativeLibs\s*=\s*"[^"]*"/, 'android:extractNativeLibs="false"')
      }
    }



    if (ADMOB_APP_ID) {
      // tools:replace prevents manifest-merger conflicts when the AdMob plugin
      // (or a transitive lib) declares its own APPLICATION_ID meta-data.
      const adMeta = `        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ADMOB_APP_ID}" tools:replace="android:value" />`
      if (/com\.google\.android\.gms\.ads\.APPLICATION_ID/.test(m)) {
        m = m.replace(
          /<meta-data\s+android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[^/]*\/>/,
          `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ADMOB_APP_ID}" tools:replace="android:value" />`,
        )
      } else {
        m = m.replace(/<\/application>/, `${adMeta}\n    </application>`)
      }
      log(`Injected AdMob APPLICATION_ID=${ADMOB_APP_ID}`)
    }
    fs.writeFileSync(manifestPath, m)
  }

  /* ProGuard / R8 — keep Capacitor + AdMob + Billing classes */
  const proguard = path.join(root, 'app', 'proguard-rules.pro')
  if (fs.existsSync(proguard)) {
    let p = fs.readFileSync(proguard, 'utf8')
    const rules = [
      '-keep class com.getcapacitor.** { *; }',
      '-keep class com.google.android.gms.ads.** { *; }',
      '-keep class com.android.billingclient.** { *; }',
      '-keepclassmembers class * { @com.getcapacitor.PluginMethod *; }',
    ]
    let changed = false
    for (const r of rules) {
      if (!p.includes(r)) {
        p += (p.endsWith('\n') ? '' : '\n') + r + '\n'
        changed = true
      }
    }
    if (changed) {
      fs.writeFileSync(proguard, p)
      log('Appended Capacitor / AdMob / Billing keep rules to proguard-rules.pro')
    }
  }
}

/* ---------- Validation: clear errors instead of broken builds ---------- */
const validationErrors = []
const validationWarns = []

function exists(p) {
  return fs.existsSync(p)
}

if (!exists(pkgPath)) validationErrors.push('package.json missing in PROJECT_DIR')
if (!exists(capJsonPath) && !exists(capTsPath))
  validationErrors.push('capacitor.config.{ts,json} missing after override pass')
if (process.env.REQUIRE_ANDROID === 'true' && !exists(androidDir)) {
  validationErrors.push(
    'android/ directory missing — run `npx cap add android` before validation or remove REQUIRE_ANDROID=true',
  )
}
const manifestFile = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml')
if (exists(manifestFile)) {
  const m = fs.readFileSync(manifestFile, 'utf8')
  const hasAdIdPermission = m.includes('com.google.android.gms.permission.AD_ID') && !/com\.google\.android\.gms\.permission\.AD_ID["'][^>]*tools:node=["']remove["']/.test(m)
  if (!hasAdIdPermission)
    validationErrors.push('AndroidManifest.xml must contain a positive com.google.android.gms.permission.AD_ID declaration for Play Console policy compliance')

  if (ADMOB_APP_ID && !m.includes(ADMOB_APP_ID))
    validationErrors.push('AndroidManifest.xml is missing the AdMob APPLICATION_ID after patching')
}
if (exists(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  for (const required of ['@capacitor/core', '@capacitor/android', '@capacitor/cli']) {
    if (!deps[required]) validationErrors.push(`Required dep missing in package.json: ${required}`)
  }
  if (ADMOB_APP_ID && !deps['@capacitor-community/admob']) {
    validationErrors.push(
      'ADMOB_APP_ID was provided but @capacitor-community/admob is not in dependencies',
    )
  }
}

// ----- AdMob-specific validation (only when AdMob is configured) -----
if (ADMOB_APP_ID) {
  const webDir = (() => {
    if (exists(capJsonPath)) {
      try { return JSON.parse(fs.readFileSync(capJsonPath, 'utf8')).webDir || detectWebDir() }
      catch { return detectWebDir() }
    }
    return detectWebDir()
  })()
  const webRoot = path.join(PROJECT_DIR, webDir)
  const indexHtml = path.join(webRoot, 'index.html')
  if (exists(indexHtml)) {
    const html = fs.readFileSync(indexHtml, 'utf8')
    if (!html.includes('capacitor-bootstrap/admob.js'))
      validationErrors.push('AdMob JS bridge (capacitor-bootstrap/admob.js) not injected into webDir/index.html')
    if (!html.includes('capacitor-bootstrap/admob-init.js'))
      validationErrors.push('AdMob init script (capacitor-bootstrap/admob-init.js) not injected into webDir/index.html')
  } else {
    validationWarns.push(`webDir/index.html missing — cannot verify AdMob bridge injection (looked at ${indexHtml})`)
  }
  if (exists(path.join(webRoot, 'capacitor-bootstrap'))) {
    if (!exists(path.join(webRoot, 'capacitor-bootstrap', 'admob.js')))
      validationErrors.push('capacitor-bootstrap/admob.js missing in webDir — AdMob JS bridge will not load.')
    if (!exists(path.join(webRoot, 'capacitor-bootstrap', 'admob-init.js')))
      validationErrors.push('capacitor-bootstrap/admob-init.js missing in webDir.')
  }
  // capacitor.plugins.json is created by `cap sync` and lists registered native plugins.
  const capPluginsJson = path.join(androidDir, 'app', 'src', 'main', 'assets', 'capacitor.plugins.json')
  if (exists(capPluginsJson)) {
    try {
      const list = JSON.parse(fs.readFileSync(capPluginsJson, 'utf8'))
      const hasAdMob = list.some((p) => (p.pkg || p.id || '').includes('@capacitor-community/admob'))
      if (!hasAdMob)
        validationErrors.push('AdMob plugin is not registered in capacitor.plugins.json — run `npx cap sync android` after installing @capacitor-community/admob.')
    } catch (e) {
      validationWarns.push('capacitor.plugins.json unreadable: ' + e.message)
    }
  } else if (process.env.REQUIRE_ANDROID === 'true') {
    validationErrors.push('capacitor.plugins.json missing — `npx cap sync android` has not been run yet.')
  }
  // Gradle dependency check (play-services-ads pulled by the plugin, but verify after patch).
  const appGradle = path.join(androidDir, 'app', 'build.gradle')
  if (exists(appGradle)) {
    const g = fs.readFileSync(appGradle, 'utf8')
    if (!/play-services-ads/.test(g) && !/capacitor-community[\s\S]*admob/i.test(g)) {
      validationWarns.push('app/build.gradle has no explicit play-services-ads dependency; relying on plugin transitive dep.')
    }
  }
  // capacitor.config.json must carry the AdMob plugin block so cap sync wires it up.
  if (exists(capJsonPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(capJsonPath, 'utf8'))
      const cfgId = cfg && cfg.plugins && cfg.plugins.AdMob && cfg.plugins.AdMob.appId
      if (cfgId !== ADMOB_APP_ID)
        validationErrors.push(`capacitor.config.json plugins.AdMob.appId (${cfgId || 'missing'}) does not match ADMOB_APP_ID (${ADMOB_APP_ID}).`)
    } catch (e) {
      validationErrors.push('capacitor.config.json unreadable: ' + e.message)
    }
  }
}


if (validationErrors.length) {
  console.error('\n[apply-overrides] ❌ Pre-build validation failed:')
  for (const e of validationErrors) console.error('  - ' + e)
  if (validationWarns.length) {
    console.error('[apply-overrides] warnings:')
    for (const w of validationWarns) console.error('  - ' + w)
  }
  if (STRICT_VALIDATION) process.exit(2)
  else console.error('[apply-overrides] Continuing anyway (STRICT_VALIDATION not set).')
} else {
  log(`Validation OK — plugins bundled: ${[...installedPlugins].sort().join(', ') || '(core only)'}`)
}

log('Done.')
