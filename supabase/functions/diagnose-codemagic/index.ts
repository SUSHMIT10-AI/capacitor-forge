const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const token = Deno.env.get('CODEMAGIC_API_TOKEN')
  const appId = Deno.env.get('CODEMAGIC_APP_ID')
  if (!token) {
    return json({ error: 'CODEMAGIC_API_TOKEN not set' }, 500)
  }

  // If a build_id is supplied, fetch that build's status + failed steps.
  let buildId: string | null = null
  try {
    const body = await req.clone().json().catch(() => ({}))
    buildId = (body?.build_id ?? body?.buildId ?? null) as string | null
    const url = new URL(req.url)
    buildId = buildId ?? url.searchParams.get('build_id')
  } catch (_) { /* noop */ }

  if (buildId) {
    const bRes = await fetch(`https://api.codemagic.io/builds/${buildId}`, {
      headers: { 'x-auth-token': token },
    })
    const bJson: any = await bRes.json().catch(() => ({}))
    const build = bJson?.build ?? bJson
    const steps = (build?.buildActions ?? build?.actions ?? []) as any[]
    const failedSteps = steps.filter((s: any) => /fail|error/i.test(String(s?.status ?? '')))
    const failed = failedSteps[0]
    const sub = failed?.subactions?.find((s: any) => s?.logUrl) ?? failed?.subactions?.[0]
    let logTail: string | null = null
    let logRootCause: string | null = null
    if (sub?.logUrl) {
      const r = await fetch(sub.logUrl, { headers: { 'x-auth-token': token } })
      const txt = await r.text()
      logTail = txt.length > 60000 ? txt.slice(-60000) : txt
      logRootCause = explainKnownFailure(extractRootCause(txt))
    }

    const actionSummary = steps.map((s: any) => ({
      name: s?.name ?? s?.actionName ?? null,
      status: s?.status ?? null,
      subactions: (s?.subactions ?? []).map((sub: any) => ({
        name: sub?.name ?? sub?.actionName ?? null,
        status: sub?.status ?? null,
        has_log: !!sub?.logUrl,
      })),
    }))

    const interestingLogs: Record<string, string> = {}
    for (const action of steps) {
      const name = String(action?.name ?? action?.actionName ?? '')
      const shouldRead = /sdk|gradle|bundle|aab|artifact|validate|build android/i.test(name)
      if (!shouldRead && !/fail|error/i.test(String(action?.status ?? ''))) continue
      const actionSub = (action?.subactions ?? []).find((s: any) => s?.logUrl) ?? action
      if (!actionSub?.logUrl) continue
      const r = await fetch(actionSub.logUrl, { headers: { 'x-auth-token': token } })
      const txt = await r.text()
      const rootCause = explainKnownFailure(extractRootCause(txt))
      interestingLogs[name || `action_${Object.keys(interestingLogs).length + 1}`] = rootCause ?? (txt.length > 60000 ? txt.slice(-60000) : txt)
    }

    const artifacts = (build?.artefacts ?? build?.artifacts ?? []).map((a: any) => ({
      name: a?.name ?? a?.file ?? null,
      type: a?.type ?? null,
      size: a?.size ?? null,
    }))

    return json({
      build_id: buildId,
      status: build?.status,
      message: build?.message,
      workflow_id: build?.workflowId ?? build?.workflow?._id ?? build?.workflow?.id ?? null,
      branch: build?.branch ?? null,
      commit: build?.commit?.hash ?? build?.commitHash ?? null,
      actions: actionSummary,
      artifacts,
      failed_step: failed?.name,
      log_root_cause: logRootCause,
      log_tail: logTail,
      interesting_logs: interestingLogs,
    }, 200)
  }

  const result: Record<string, unknown> = {
    configured_app_id: appId ?? null,
  }

  // 1. List all apps the token can access
  const appsRes = await fetch('https://api.codemagic.io/apps', {
    headers: { 'x-auth-token': token },
  })
  const appsJson = await appsRes.json().catch(() => ({}))
  result.list_apps_status = appsRes.status
  if (!appsRes.ok) {
    result.list_apps_error = appsJson
    return json(result, 200)
  }

  const apps = (appsJson.applications ?? appsJson ?? []) as any[]
  result.accessible_apps = apps.map((a: any) => ({
    _id: a._id,
    appName: a.appName,
    repo: a.repository?.htmlUrl ?? a.repository?.url ?? null,
    workflows: a.workflows ? Object.keys(a.workflows) : [],
  }))
  // 2. Try fetching the specific configured app
  if (appId) {
    const oneRes = await fetch(`https://api.codemagic.io/apps/${appId}`, {
      headers: { 'x-auth-token': token },
    })
    const oneJson = await oneRes.json().catch(() => ({}))
    result.configured_app_status = oneRes.status
    if (!oneRes.ok) {
      result.configured_app_error = oneJson
    } else {
      result.configured_app_summary = {
        _id: oneJson._id,
        appName: oneJson.appName,
        repo: oneJson.repository?.htmlUrl ?? oneJson.repository?.url ?? null,
        workflows: oneJson.workflows ? Object.keys(oneJson.workflows) : [],
      }
    }
  }

  return json(result, 200)
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractRootCause(log: string): string | null {
  const markers = [
    'FAILURE: Build failed with an exception.',
    '* What went wrong:',
    'Execution failed for task',
    'A failure occurred while executing',
    'Duplicate class',
    'Manifest merger failed',
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
  const start = Math.max(0, first.index - 1200)
  const end = Math.min(log.length, first.index + 24000)
  return log.slice(start, end)
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
      'Codemagic is still using an older codemagic.yaml where the Force Android SDK compatibility step referenced variables before defining it. The current builder file fixes this by defining android/variables.gradle before the 16 KB SDK patch runs.',
      detail,
    ].join('\n\n')
  }
  return detail
}
