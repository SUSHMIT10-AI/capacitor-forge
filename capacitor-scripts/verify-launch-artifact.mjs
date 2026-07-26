#!/usr/bin/env node
/*
 * Verifies that a produced APK/AAB can resolve its launcher Activity.
 * This catches the common "opens then returns to home screen" failure where
 * the manifest points at a class that is not packaged in dex.
 *
 * Env:
 *   EXPECTED_PACKAGE - optional expected applicationId/package name
 *   ANDROID_SDK_ROOT - used to locate aapt2 for APK badging
 *   BUNDLETOOL_JAR   - optional path to bundletool-all.jar for AAB manifest dump
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const artifacts = process.argv.slice(2).filter(Boolean)
if (artifacts.length === 0) {
  console.error('[verify-launch] No APK/AAB artifacts supplied')
  process.exit(2)
}

const expectedPackage = (process.env.EXPECTED_PACKAGE || process.env.PACKAGE_NAME || '').trim()
const errors = []

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

function latestBuildToolsBin(name) {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || ''
  if (!sdk) return ''
  const dir = path.join(sdk, 'build-tools')
  if (!fs.existsSync(dir)) return ''
  const versions = fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  for (const version of versions.reverse()) {
    const candidate = path.join(dir, version, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}

function getBundletoolJar() {
  const envJar = process.env.BUNDLETOOL_JAR || '/tmp/bundletool.jar'
  if (fs.existsSync(envJar)) return envJar
  throw new Error('bundletool jar is required for AAB launch verification. Download it to /tmp/bundletool.jar first.')
}

function parseManifestXml(xml) {
  const pkg = xml.match(/\bpackage="([^"]+)"/)?.[1] || ''
  const activities = [...xml.matchAll(/<activity\b[\s\S]*?<\/activity>/g)].map((match) => match[0])
  const launcher = activities.find((block) => block.includes('android.intent.action.MAIN') && block.includes('android.intent.category.LAUNCHER')) || ''
  const launcherName = launcher.match(/android:name="([^"]+)"/)?.[1] || ''
  return { pkg, launcherName }
}

function normalizeActivityName(pkg, launcherName) {
  if (!launcherName) return ''
  if (launcherName.startsWith('.')) return `${pkg}${launcherName}`
  if (!launcherName.includes('.')) return `${pkg}.${launcherName}`
  return launcherName
}

function dexClassPath(fqcn) {
  return `L${fqcn.replace(/\./g, '/')};`
}

function listZipEntries(file) {
  return run('unzip', ['-Z1', file])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function classExistsInDex(file, dexEntries, fqcn) {
  const needle = dexClassPath(fqcn)
  for (const entry of dexEntries) {
    const out = run('unzip', ['-p', file, entry], { maxBuffer: 128 * 1024 * 1024 })
    if (out.includes(needle)) return true
  }
  return false
}

function verifyAab(file) {
  const jar = getBundletoolJar()
  const manifest = run('java', ['-jar', jar, 'dump', 'manifest', '--bundle', file], { maxBuffer: 8 * 1024 * 1024 })
  const { pkg, launcherName } = parseManifestXml(manifest)
  const launcherFqcn = normalizeActivityName(pkg, launcherName)
  const entries = listZipEntries(file)
  const dexEntries = entries.filter((entry) => /^base\/dex\/classes.*\.dex$/.test(entry))

  if (!pkg) errors.push(`${file}: manifest package is missing`)
  if (expectedPackage && pkg && pkg !== expectedPackage) errors.push(`${file}: package is ${pkg}, expected ${expectedPackage}`)
  if (!launcherName) errors.push(`${file}: launcher activity is missing android:name`)
  if (!launcherFqcn) errors.push(`${file}: launcher activity could not be resolved`)
  if (launcherName && launcherName !== launcherFqcn) {
    errors.push(`${file}: launcher activity must be fully-qualified (${launcherFqcn}), found ${launcherName}`)
  }
  if (dexEntries.length === 0) errors.push(`${file}: no base dex files found`)
  if (launcherFqcn && dexEntries.length > 0 && !classExistsInDex(file, dexEntries, launcherFqcn)) {
    errors.push(`${file}: launcher Activity ${launcherFqcn} is not present in packaged dex; this AAB will close immediately on open`)
  }
  console.log(`[verify-launch] AAB package=${pkg || '?'} launcher=${launcherFqcn || '?'} dexFiles=${dexEntries.length}`)
}

function verifyApk(file) {
  const aapt2 = latestBuildToolsBin('aapt2')
  if (!aapt2) throw new Error('aapt2 not found under ANDROID_SDK_ROOT; cannot inspect APK')
  const badging = run(aapt2, ['dump', 'badging', file], { maxBuffer: 8 * 1024 * 1024 })
  const pkg = badging.match(/package: name='([^']+)'/)?.[1] || ''
  const launcherName = badging.match(/launchable-activity: name='([^']+)'/)?.[1] || ''
  const launcherFqcn = normalizeActivityName(pkg, launcherName)
  const entries = listZipEntries(file)
  const dexEntries = entries.filter((entry) => /^classes.*\.dex$/.test(entry))

  if (!pkg) errors.push(`${file}: APK package is missing`)
  if (expectedPackage && pkg && pkg !== expectedPackage) errors.push(`${file}: package is ${pkg}, expected ${expectedPackage}`)
  if (!launcherName) errors.push(`${file}: launchable activity is missing`)
  if (launcherName && launcherName !== launcherFqcn) {
    errors.push(`${file}: launcher activity must be fully-qualified (${launcherFqcn}), found ${launcherName}`)
  }
  if (dexEntries.length === 0) errors.push(`${file}: no dex files found`)
  if (launcherFqcn && dexEntries.length > 0 && !classExistsInDex(file, dexEntries, launcherFqcn)) {
    errors.push(`${file}: launcher Activity ${launcherFqcn} is not present in packaged dex; this APK will close immediately on open`)
  }
  console.log(`[verify-launch] APK package=${pkg || '?'} launcher=${launcherFqcn || '?'} dexFiles=${dexEntries.length}`)
}

for (const artifact of artifacts) {
  try {
    if (!fs.existsSync(artifact)) {
      errors.push(`${artifact}: file does not exist`)
      continue
    }
    if (artifact.endsWith('.aab')) verifyAab(artifact)
    else if (artifact.endsWith('.apk')) verifyApk(artifact)
    else errors.push(`${artifact}: unsupported artifact type`)
  } catch (error) {
    errors.push(`${artifact}: ${error.message}`)
  }
}

if (errors.length) {
  console.error('\n[verify-launch] ❌ Launch verification failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('[verify-launch] ✅ Launcher activity resolves to a packaged dex class.')