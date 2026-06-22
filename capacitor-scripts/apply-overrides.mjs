#!/usr/bin/env node
/*
 * Patches the user's uploaded Capacitor project with build-form overrides
 * BEFORE `npx cap sync android` runs. Operates on:
 *   - capacitor.config.{ts,json}: appId, appName, optional server.url
 *   - package.json: name, version
 *   - android/app/build.gradle: applicationId, versionCode, versionName
 *   - android/app/src/main/AndroidManifest.xml: AdMob meta-data, INTERNET perm
 *   - android/app/src/main/res/values/strings.xml: app_name
 *
 * Env:
 *   PROJECT_DIR      - absolute path to the unzipped Capacitor project root
 *   APP_ID           - Android applicationId / Capacitor appId (e.g. com.example.app)
 *   APP_NAME         - App display name
 *   VERSION_NAME     - Semver like 1.2.3
 *   VERSION_CODE     - Integer Play version code
 *   ADMOB_APP_ID     - Optional ca-app-pub-...~... id; injected as meta-data
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

if (!APP_ID || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(APP_ID)) {
  console.error(`Invalid APP_ID: ${APP_ID}`)
  process.exit(1)
}

const log = (...a) => console.log('[apply-overrides]', ...a)

/* ---------- capacitor.config.{ts,json} ---------- */
const capJsonPath = path.join(PROJECT_DIR, 'capacitor.config.json')
const capTsPath = path.join(PROJECT_DIR, 'capacitor.config.ts')
if (fs.existsSync(capJsonPath)) {
  const cfg = JSON.parse(fs.readFileSync(capJsonPath, 'utf8'))
  cfg.appId = APP_ID
  if (APP_NAME) cfg.appName = APP_NAME
  // Force local bundled web assets — strip any hot-reload server.url
  if (cfg.server && typeof cfg.server === 'object') {
    delete cfg.server.url
    if (Object.keys(cfg.server).length === 0) delete cfg.server
  }
  fs.writeFileSync(capJsonPath, JSON.stringify(cfg, null, 2) + '\n')
  log(`Patched capacitor.config.json: appId=${APP_ID} appName=${APP_NAME || '(unchanged)'}`)
} else if (fs.existsSync(capTsPath)) {
  let src = fs.readFileSync(capTsPath, 'utf8')
  src = src.replace(/appId:\s*['"`][^'"`]*['"`]/, `appId: '${APP_ID}'`)
  if (APP_NAME) src = src.replace(/appName:\s*['"`][^'"`]*['"`]/, `appName: '${APP_NAME.replace(/'/g, "\\'")}'`)
  // Best-effort: comment out any server.url for production bundling
  src = src.replace(/url:\s*['"`][^'"`]*['"`]\s*,?/g, '// url: removed by builder,')
  fs.writeFileSync(capTsPath, src)
  log(`Patched capacitor.config.ts: appId=${APP_ID}`)
} else {
  // Create a minimal one
  const cfg = { appId: APP_ID, appName: APP_NAME || 'App', webDir: detectWebDir() }
  fs.writeFileSync(capJsonPath, JSON.stringify(cfg, null, 2) + '\n')
  log(`Created capacitor.config.json with webDir=${cfg.webDir}`)
}

function detectWebDir() {
  for (const d of ['dist', 'www', 'build', 'public']) {
    if (fs.existsSync(path.join(PROJECT_DIR, d, 'index.html'))) return d
  }
  return 'dist'
}

/* ---------- package.json ---------- */
const pkgPath = path.join(PROJECT_DIR, 'package.json')
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.version = VERSION_NAME
  if (!pkg.name) pkg.name = APP_ID.replace(/\./g, '-')
  pkg.dependencies = pkg.dependencies || {}
  pkg.devDependencies = pkg.devDependencies || {}

  // Always make sure Capacitor is wired up — works even if the user uploaded
  // a plain Lovable webapp zip without any Capacitor setup.
  const ensureDep = (name, version, dev = false) => {
    if (pkg.dependencies[name] || pkg.devDependencies[name]) return
    ;(dev ? pkg.devDependencies : pkg.dependencies)[name] = version
    log(`Added ${dev ? 'devDependency' : 'dependency'} ${name}@${version}`)
  }
  ensureDep('@capacitor/core', '^6.1.2')
  ensureDep('@capacitor/android', '^6.1.2')
  ensureDep('@capacitor/cli', '^6.1.2', true)

  // If AdMob is configured, auto-install the AdMob plugin so `cap sync` links
  // the native Google Mobile Ads SDK into the generated AAB.
  if (ADMOB_APP_ID) {
    ensureDep('@capacitor-community/admob', '^6.0.0')
    log('AdMob enabled → @capacitor-community/admob will be bundled natively')
  }

  // If billing is enabled, install a Play Billing plugin so the AAB ships the
  // com.android.billingclient.* classes.
  if ((process.env.ENABLE_BILLING || '').toLowerCase() === 'true') {
    ensureDep('@capgo/capacitor-purchases', '^6.0.0')
    log('Billing enabled → @capgo/capacitor-purchases will be bundled natively')
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  log(`Patched package.json version=${VERSION_NAME}`)
}

/* ---------- android/ overrides (only if android/ exists; otherwise cap add android will regenerate) ---------- */
const androidDir = path.join(PROJECT_DIR, 'android')
if (fs.existsSync(androidDir)) {
  patchAndroid(androidDir)
} else {
  log('No android/ directory present yet; overrides will re-apply after `cap add android`.')
}

export function patchAndroid(root) {
  const buildGradle = path.join(root, 'app', 'build.gradle')
  if (fs.existsSync(buildGradle)) {
    let g = fs.readFileSync(buildGradle, 'utf8')
    g = g.replace(/applicationId\s+["'][^"']+["']/, `applicationId "${APP_ID}"`)
    g = g.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`)
    g = g.replace(/versionName\s+["'][^"']+["']/, `versionName "${VERSION_NAME}"`)
    fs.writeFileSync(buildGradle, g)
    log(`Patched android/app/build.gradle (applicationId=${APP_ID} versionCode=${VERSION_CODE} versionName=${VERSION_NAME})`)
  }

  const stringsPath = path.join(root, 'app', 'src', 'main', 'res', 'values', 'strings.xml')
  if (fs.existsSync(stringsPath) && APP_NAME) {
    let s = fs.readFileSync(stringsPath, 'utf8')
    const escaped = APP_NAME.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    s = s.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${escaped}</string>`)
    s = s.replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${escaped}</string>`)
    fs.writeFileSync(stringsPath, s)
    log(`Patched strings.xml app_name=${APP_NAME}`)
  }

  const manifestPath = path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml')
  if (fs.existsSync(manifestPath)) {
    let m = fs.readFileSync(manifestPath, 'utf8')
    // Ensure INTERNET permission
    if (!/uses-permission[^>]+android\.permission\.INTERNET/.test(m)) {
      m = m.replace(/<manifest([^>]*)>/, `<manifest$1>\n    <uses-permission android:name="android.permission.INTERNET" />`)
    }
    // AdMob app id meta-data (only injects if ADMOB_APP_ID provided)
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
}

log('Done.')
