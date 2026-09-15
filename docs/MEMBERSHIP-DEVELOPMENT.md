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
- All 43 local account, configuration, saved-league, access, owner API and PostgreSQL tests passed, zero skipped.
- Hosted anonymous RPC/table calls and an unsigned forged AAL2 JWT were rejected.
- Local origin isolation, signed-out denial, source/config denial and page security headers passed.

Repeat the read-only integration checks with:

```
node --env-file=.env.membership-development scripts/check-membership-development.cjs
```

## Protected HTTPS preview

The `feat/subscription-access-foundation` branch has a Vercel Preview deployment. Only this
branch receives the development Supabase URL/key, `MEMBERSHIP_DEV_PROJECT_REF`,
`MEMBERSHIP_ADMIN_ENABLED=true`, `SUBSCRIPTION_ACCESS_ENABLED=true` and
`ACCOUNT_DEVELOPMENT_COOKIE_SECONDS=60`. Production/shared settings remain unchanged.
The account configuration refuses to use the production project on this branch, and refuses
development configuration in a production deployment. Missing development settings return 503.

Vercel's existing deployment protection redirects anonymous requests for the account page,
membership page and account API to Vercel authentication. The signed-out account page loaded
over HTTPS with the DEVELOPMENT TEST SITE banner. Access to the preview alone does not
authorize the member directory; the application still requires its separate owner role and MFA.

The temporary 60-second access-cookie lifetime exercises the real refresh-token flow after
the browser expires that cookie. It does not shorten the provider's JWT lifetime. Production
ignores this test setting and does not receive the development banner or renewal diagnostics.
Local tests verify Secure/HttpOnly/SameSite=Strict and __Host cookie handling.

HTTPS sign-in with the existing development account succeeded and the owner member directory
loaded. After the 60-second access-cookie lifetime elapsed, the account page reported successful
session renewal against the real provider. The browser remained signed in, and the owner member
directory still loaded after renewal without another authenticator prompt.
Subscriptions are not ready for production: premium feature enforcement, billing integration
and launch review remain separate work.
