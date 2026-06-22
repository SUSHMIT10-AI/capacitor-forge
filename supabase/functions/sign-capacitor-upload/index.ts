import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No authorization header' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    const filename: string = (body?.filename ?? 'project.zip').toString()
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)
    const objectPath = `${user.id}/${crypto.randomUUID()}_${safe}`

    const admin = createClient(supabaseUrl, supabaseServiceKey)
    const { data, error } = await admin.storage
      .from('capacitor-projects')
      .createSignedUploadUrl(objectPath)

    if (error || !data) {
      return json({ error: `Could not create signed upload URL: ${error?.message ?? 'unknown'}` }, 500)
    }

    return json({
      upload_url: data.signedUrl,
      token: data.token,
      path: objectPath,
      bucket: 'capacitor-projects',
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
