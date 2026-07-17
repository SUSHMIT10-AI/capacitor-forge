#!/usr/bin/env node
/*
 * Standalone post-`cap sync` validation. Run from CI after
 * `npx cap sync android` to confirm the generated Android project is ready
 * to assemble. Exits non-zero with an explicit message when anything is off,
 * so the build pipeline stops *before* spending minutes on Gradle.
 *
 * Env:
 *   PROJECT_DIR    - absolute path to the Capacitor project root
 *   ADMOB_APP_ID   - optional, validated against AndroidManifest if set
 *   STRICT         - "true" to fail on warnings as well
 */
import fs from 'node:fs'
import path from 'node:path'

const PROJECT_DIR = process.env.PROJECT_DIR
if (!PROJECT_DIR || !fs.existsSync(PROJECT_DIR)) {
  console.error('[validate-build] PROJECT_DIR missing/invalid:', PROJECT_DIR)
  process.exit(1)
}
const ADMOB_APP_ID = (process.env.ADMOB_APP_ID || '').trim()
const STRICT = (process.env.STRICT || '').toLowerCase() === 'true'

const errors = []
const warns = []
const ok = (msg) => console.log('[validate-build] ✓', msg)
const fail = (msg) => errors.push(msg)
const warn = (msg) => warns.push(msg)

const androidDir = path.join(PROJECT_DIR, 'android')
const appDir = path.join(androidDir, 'app')
const manifestPath = path.join(appDir, 'src', 'main', 'AndroidManifest.xml')
const buildGradle = path.join(appDir, 'build.gradle')
const rootBuildGradle = path.join(androidDir, 'build.gradle')
const settingsGradle = path.join(androidDir, 'settings.gradle')
const capConfigJson = path.join(PROJECT_DIR, 'capacitor.config.json')
const capConfigTs = path.join(PROJECT_DIR, 'capacitor.config.ts')
const pkgJson = path.join(PROJECT_DIR, 'package.json')

if (!fs.existsSync(pkgJson)) fail('package.json missing in PROJECT_DIR')
else ok('package.json present')

if (!fs.existsSync(capConfigJson) && !fs.existsSync(capConfigTs))
  fail('capacitor.config.{ts,json} missing — Capacitor project not initialized')
else ok('capacitor config present')

if (!fs.existsSync(androidDir)) {
  fail('android/ directory missing — run `npx cap add android`')
} else {
  ok('android project present')
  if (!fs.existsSync(buildGradle)) fail('android/app/build.gradle missing')
  if (!fs.existsSync(rootBuildGradle)) fail('android/build.gradle missing')
  if (!fs.existsSync(settingsGradle)) fail('android/settings.gradle missing')
  if (!fs.existsSync(manifestPath)) fail('AndroidManifest.xml missing')
  if (!fs.existsSync(path.join(androidDir, 'gradlew')))
    fail('android/gradlew missing — generated project is incomplete')
}

