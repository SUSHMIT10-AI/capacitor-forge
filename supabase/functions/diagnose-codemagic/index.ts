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
    if (sub?.logUrl) {
      const r = await fetch(sub.logUrl, { headers: { 'x-auth-token': token } })
      const txt = await r.text()
      logTail = txt.length > 16000 ? txt.slice(-16000) : txt
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
      interestingLogs[name || `action_${Object.keys(interestingLogs).length + 1}`] = txt.length > 6000 ? txt.slice(-6000) : txt
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
