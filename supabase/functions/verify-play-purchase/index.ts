// verify-play-purchase
// Server-side verification of Google Play purchases / subscriptions using the
// Google Play Developer API. The Android app sends the purchaseToken + productId,
// we fetch the canonical purchase from Google, confirm it's PURCHASED, persist it,
// and (if it's a one-time product) acknowledge it so it isn't auto-refunded.
//
// Required runtime secret:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  — full JSON of a service account that has
//   been granted access to the Play Console app (Users & Permissions → Invite
//   user → grant "View financial data" + "Manage orders and subscriptions").

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VerifyBody {
  packageName: string
  productId: string
  purchaseToken: string
  isSubscription?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing auth' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const body = (await req.json()) as VerifyBody
    if (!body?.packageName || !body?.productId || !body?.purchaseToken) {
      return json({ error: 'packageName, productId and purchaseToken are required' }, 400)
    }

    const saJson = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
    if (!saJson) {
      return json({
        error: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret is not configured. ' +
               'Add a Play Console service account JSON to enable real verification.',
      }, 500)
    }

    let serviceAccount: { client_email: string; private_key: string }
    try {
      serviceAccount = JSON.parse(saJson)
    } catch {
      return json({ error: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON' }, 500)
    }

    // 1. Get an OAuth access token for the Play Developer API
    const accessToken = await getAccessToken(serviceAccount)

    // 2. Call the Play API
    const kind = body.isSubscription ? 'subscriptions' : 'products'
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
              + `${encodeURIComponent(body.packageName)}/purchases/${kind}/`
              + `${encodeURIComponent(body.productId)}/tokens/${encodeURIComponent(body.purchaseToken)}`

    const playRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const playJson = await playRes.json().catch(() => ({}))
    if (!playRes.ok) {
      return json({
        valid: false,
        error: `Play API ${playRes.status}: ${JSON.stringify(playJson)}`,
      }, 400)
    }

    // 3. Determine validity
    // For products: purchaseState 0 = PURCHASED. For subs: expiryTimeMillis in future.
    const now = Date.now()
    let valid = false
    let purchaseState: number | null = null
    let expiryMs: number | null = null
    let acknowledged = false
    let orderId: string | null = playJson.orderId ?? null

    if (body.isSubscription) {
      expiryMs = playJson.expiryTimeMillis ? Number(playJson.expiryTimeMillis) : null
      acknowledged = playJson.acknowledgementState === 1
      valid = expiryMs !== null && expiryMs > now
    } else {
      purchaseState = playJson.purchaseState ?? null     // 0 = purchased, 1 = canceled, 2 = pending
      acknowledged = playJson.acknowledgementState === 1
      valid = purchaseState === 0
    }

    // 4. Acknowledge if not yet acknowledged (Play policy: ≤3 days)
    if (valid && !acknowledged) {
      const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/`
                   + `${encodeURIComponent(body.packageName)}/purchases/${kind}/`
                   + `${encodeURIComponent(body.productId)}/tokens/${encodeURIComponent(body.purchaseToken)}:acknowledge`
      const ackRes = await fetch(ackUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (ackRes.ok || ackRes.status === 204) acknowledged = true
    }

    // 5. Persist with service-role client (bypasses RLS but we set user_id explicitly)
    const admin = createClient(supabaseUrl, serviceKey)
    const { error: upsertErr } = await admin
      .from('play_purchases')
      .upsert({
        user_id: user.id,
        package_name: body.packageName,
        product_id: body.productId,
        purchase_token: body.purchaseToken,
        order_id: orderId,
        purchase_state: purchaseState,
        acknowledged,
        is_subscription: !!body.isSubscription,
        expiry_time_ms: expiryMs,
        raw: playJson,
        verified_at: new Date().toISOString(),
      }, { onConflict: 'package_name,purchase_token' })
    if (upsertErr) console.error('persist purchase failed:', upsertErr)

    return json({
      valid,
      acknowledged,
      orderId,
      purchaseState,
      expiryMs,
      raw: playJson,
    })
  } catch (e) {
    console.error('verify-play-purchase error:', e)
    return json({ error: (e as Error).message ?? 'internal error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---- Service-account JWT → OAuth2 access_token ----
async function getAccessToken(sa: { client_email: string; private_key: string }) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const iat = Math.floor(Date.now() / 1000)
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }
  const enc = (o: object) => base64url(new TextEncoder().encode(JSON.stringify(o)))
  const toSign = `${enc(header)}.${enc(claim)}`

  // Import PEM key
  const pem = sa.private_key.replace(/\\n/g, '\n')
  const pkcs8 = pemToArrayBuffer(pem)
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign))
  const jwt = `${toSign}.${base64url(new Uint8Array(sig))}`

  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const tokJson = await tokRes.json()
  if (!tokRes.ok || !tokJson.access_token) {
    throw new Error(`OAuth token exchange failed: ${JSON.stringify(tokJson)}`)
  }
  return tokJson.access_token as string
}

function base64url(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
