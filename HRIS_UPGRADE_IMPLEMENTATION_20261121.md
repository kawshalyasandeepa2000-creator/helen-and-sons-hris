# Helen & Sons HRIS — Implementation notes (21 November 2026)

## Safe scope of this production upgrade

- GitHub backup branch: \`backup-before-hris-quality-upgrade-20261121\` (website code baseline only).
- Existing HRIS files, scanner checkpoint, break QR/NFC token and Supabase attendance records were not deleted.
- Existing Supabase RLS read policies now require an active HRIS profile for employee access.
- Attendance page now includes **My Fingerprint Attendance** for linked logins (last 30 UAE calendar days).
- The large duplicate 7-day/all-staff cards remain unmounted and their automatic history fetches are disabled.
- Late Notifications navigation is hidden until HR verifies schedules and late/absence rules.
- HR-only **HR Operations Setup** page now offers:
  1. Employee master profile metadata (joining date, employment type, manager, work location).
  2. Shift templates and append-only effective-date assignments.
  3. Configured annual leave entitlements and carry-forward days (not approved balances).
  4. Passport / visa / Emirates ID / work permit / employment-contract expiry dates (dates only).
  5. Recent configuration audit log and CSV export of document expiry dates.
- New HR configuration tables are RLS enabled, with only active Admin/HR access; regular employees cannot read this metadata.
- New HR configuration edits are captured by a database audit trigger; web users cannot edit the audit log.
- Missing foreign-key indexes were added for common HRIS relations.
- Static smoke tests live at \`scripts/hris-smoke-test.cjs\` and GitHub Actions workflow \`.github/workflows/hris-smoke.yml\`.

## Admin/HR setup checklist

1. Sign in to https://helen-and-sons-hris.pages.dev as **Admin or HR**.
2. Open **HR Operations Setup**.
3. Verify each employee's official HR joining date, work location and employment type before saving; no data was backfilled automatically.
4. Confirm official shift start/end, working weekdays and grace period with company HR policy. Create shift templates and date-effective assignments.
5. Enter leave allocations only after checking individual contracts, applicable UAE regulations and the employer's approved policy.
6. Enter verified document **expiry dates only**. Do not upload or enter identification numbers in this module.
7. Confirm all scanner IDs with HR before linking logins. Never infer an identity from scanner names alone.
8. Keep the office Windows Scheduled Task alive on the office network. Do not reset \`.live-sync-state.json\`, bypass unapproved/stale holds, or run parallel connector loops.
9. For HRIS account protection, enable Supabase Auth leaked-password protection in the Supabase Dashboard if available.
10. Verify Cloudflare production deployment and GitHub Actions status after changes.

## Important unfinished work

- **Payroll/WPS:** NOT implemented or submitted. Salaries, bank details, approved timesheets and final legal calculations are not present. No payroll export should be treated as WPS-ready.
- **UAE leave automation:** HR-entered allocation metadata is not automatically reduced by leave approvals. Build a validated leave ledger and apply HR-approved company rules before showing a balance as payable.
- **Late/overtime automation:** No legally validated shifts, public holidays, overnight duty, overtime approvals or company grace policy have been entered yet. Shift setup currently does NOT auto-mark employees late or change payroll.
- **Employee identity mapping:** Existing 17-person roster has only a subset of logins/scanner ID links. Admin must individually verify and approve the remaining ones; no automatic linking occurred.
- **Connector monitoring:** The HR Operations page shows *last imported fingerprint event timestamp*, NOT an authoritative online/heartbeat signal. For real downtime alerts, deploy a controlled heartbeat from the existing connector when local Windows access is available.
- **Sensitive documents:** Only expiry metadata is stored. Secure file upload, retention schedule and document viewing require a separate privacy/access review.
- **Password policy:** Supabase security advisor has indicated leaked-password protection is disabled. This cannot be changed by the present integration.
- **Browser functional tests:** Static checks are automated; test a real Admin, HR, Employee and inactive account session manually before declaring full acceptance. Also test an iPhone/Android QR/NFC flow.
- **Audit retention/backup:** Database schema migrations are not automatically undone by reverting a GitHub commit. Perform separate, verified database backups and a rehearsed restore process.

## Acceptance tests (must be completed with real authorized user accounts)

- Employee with scanner link sees **own** events but not another employee's events.
- Employee without scanner link sees an HR verification pending message, not made-up IN/OUT times.
- Day with one punch shows no confirmed OUT; 3+ events require review; no raw scan directly approves payroll.
- Deactivated account cannot access HR tables even with a JWT that has not expired.
- Admin/HR can open HR Operations; regular Employee cannot.
- Admin/HR can configure a shift; assignment history is not overwritten by a new effective date.
- HR document expiry status matches Gulf Standard Time dates, including today and 30-day boundaries.
- HR setup change generates an immutable record in \`hris_hr_change_audit\`; employees cannot read or edit it.
- Break Management start/end and QR/NFC flow remain unaffected.
- Live fingerprint sync continues through safe Scheduled Task with the existing checkpoint.
- \`node scripts/hris-smoke-test.cjs\` passes.
