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
    return json({
      build_id: buildId,
      status: build?.status,
      message: build?.message,
      failed_step: failed?.name,
      log_tail: logTail,
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
  const fallback = apps
    .filter((a: any) => String(a.repository?.htmlUrl ?? a.repository?.url ?? '').toLowerCase().includes('/full-app-replication'))
    .at(-1)
  if (fallback?._id) {
    result.recommended_app = {
      _id: fallback._id,
      appName: fallback.appName,
      repo: fallback.repository?.htmlUrl ?? fallback.repository?.url ?? null,
      workflows: fallback.workflows ? Object.keys(fallback.workflows) : [],
    }
  }

  // 2. Try fetching the specific configured app
  if (appId) {
    const oneRes = await fetch(`https://api.codemagic.io/apps/${appId}`, {
      headers: { 'x-auth-token': token },
    })
    const oneJson = await oneRes.json().catch(() => ({}))
    result.configured_app_status = oneRes.status
    if (!oneRes.ok) {
      result.configured_app_error = oneJson
      if (fallback?._id) {
        result.configured_app_recommendation = `Update CODEMAGIC_APP_ID to ${fallback._id}, or rely on the build function fallback.`
      }
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
