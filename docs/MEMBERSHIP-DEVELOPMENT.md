# Isolated membership verification

Provisioned September 14, 2026. The separate Supabase project is named **Dynasty Toolbox Accounts - Development**.
Production accounts, production credentials, paid access and the public website have not been changed.

## Configuration

The development project uses the Free plan, explicit Data API table grants and automatic RLS.
Applied migrations in this order:

1. `20260910_saved_leagues.sql`
2. `202609110001_subscription_access.sql`
3. `202609110002_membership_admin.sql`

Its email provider requires confirmation, 12-character minimum passwords and eight-digit email codes
with a 600-second expiry. Secure password change is enabled. Development email messages have TEST
in the subject and sender name. SMTP uses a separate Resend sending-only credential restricted to
the existing verified auth domain; the credential is stored with Supabase, not in this repository.

Set these variables in an ignored `.env.membership-development` file:

```
MEMBERSHIP_DEV_PROJECT_REF=<development project reference>
SUPABASE_URL=https://<development project reference>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<development publishable key>
```

Run:

```
node --env-file=.env.membership-development scripts/membership-dev-server.cjs
```

On the Windows Codex sandbox, add `--preserve-symlinks --preserve-symlinks-main` before other options.
Open `http://localhost:8773/account.html` or `http://localhost:8773/members.html`.
Use the DEVELOPMENT TEST SITE banner to distinguish this from the fictional demo on port 8772.
The server binds to loopback, requires the localhost host/origin and explicitly refuses the production
project reference. It serves only account/membership assets and is not a general website preview.
It does not use the production fallback configuration in `api/account.js`.

The owner's newly registered, email-verified development account has been assigned its immutable
UUID through trusted database administration. The real user completes password and authenticator
entry directly in the browser. No automatic email-based or first-user administrator rule exists.

## Evidence and remaining checks

- Real development email signup and verification succeeded.
- Before role assignment, the signed-in account was denied the member directory.
- After role assignment, the session was required to verify an authenticator; enrollment displayed a QR.
- The owner completed real TOTP verification and the member directory loaded.
- A temporary complimentary grant succeeded; revocation returned the account to Free and both actions appeared in audit history.
- A short, custom-expiry grant automatically stopped granting access at its end time.
- Removing the development owner role denied the next request from the existing AAL2 session and cleared member results. The owner role was restored afterward.
- Browser sign-out succeeded; revisiting memberships required sign-in and returned no member data.
- All 40 local account, saved-league, access, owner API and PostgreSQL tests passed, zero skipped.
- Hosted anonymous RPC/table calls and an unsigned forged AAL2 JWT were rejected.
- Local origin isolation, signed-out denial, source/config denial and page security headers passed.

Repeat the read-only integration checks with:

```
node --env-file=.env.membership-development scripts/check-membership-development.cjs
```

Still pending at this checkpoint: a second sign-in/MFA challenge with the existing factor,
refresh/token-expiry behavior, and an HTTPS-hosted preview check for secure cookies. The local front end uses HTTP loopback cookies;
hosted Supabase API tests alone do not verify Vercel's HTTPS session behavior. Do not publish or
declare subscriptions ready based on these partial integration results.
