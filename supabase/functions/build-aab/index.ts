import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CODEMAGIC_API = 'https://api.codemagic.io'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let buildIdForError: string | null = null

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'No authorization header' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!

    const cmToken = Deno.env.get('CODEMAGIC_API_TOKEN')
    const savedCmAppId = Deno.env.get('CODEMAGIC_APP_ID')?.trim() ?? ''
    const rawWorkflowId = Deno.env.get('CODEMAGIC_WORKFLOW_ID')?.trim()
    const webviewWorkflowId = !rawWorkflowId || rawWorkflowId.includes('PLACEHOLDER')
      ? 'build-aab-workflow'
      : rawWorkflowId
    const capacitorWorkflowId = Deno.env.get('CODEMAGIC_CAPACITOR_WORKFLOW_ID')?.trim() || 'capacitor-aab-workflow'

    if (!cmToken || !savedCmAppId) {
      return json({ error: 'Codemagic env vars missing (CODEMAGIC_API_TOKEN/APP_ID/WORKFLOW_ID)' }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { build_id } = await req.json()
    if (!build_id) return json({ error: 'build_id required' }, 400)
    buildIdForError = build_id

    const { data: build, error: fetchError } = await supabase
      .from('build_configs')
      .select('*')
      .eq('id', build_id)
      .eq('user_id', user.id)
      .single()
    if (fetchError || !build) return json({ error: 'Build not found' }, 404)

    const packageName = String(build.package_name ?? '').trim()
    if (!isValidPackageName(packageName)) {
      const msg = `Invalid Android package name: ${packageName || '(empty)'}. Use a valid package like com.company.app.`
      await supabase
        .from('build_configs')
        .update({ status: 'failed', error_message: msg })
        .eq('id', build_id)
      return json({ error: msg }, 400)
    }

    // Build a public icon URL if user uploaded one
    let iconUrl = ''
    if (build.icon_path) {
      const { data: signed } = await supabase.storage
        .from('app-assets')
        .createSignedUrl(build.icon_path, 60 * 60)
      iconUrl = signed?.signedUrl ?? ''
    }

    // ---- Signing key handling ----
    // Pull the selected signing key (or the user's default), download the keystore
    // from storage, base64-encode it, and pass it to Codemagic as CM_KEYSTORE
    // alongside the alias + passwords. codemagic.yaml decodes it to release.jks.
    let signingKey: any = null
    if (build.signing_key_id) {
      const { data } = await supabase
        .from('signing_keys')
        .select('*')
        .eq('id', build.signing_key_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (data?.keystore_path) {
        signingKey = data
      } else {
        console.warn('Selected signing key is missing a keystore file; falling back to a complete key')
      }
    }

    if (!signingKey) {
      const { data } = await supabase
        .from('signing_keys')
        .select('*')
        .eq('user_id', user.id)
        .not('keystore_path', 'is', null)
        .eq('is_default', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      signingKey = data
    }

    if (!signingKey) {
      const { data } = await supabase
        .from('signing_keys')
        .select('*')
        .eq('user_id', user.id)
        .not('keystore_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      signingKey = data
    }

    if (!signingKey || !signingKey.keystore_path) {
      const msg =
        'No release signing key uploaded. Open Dashboard → Signing Keys, upload your .jks/.keystore file with the correct alias and passwords, mark it as default, then start the build again. Play Console rejects debug-signed AABs.'
      await supabase
        .from('build_configs')
        .update({ status: 'failed', error_message: msg })
        .eq('id', build_id)
      return json({ error: msg }, 400)
    }

    let keystoreB64 = ''
    let keystorePassword = ''
    let keyAlias = ''
    let keyPassword = ''
    {
      keystorePassword = (signingKey.store_password ?? '').trim()
      keyAlias = (signingKey.key_alias ?? '').trim()
      keyPassword = ((signingKey.key_password ?? '').trim() || keystorePassword)
      if (signingKey.keystore_path) {
        const { data: file, error: dlErr } = await supabase.storage
          .from('app-assets')
          .download(signingKey.keystore_path)
        if (dlErr) {
          console.error('Keystore download failed:', dlErr)
        } else if (file) {
          const buf = new Uint8Array(await file.arrayBuffer())
          // base64 encode
          let binary = ''
          const chunk = 0x8000
          for (let i = 0; i < buf.length; i += chunk) {
            binary += String.fromCharCode(...buf.subarray(i, i + chunk))
          }
          keystoreB64 = btoa(binary)
        }
      }
    }

    if (!keystoreB64 || !keystorePassword || !keyAlias) {
      const msg =
        'Selected signing key is missing the keystore file or credentials. Re-upload it in Dashboard → Signing Keys.'
      await supabase
        .from('build_configs')
        .update({ status: 'failed', error_message: msg })
        .eq('id', build_id)
      return json({ error: msg }, 400)
    }

    // Mark as building
    await supabase
      .from('build_configs')
      .update({ status: 'building', error_message: null })
      .eq('id', build_id)

    const resolvedVersionName = String(build.version_name ?? '1.0.0').trim() || '1.0.0'
    const resolvedVersionCode = Math.max(
      Number.parseInt(String(build.version_code ?? '1'), 10) || 1,
      versionNameToCode(resolvedVersionName),
    )
    // Resolve mode + optional capacitor project zip
    const buildMode: 'webview' | 'capacitor' = (build.mode === 'capacitor') ? 'capacitor' : 'webview'
    let projectZipUrl = ''
    if (buildMode === 'capacitor') {
      if (!build.project_zip_path) {
        const msg = 'Capacitor build is missing the uploaded project zip. Re-upload your project source on the build form.'
        await supabase.from('build_configs').update({ status: 'failed', error_message: msg }).eq('id', build_id)
        return json({ error: msg }, 400)
      }
      const { data: zipSigned, error: zipErr } = await supabase.storage
        .from('capacitor-projects')
        .createSignedUrl(build.project_zip_path, 60 * 60 * 6)
      if (zipErr || !zipSigned?.signedUrl) {
        const msg = `Could not sign Capacitor project zip URL: ${zipErr?.message ?? 'unknown'}`
        await supabase.from('build_configs').update({ status: 'failed', error_message: msg }).eq('id', build_id)
        return json({ error: msg }, 500)
      }
      projectZipUrl = zipSigned.signedUrl
    }

    const cmWorkflowId = buildMode === 'capacitor' ? capacitorWorkflowId : webviewWorkflowId
    const cmAppId = savedCmAppId

    // Trigger Codemagic build
    const triggerBody: any = {
      appId: cmAppId,
      workflowId: cmWorkflowId,
      branch: 'main',
      environment: {
        variables: {
          BUILD_ID: build_id,
          BUILD_MODE: buildMode,
          PROJECT_ZIP_URL: projectZipUrl,
          ADMOB_APP_ID: build.admob_app_id ?? '',
          ADMOB_BANNER_ID: build.admob_banner_id ?? '',
          ADMOB_INTERSTITIAL_ID: build.admob_interstitial_id ?? '',
          ADMOB_REWARDED_ID: build.admob_rewarded_id ?? '',
          ADMOB_REWARDED_INTERSTITIAL_ID: build.admob_rewarded_interstitial_id ?? '',
          ADMOB_APP_OPEN_ID: build.admob_app_open_id ?? '',
          ADMOB_TEST_MODE: String(!!build.admob_test_mode),
          APP_URL: build.url ?? '',
          APP_NAME: build.app_name,
          PACKAGE_NAME: packageName,
          VERSION_NAME: resolvedVersionName,
          VERSION_CODE: String(resolvedVersionCode),
          THEME_COLOR: build.theme_color ?? '#4f46e5',
          SPLASH_COLOR: build.splash_color ?? '#FFFFFF',
          NAV_COLOR: build.nav_color ?? '#000000',
          ORIENTATION: build.orientation ?? 'portrait',
          ENABLE_BILLING: String(!!build.enable_billing),
          // Capacitor is always wired so the user's web app Capacitor plugins
          // (AdMob, Camera, Share, etc.) work natively inside the built APK/AAB.
          ENABLE_CAPACITOR: 'true',
          ENABLE_PULL_TO_REFRESH: String(build.enable_pull_to_refresh ?? true),
          ENABLE_NATIVE_SPLASH: String(build.enable_native_splash ?? true),
          ENABLE_OFFLINE_PAGE: String(build.enable_offline_page ?? true),
          ENABLE_PUSH_NOTIFICATIONS: String(!!build.enable_push_notifications),
          ENABLE_CAMERA: String(!!build.enable_camera),
          ENABLE_MICROPHONE: String(!!build.enable_microphone),
          ENABLE_LOCATION: String(!!build.enable_location),
          ENABLE_STORAGE: String(!!build.enable_storage),
          ENABLE_SMS: String(!!build.enable_sms),
          ENABLE_CONTACTS: String(!!build.enable_contacts),
          ENABLE_PHONE_STATE: String(!!build.enable_phone_state),
          ENABLE_VIBRATE: String(build.enable_vibrate ?? true),
          ENABLE_CLIPBOARD: String(build.enable_clipboard ?? true),
          ENABLE_SHARE: String(build.enable_share ?? true),
          ENABLE_BIOMETRIC: String(!!build.enable_biometric),
          ENABLE_BLUETOOTH: String(!!build.enable_bluetooth),
          ENABLE_NFC: String(!!build.enable_nfc),
          ENABLE_CALENDAR: String(!!build.enable_calendar),
          ENABLE_FILE_DOWNLOAD: String(build.enable_file_download ?? true),
          ENABLE_FILE_UPLOAD: String(build.enable_file_upload ?? true),
          ENABLE_GEOLOCATION: String(!!build.enable_geolocation),
          BLOCK_SCREENSHOTS: String(!!build.block_screenshots),
          KEEP_SCREEN_ON: String(!!build.keep_screen_on),
          FULLSCREEN_MODE: String(!!build.fullscreen_mode),
          HIDE_STATUS_BAR: String(!!build.hide_status_bar),
          ALLOW_ZOOM: String(!!build.allow_zoom),
          DARK_MODE_FORCE: String(!!build.dark_mode_force),
          ALLOW_EXTERNAL_LINKS: String(build.allow_external_links ?? true),
          CACHE_ENABLED: String(build.cache_enabled ?? true),
          ALLOW_CLEARTEXT: String(build.allow_cleartext ?? true),
          SWIPE_BACK_NAVIGATION: String(build.swipe_back_navigation ?? true),
          USER_AGENT_OVERRIDE: build.user_agent_override ?? '',
          CUSTOM_HTML_B64: toBase64(build.custom_html ?? ''),
          CUSTOM_CSS_B64: toBase64(build.custom_css ?? ''),
          CUSTOM_JS_B64: toBase64(build.custom_js ?? ''),
          ICON_URL: iconUrl,
          BUILD_TYPE: build.build_type ?? 'aab',
          // Signing — empty strings if no key; codemagic.yaml will then
          // auto-generate a test release keystore for sideload/test builds.
          CM_KEYSTORE: keystoreB64,
          CM_KEYSTORE_PASSWORD: keystorePassword,
          CM_KEY_ALIAS: keyAlias,
          CM_KEY_PASSWORD: keyPassword,
        },
      },
    }

    const triggerRes = await fetch(`${CODEMAGIC_API}/builds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': cmToken,
      },
      body: JSON.stringify(triggerBody),
    })

    const triggerJson = await triggerRes.json().catch(() => ({}))
    if (!triggerRes.ok) {
      const detail = triggerRes.status === 403
        ? `Codemagic rejected the request for app ${cmAppId}. The API token can read the app, but Codemagic cannot start this workflow/branch. Confirm the app is connected to the GitHub repo, has branch "main", and includes workflow "${cmWorkflowId}" in codemagic.yaml.`
        : JSON.stringify(triggerJson)
      const msg = `Codemagic trigger failed (${triggerRes.status}): ${detail}`
      await supabase
        .from('build_configs')
        .update({ status: 'failed', error_message: msg })
        .eq('id', build_id)
      return json({ error: msg }, 502)
    }

    const codemagicBuildId = triggerJson.buildId ?? triggerJson._id
    if (!codemagicBuildId) {
      await supabase
        .from('build_configs')
        .update({
          status: 'failed',
          error_message: `Codemagic returned no buildId: ${JSON.stringify(triggerJson)}`,
        })
        .eq('id', build_id)
      return json({ error: 'Codemagic returned no buildId' }, 502)
    }

    await supabase
      .from('build_configs')
      .update({ codemagic_build_id: codemagicBuildId, error_message: null })
      .eq('id', build_id)

    return json({ success: true, build_id, codemagic_build_id: codemagicBuildId })
  } catch (error) {
    console.error('Build trigger error:', error)
    if (buildIdForError) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        )
        await supabase
          .from('build_configs')
          .update({ status: 'failed', error_message: (error as Error).message ?? 'Unknown error' })
          .eq('id', buildIdForError)
      } catch (_) {}
    }
    return json({ error: (error as Error).message ?? 'Build failed' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function toBase64(value: string) {
  if (!value) return ''
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}



function versionNameToCode(value: string) {
  const [major = 1, minor = 0, patch = 0] = value
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10) || 0)
  return Math.max(1, major * 10000 + minor * 100 + patch)
}

function isValidPackageName(value: string) {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value)
}
