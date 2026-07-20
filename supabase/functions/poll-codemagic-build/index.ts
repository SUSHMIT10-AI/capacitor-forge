import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { unzipSync } from 'https://esm.sh/fflate@0.8.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CODEMAGIC_API = 'https://api.codemagic.io'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No authorization header' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!
    const cmToken = Deno.env.get('CODEMAGIC_API_TOKEN')!
    const cmAppId = Deno.env.get('CODEMAGIC_APP_ID')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { build_id } = await req.json()
    if (!build_id) return json({ error: 'build_id required' }, 400)

    const { data: build } = await supabase
      .from('build_configs')
      .select('*')
      .eq('id', build_id)
      .eq('user_id', user.id)
      .single()
    if (!build) return json({ error: 'Build not found' }, 404)

    const canRecoverFailedBuild = build.status === 'failed' && !build.output_aab_path && !build.output_apk_path
    if (build.status === 'complete' || (build.status === 'failed' && !canRecoverFailedBuild)) {
      return json({ status: build.status, build })
    }

    const marker = build.error_message ?? ''
    let codemagicBuildId = build.codemagic_build_id ?? ''
    if (!codemagicBuildId && marker.startsWith('cm:')) {
      codemagicBuildId = marker.slice(3)
    }
    if (!codemagicBuildId && cmAppId) {
      codemagicBuildId = await findCodemagicBuildId(cmToken, cmAppId, build_id)
      if (codemagicBuildId) {
        await supabase
          .from('build_configs')
          .update({ codemagic_build_id: codemagicBuildId, error_message: null })
          .eq('id', build_id)
      }
    }
    if (!codemagicBuildId) {
      return json({ status: build.status, message: 'No Codemagic build id yet' })
    }

    // Poll Codemagic
    const cmRes = await fetch(`${CODEMAGIC_API}/builds/${codemagicBuildId}`, {
      headers: { 'x-auth-token': cmToken },
    })
    const cmJson = await cmRes.json()
    if (!cmRes.ok) {
      return json({ error: `Codemagic poll failed: ${JSON.stringify(cmJson)}` }, 502)
    }

    const cmBuild = cmJson.build ?? cmJson
    const status: string = cmBuild.status ?? 'unknown'
    // Codemagic statuses: queued, preparing, fetching, testing, building, publishing, finished, failed, canceled, skipped, timeout

    if (status === 'finished') {
      const buildType: string = build.build_type ?? 'aab'
      const artifacts: any[] = cmBuild.artefacts ?? cmBuild.artifacts ?? []
      const aab = artifacts.find((a) => {
        const name = (a.name ?? a.file ?? '').toLowerCase()
        return name.endsWith('.aab') || a.type === 'aab'
      })
      const apk = artifacts.find((a) => {
        const name = (a.name ?? a.file ?? '').toLowerCase()
        return name.endsWith('.apk') || a.type === 'apk'
      })

      const needsAab = buildType === 'aab' || buildType === 'both'
      const needsApk = buildType === 'apk' || buildType === 'both'
      const missingArtifacts: string[] = []

      if (needsAab && !aab) missingArtifacts.push('AAB')
      if (needsApk && !apk) missingArtifacts.push('APK')

      if (!aab && !apk) {
        await supabase
          .from('build_configs')
          .update({
            status: 'failed',
            error_message: `Build finished but no downloadable Android artifacts were found. Found: ${JSON.stringify(artifacts.map((a: any) => a.name ?? a.file ?? a.type))}`,
          })
          .eq('id', build_id)
        return json({ status: 'failed', error: 'No Android artifacts found' })
      }

      const safeName = build.app_name.replace(/[^A-Za-z0-9_-]/g, '_')
      const safePackage = build.package_name.replace(/[^A-Za-z0-9._-]/g, '_')
      let savedAabPath: string | null = null
      let savedApkPath: string | null = null

      if (aab) {
        const aabPath = `${user.id}/${build_id}/${safeName}_${safePackage}.aab`
        const aabUrl = aab.url ?? aab.downloadUrl
        const aabBlob = await downloadArtifact(aabUrl, cmToken)
        const aabPackageName = getAabPackageName(aabBlob)
        if (aabPackageName !== build.package_name) {
          const msg = `Generated AAB package name is ${aabPackageName ?? 'unknown'}, expected ${build.package_name}. Re-run the build after the latest package-name workflow is used.`
          await supabase
            .from('build_configs')
            .update({ status: 'failed', error_message: msg })
            .eq('id', build_id)
          return json({ status: 'failed', error: msg })
        }
        const targetSdk = getAabTargetSdk(aabBlob)
        if (targetSdk !== '35') {
          const msg = `Generated AAB targets API ${targetSdk ?? 'unknown'}, not 35. The CI source is stale; do not upload this AAB to Play Console. Re-run after Codemagic picks up the latest SDK 35 workflow.`
          await supabase
            .from('build_configs')
            .update({ status: 'failed', error_message: msg })
            .eq('id', build_id)
          return json({ status: 'failed', error: msg })
        }
        await supabase.storage.from('build-outputs').upload(aabPath, aabBlob, {
          contentType: 'application/octet-stream',
          upsert: true,
        })
        savedAabPath = aabPath
      }

      if (apk) {
        try {
          const apkPath = `${user.id}/${build_id}/${safeName}_${safePackage}.apk`
          const apkUrl = apk.url ?? apk.downloadUrl
          const apkBlob = await downloadArtifact(apkUrl, cmToken)
          await supabase.storage.from('build-outputs').upload(apkPath, apkBlob, {
            contentType: 'application/vnd.android.package-archive',
            upsert: true,
          })
          savedApkPath = apkPath
        } catch (e) {
          console.warn('APK download failed:', e)
          if (needsApk) {
            await supabase
              .from('build_configs')
              .update({ status: 'failed', error_message: `APK download failed: ${(e as Error).message}` })
              .eq('id', build_id)
            return json({ status: 'failed', error: 'APK download failed' })
          }
        }
      }

      const completionMessage = missingArtifacts.length
        ? `Build completed, but Codemagic did not provide: ${missingArtifacts.join(', ')}.`
        : null

      await supabase
        .from('build_configs')
        .update({
          status: 'complete',
          output_aab_path: savedAabPath,
          output_apk_path: savedApkPath,
          error_message: completionMessage,
        })
        .eq('id', build_id)

      return json({ status: 'complete', aab_path: savedAabPath, apk_path: savedApkPath, warning: completionMessage })
    }

    if (['failed', 'canceled', 'timeout', 'skipped'].includes(status)) {
      const rootCause = await getFailedBuildDetail(cmBuild, cmToken)
      const detail = explainKnownFailure(rootCause)
        ?? (typeof cmBuild.message === 'string' && cmBuild.message.trim()
          ? cmBuild.message.trim()
          : `Codemagic build ${status}. Check the build logs for details.`)
      await supabase
        .from('build_configs')
        .update({
          status: 'failed',
          error_message: detail,
        })
        .eq('id', build_id)
      return json({ status: 'failed', codemagic_status: status, error: detail })
    }

    // Still in progress
    return json({ status: 'building', codemagic_status: status })
  } catch (error) {
    console.error('Poll error:', error)
    return json({ error: (error as Error).message ?? 'Poll failed' }, 500)
  }
})