for (const gradleFile of [rootBuildGradle, buildGradle, settingsGradle]) {
  if (!fs.existsSync(gradleFile)) continue
  const contents = fs.readFileSync(gradleFile, 'utf8')
  const label = path.relative(PROJECT_DIR, gradleFile)
  if (/org\.bouncycastle:[^\s'",]+-jdk15on:1\.78\.1/.test(contents)) {
    fail(`${label} requests non-existent Bouncy Castle jdk15on 1.78.1 artifacts`)
  }
  if (/org\.bouncycastle:[^\s'",]+-jdk18on:1\.78\.1/.test(contents)) {
    fail(`${label} pins Bouncy Castle jdk18on 1.78.1, which still contains Java 21 multi-release classes that break Gradle on JDK 17`)
  }
  if (/details\.useVersion ['"]1\.78\.1['"][\s\S]{0,160}Bouncy Castle/.test(contents)) {
    fail(`${label} still forces Bouncy Castle 1.78.1; redirect jdk18on requests to jdk15on 1.70 instead`)
  }
  if (/Redirect legacy jdk15on to jdk18on|name\.replace\('-jdk15on', '-jdk18on'\)/.test(contents)) {
    fail(`${label} contains stale Bouncy Castle jdk15on→jdk18on rewrite; use jdk15on 1.70 instead`)
  }
  if (label === path.join('android', 'app', 'build.gradle')) {
    const compileSdkMatches = [...contents.matchAll(/compileSdk(?:Version)?\s*(?:=|\()?\s*(\d+)/g)]
    const targetSdkMatches = [...contents.matchAll(/targetSdk(?:Version)?\s*(?:=|\()?\s*(\d+)/g)]
    if (!compileSdkMatches.length) fail(`${label} is missing compileSdk; Play-ready builds require compileSdk 35`)
    if (!targetSdkMatches.length) fail(`${label} is missing targetSdk; Play-ready builds require targetSdk 35`)
    for (const match of compileSdkMatches) {
      if (Number(match[1]) !== 35) fail(`${label} has compileSdk ${match[1]}; Play-ready builds require compileSdk 35`)
    }
    for (const match of targetSdkMatches) {
      if (Number(match[1]) !== 35) fail(`${label} has targetSdk ${match[1]}; Play Console requires targetSdk 35`)
    }
    const minSdkMatches = [...contents.matchAll(/minSdk(?:Version)?\s*(?:=|\()?\s*(\d+)/g)]
    if (!minSdkMatches.length) fail(`${label} is missing minSdk; Google Play Services requires minSdk 22`)
    for (const match of minSdkMatches) {
      if (Number(match[1]) < 22) fail(`${label} has minSdk ${match[1]}; Google Play Services now requires minSdk 22`)
    }
  }
  if (label === path.join('android', 'variables.gradle')) {
    for (const [name, expected] of [['compileSdkVersion', 35], ['targetSdkVersion', 35], ['minSdkVersion', 22]]) {
      const re = new RegExp(`${name}\\s*=\\s*(\\d+)`)
      const match = contents.match(re)
      if (match && Number(match[1]) !== expected) fail(`${label} has ${name} ${match[1]}; expected ${expected}`)
    }
  }
}

if (fs.existsSync(rootBuildGradle)) {
  const g = fs.readFileSync(rootBuildGradle, 'utf8')
  if (!/LOVABLE_BOUNCY_CASTLE_JDK17_ALIGN/.test(g)) {
    warn('android/build.gradle has no Bouncy Castle alignment marker — apply-overrides should inject it before assembly')
  }
}

if (fs.existsSync(settingsGradle)) {
  const s = fs.readFileSync(settingsGradle, 'utf8')
  if (!/mavenCentral\(\)[\s\S]*google\(\)/.test(s)) {
    fail('android/settings.gradle must declare mavenCentral() before google() for reliable dependency resolution')
  }
}

if (fs.existsSync(manifestPath)) {
  const m = fs.readFileSync(manifestPath, 'utf8')
  if (!/android\.permission\.INTERNET/.test(m)) fail('AndroidManifest missing INTERNET permission')
  if (!m.includes('com.google.android.gms.permission.AD_ID') || /com\.google\.android\.gms\.permission\.AD_ID["'][^>]*tools:node=["']remove["']/.test(m)) {
    fail('AndroidManifest must contain a positive com.google.android.gms.permission.AD_ID permission for Play Console Android 13+ advertising ID checks')
  }
  if (ADMOB_APP_ID && !m.includes(ADMOB_APP_ID))
    fail(`AndroidManifest missing AdMob APPLICATION_ID (${ADMOB_APP_ID})`)
  const invalidTheme = m.match(/android:theme="(?!(?:@style\/|@android:style\/))[^"]+"/)
  if (invalidTheme) {
    fail(`AndroidManifest has an invalid theme reference: ${invalidTheme[0]}. Theme values must start with @style/.`)
  }
}

if (fs.existsSync(pkgJson)) {
  const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  for (const required of ['@capacitor/core', '@capacitor/android', '@capacitor/cli']) {
    if (!deps[required]) fail(`Required dep missing: ${required}`)
  }
  if (ADMOB_APP_ID && !deps['@capacitor-community/admob'])
    fail('AdMob configured but @capacitor-community/admob is not installed')
}

// Detect that cap sync has actually run — capacitor.plugins.json or similar
const capPluginsJson = path.join(appDir, 'src', 'main', 'assets', 'capacitor.plugins.json')
if (fs.existsSync(capPluginsJson)) {
  try {
    const list = JSON.parse(fs.readFileSync(capPluginsJson, 'utf8'))
    ok(`capacitor.plugins.json found with ${list.length} plugin(s) registered`)
  } catch (e) {
    warn('capacitor.plugins.json is unreadable: ' + e.message)
  }
} else {
  warn('capacitor.plugins.json not present — run `npx cap sync android` before validation')
}

if (errors.length) {
  console.error('\n[validate-build] ❌ Build validation failed:')
  for (const e of errors) console.error('  - ' + e)
  if (warns.length) {
    console.error('[validate-build] warnings:')
    for (const w of warns) console.error('  - ' + w)
  }
  console.error('\nFix the items above before re-running the AAB/APK assembly.')
  process.exit(2)
}
if (warns.length) {
  console.warn('[validate-build] warnings:')
  for (const w of warns) console.warn('  - ' + w)
  if (STRICT) process.exit(3)
}
console.log('[validate-build] ✅ All checks passed; safe to assemble AAB/APK.')
