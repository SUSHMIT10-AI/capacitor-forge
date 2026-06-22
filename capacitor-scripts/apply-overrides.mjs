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
const ENABLE_BILLING = (process.env.ENABLE_BILLING || '').toLowerCase() === 'true'
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

const log = (...a) => console.log('[apply-overrides]', ...a)
const warn = (...a) => console.warn('[apply-overrides][warn]', ...a)

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
      appId: ADMOB_APP_ID,
      initializeForTesting: false,
      ...(cfg.plugins.AdMob || {}),
    }
  }
  cfg.plugins.SplashScreen = {
    launchShowDuration: 1500,
    launchAutoHide: true,
    backgroundColor: '#ffffff',
    ...(cfg.plugins.SplashScreen || {}),
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

  const ensureDep = (name, version, dev = false) => {
    if (pkg.dependencies[name] || pkg.devDependencies[name]) {
      installedPlugins.add(name)
      return
    }
    ;(dev ? pkg.devDependencies : pkg.dependencies)[name] = version
    installedPlugins.add(name)
    log(`Added ${dev ? 'devDependency' : 'dependency'} ${name}@${version}`)
  }

  // Always wire core
  ensureDep('@capacitor/core', '^6.1.2')
  ensureDep('@capacitor/android', '^6.1.2')
  ensureDep('@capacitor/cli', '^6.1.2', true)

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
  let html = fs.readFileSync(indexHtml, 'utf8')
  const tag = `<script src="capacitor-bootstrap/admob-init.js" defer></script>`
  if (!html.includes('capacitor-bootstrap/admob-init.js')) {
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `  ${tag}\n  </body>`)
    else html += `\n${tag}\n`
    fs.writeFileSync(indexHtml, html)
    log('Injected AdMob bootstrap script into webDir/index.html')
  }
}
injectAdMobBootstrap()

/* ---------- android/ overrides ---------- */
const androidDir = path.join(PROJECT_DIR, 'android')
if (fs.existsSync(androidDir)) {
  patchAndroid(androidDir)
} else {
  log('No android/ directory present yet; overrides will re-apply after `cap add android`.')
}

export function patchAndroid(root) {
  /* gradle.properties — AndroidX, Jetifier, MultiDex */
  const gradleProps = path.join(root, 'gradle.properties')
  const requiredProps = {
    'android.useAndroidX': 'true',
    'android.enableJetifier': 'true',
    'org.gradle.jvmargs': '-Xmx2048m -Dfile.encoding=UTF-8',
    'android.nonTransitiveRClass': 'true',
  }
  let props = fs.existsSync(gradleProps) ? fs.readFileSync(gradleProps, 'utf8') : ''
  for (const [k, v] of Object.entries(requiredProps)) {
    const re = new RegExp(`^${k.replace(/\./g, '\\.')}=.*$`, 'm')
    if (re.test(props)) props = props.replace(re, `${k}=${v}`)
    else props += `${props.endsWith('\n') || props === '' ? '' : '\n'}${k}=${v}\n`
  }
  fs.writeFileSync(gradleProps, props)
  log('Ensured AndroidX / Jetifier / nonTransitiveRClass in gradle.properties')

  /* app/build.gradle — applicationId/version, MultiDex, Google Services, Kotlin */
  const buildGradle = path.join(root, 'app', 'build.gradle')
  if (fs.existsSync(buildGradle)) {
    let g = fs.readFileSync(buildGradle, 'utf8')
    g = g.replace(/applicationId\s+["'][^"']+["']/, `applicationId "${APP_ID}"`)
    g = g.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`)
    g = g.replace(/versionName\s+["'][^"']+["']/, `versionName "${VERSION_NAME}"`)
    // MultiDex
    if (!/multiDexEnabled\s+true/.test(g)) {
      g = g.replace(/defaultConfig\s*\{/, (m) => `${m}\n        multiDexEnabled true`)
    }
    if (!/androidx\.multidex:multidex/.test(g)) {
      g = g.replace(/dependencies\s*\{/, (m) => `${m}\n    implementation 'androidx.multidex:multidex:2.0.1'`)
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
    fs.writeFileSync(buildGradle, g)
    log(
      `Patched app/build.gradle (applicationId=${APP_ID} versionCode=${VERSION_CODE} versionName=${VERSION_NAME})`,
    )
  }

  /* Root build.gradle — Google Services classpath if needed */
  const rootGradle = path.join(root, 'build.gradle')
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
    const ensurePerm = (perm) => {
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

    if (ADMOB_APP_ID) {
      const adMeta = `        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ADMOB_APP_ID}" />`
      if (/com\.google\.android\.gms\.ads\.APPLICATION_ID/.test(m)) {
        m = m.replace(
          /<meta-data\s+android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[^/]*\/>/,
          `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ADMOB_APP_ID}" />`,
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
if (ADMOB_APP_ID && exists(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'))) {
  const m = fs.readFileSync(
    path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
  )
  if (!m.includes(ADMOB_APP_ID))
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
