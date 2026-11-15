HELEN & SONS HRIS — PREMIUM BLUE UI UPGRADE
==========================================
Built from the supplied helen-and-sons-hris-main.zip repository archive.

WHAT CHANGED
- index.html: Premium Blue navigation search, chart cards, an account preview,
  and a fingerprint activity summary; original application script retained.
- Added css/premium-blue-ui.css and js/premium-blue-ui.js.
- Added css/premium-standalone.css to fingerprint-live.html,
  daily-attendance.html and reset-password.html.
- Existing CSS, assets, Supabase configuration, role checks, forms,
  API calls, and scanner-monitor JavaScript have NOT been edited.

DATA TRUTH AND PERMISSIONS
- No attendance IN / OUT or accuracy percentages are fabricated.
- Admin / HR analytics read ONLY the already rendered authorized
  team/historical reports; the new UI makes no additional API requests.
- Scans are raw/provisional until HR review. A day without a record does
  not establish absence.
- All original role-based access controls remain authoritative.
- The People & Access dashboard widget mirrors only account rows already
  available to the logged-in user's Employee Accounts page.

HOW TO DEPLOY VIA GITHUB / CLOUDFLARE PAGES
1. Back up the existing live GitHub repository or make a separate test branch.
2. Extract THIS ZIP locally. It contains index.html at the ROOT plus css,
   js, assets and the other original website files.
3. Copy these extracted root files and folders into the ROOT of your
   helen-and-sons-hris repository, preserving paths (do NOT create a
   nested helen-and-sons-hris-main folder in the repo root).
4. Commit the changed files to the branch that Cloudflare Pages uses.
   If the Cloudflare site is linked to that GitHub branch, it normally
   deploys the commit. Otherwise deploy the extracted root as static site files.
5. Visit https://helen-and-sons-hris.pages.dev/ and hard refresh (Ctrl+F5).
6. Test Admin, HR and Employee roles; login, sign-out, employee access
   management, attendance, fingerprint scans, reports and CSV exports.
   Test fingerprint-live.html and password reset separately.
7. If any critical feature fails, roll back to the saved deployment.

IMPORTANT
- This ZIP is for the WEBSITE ONLY. It has NO Windows fingerprint connector.
- Do not upload connector/.env, secret keys, checkpoints or scanner data.
- This change does NOT repair the office ZKTeco connector's ID-13 restriction,
  safety pause, or automatic sync. Handle that work at the office separately.
- Syntax, HTML ID preservation, CSS parsing and presentation-level interaction
  checks passed. Live Supabase workflow testing still requires your accounts.