async function downloadArtifact(url: string, token: string): Promise<Uint8Array> {
  const artifactUrl = url.startsWith('http') ? url : `${CODEMAGIC_API}${url}`
  const res = await fetch(artifactUrl, {
    headers: { 'x-auth-token': token },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Artifact download failed (${res.status}): ${url}`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

async function findCodemagicBuildId(token: string, appId: string, buildId: string): Promise<string> {
  const res = await fetch(`${CODEMAGIC_API}/builds?appId=${encodeURIComponent(appId)}`, {
    headers: { 'x-auth-token': token },
  })
  if (!res.ok) return ''

  const json = await res.json().catch(() => null)
  const builds = Array.isArray(json) ? json : json?.builds ?? []
  const match = builds.find((item: any) => item?.dynamicConfig?.environment?.variables?.BUILD_ID === buildId)
  return match?._id ?? ''
}

async function getFailedBuildDetail(cmBuild: any, token: string): Promise<string | null> {
  const steps = (cmBuild?.buildActions ?? cmBuild?.actions ?? []) as any[]
  const failed = steps.find((s: any) => /fail|error/i.test(String(s?.status ?? '')))
  const sub = failed?.subactions?.find((s: any) => s?.logUrl) ?? failed?.subactions?.[0] ?? failed
  if (!sub?.logUrl) return null

  try {
    const res = await fetch(sub.logUrl, { headers: { 'x-auth-token': token } })
    if (!res.ok) return null
    const text = await res.text()
    const rootCause = extractRootCause(text)
    if (rootCause) return rootCause
  } catch (error) {
    console.warn('Failed to fetch Codemagic failure log:', error)
  }

  return null
}

function extractRootCause(log: string): string | null {
  const markers = [
    'FAILURE: Build failed with an exception.',
    '* What went wrong:',
    'Execution failed for task',
    'Manifest merger failed',
    'Duplicate class',
    'Could not resolve all files',
    'Could not find',
    'Traceback (most recent call last):',
    'NameError:',
  ]
  const first = markers
    .map((marker) => ({ marker, index: log.indexOf(marker) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0]

  if (!first) return null
  const snippet = log.slice(first.index, Math.min(log.length, first.index + 2500))
  return snippet
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function explainKnownFailure(detail: string | null): string | null {
  if (!detail) return null
  const normalized = detail.toLowerCase()
  if (
    normalized.includes('while scanning a simple key') &&
    (normalized.includes('lovable_16kb_jnilibs') || normalized.includes('packaging {') || normalized.includes('packagingoptions {'))
  ) {
    return [
      'Codemagic is still using an older malformed codemagic.yaml from the connected repository. The current builder file is fixed, but the repository branch used by Codemagic must contain the latest codemagic.yaml before starting another build.',
      detail,
    ].join('\n\n')
  }
  if (normalized.includes("nameerror: name 'variables' is not defined")) {
    return [
      'Codemagic is still using an older codemagic.yaml where the Force Android SDK compatibility step referenced variables before defining it. The builder file now defines android/variables.gradle before use; wait for the connected repository to sync the latest codemagic.yaml, then start the build again.',
      detail,
    ].join('\n\n')
  }
  return detail
}

function getAabTargetSdk(aab: Uint8Array): string | null {
  try {
    const files = unzipSync(aab)
    const manifest = files['base/manifest/AndroidManifest.xml']
    if (!manifest) return null
    const text = new TextDecoder('utf-8', { fatal: false }).decode(manifest)
    const match = text.match(/targetSdkVersion[\s\S]{0,32}?\x1a\x02(\d{2})/)
    return match?.[1] ?? null
  } catch (error) {
    console.warn('AAB target SDK validation failed:', error)
    return null
  }
}

function getAabPackageName(aab: Uint8Array): string | null {
  try {
    const files = unzipSync(aab)
    const manifest = files['base/manifest/AndroidManifest.xml']
    if (!manifest) return null
    const text = new TextDecoder('utf-8', { fatal: false }).decode(manifest)
    const match = text.match(/package[\s\S]{0,80}?([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)/)
    return match?.[1] ?? null
  } catch (error) {
    console.warn('AAB package-name validation failed:', error)
    return null
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
