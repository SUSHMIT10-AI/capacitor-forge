## What I found

- The uploaded project zip is reaching backend storage successfully.
- No `build_configs` row is created after upload, so the `build-aab` function is never called.
- Because `build-aab` is never called, Codemagic never receives a build request.
- There are no recent logs for `build-aab` or `poll-codemagic-build`, confirming the flow stops before Codemagic.
- The likely failure point is the frontend insert into `build_configs`, most likely due to stale schema/type mismatch or missing visible error handling after the zip upload.

## Fix plan

1. **Make the build form fail visibly at the exact step**
   - Add explicit step-by-step error messages for: zip upload URL, zip upload, `build_configs` insert, and Codemagic trigger.
   - Keep the uploaded zip path and insert payload consistent so a successful zip upload always creates a build record.

2. **Fix the build record creation path**
   - Ensure `BuildForm.tsx` inserts only fields that exist in the live database.
   - Store the uploaded zip path in `project_zip_path` and set `mode = 'capacitor'` correctly.
   - Set the default build type to `aab` so it builds a Play Store AAB by default.

3. **Fix Codemagic build ID tracking**
   - Update `build-aab` to write the Codemagic build ID into the existing `codemagic_build_id` column instead of hiding it inside `error_message`.
   - Update `poll-codemagic-build` to read from `codemagic_build_id` first, with backward compatibility for old `cm:` markers.

4. **Make the dashboard recover stuck uploads/builds**
   - Show failed build-start errors in the build history instead of leaving the user with no row.
   - Make polling more reliable for `pending` and `building` builds.

5. **Validate the full flow**
   - Test the deployed edge function call path after the changes.
   - Confirm a build row is created and `build-aab` is invoked.
   - Check edge function logs and database state to verify Codemagic receives the build request.