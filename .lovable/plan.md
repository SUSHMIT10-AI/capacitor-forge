## Goal
Use the new Codemagic APP ID `6a3bdcd9a6402664a3e602bb` as the single source of truth for all builds. Remove fallback logic that silently switches to another app when the configured one isn't accessible.

## Changes

### 1. Update the secret
Update `CODEMAGIC_APP_ID` to `6a3bdcd9a6402664a3e602bb` via `secrets--update_secret`-style internal set (using `set_secret` would skip since the key already exists, so use `update_secret`).

### 2. `supabase/functions/build-aab/index.ts`
- Remove `resolveCodemagicAppId()` and `fetchCodemagicApp()` helpers entirely.
- At the call site (line ~201), use `savedCmAppId` directly: `const cmAppId = savedCmAppId`.
- Drop the `appIdWarning` log.
- Keep the early guard that fails if `CODEMAGIC_APP_ID` is not set.

### 3. `supabase/functions/diagnose-codemagic/index.ts`
- Remove the `fallback` lookup (lines ~71–81) and the `configured_app_recommendation` line (~93) that suggests switching app IDs.
- Keep the listing of accessible apps and the configured-app fetch for diagnostics.

### 4. `supabase/functions/poll-codemagic-build/index.ts`
No changes needed — it already uses the configured `CODEMAGIC_APP_ID` directly with no fallback.

## Out of scope
- No database changes.
- No UI changes.
- Workflow IDs and other Codemagic env vars remain as-is.
