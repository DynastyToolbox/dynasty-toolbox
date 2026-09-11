# Accounts and saved leagues

The account service supports signup, email verification, sign-in, password reset, sign-out, and private saved Sleeper leagues. Subscriptions and subscriber authorization are separate future work; existing preview-page password prompts remain in place.

## Architecture

- The Node account endpoint uses the official Supabase SDK. Passwords, email codes and tokens are never returned in JSON or logged. Access and refresh tokens use Secure, HttpOnly, SameSite=Strict host-only cookies on hosted deployments. The local HTTP preview uses separate development cookie names.
- Origin checks, request-size limits, fixed action validation and verified Supabase sessions protect account actions. Saved-league writes use the caller's JWT and database row-level security, with an additional user-ID filter. Never introduce a service-role key into this request path.
- Saved leagues have a unique account/platform/league-ID constraint. IDs remain strings. Sleeper supplies league, season and team labels; the selected roster must exist in that league. Renewals replace an existing saved entry and require a team choice for the new ID.
- Signed-in pages use My Leagues instead of guest recent-ID history. No auth tokens or saved account records are written to browser JavaScript storage. Existing ranking caches are independent.
- The account page has a restrictive content security policy and no analytics script. Passwords require at least 12 Unicode code points and at most 72 UTF-8 bytes. Email codes are eight digits and expire according to the Supabase provider configuration.

## Deployment configuration

Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the target project. ACCOUNT_ALLOWED_ORIGINS is a comma-separated list of exact permitted site origins. Vercel deployment host origins are added automatically. ACCOUNT_PUBLIC_ENABLED must be true to enable the production endpoint; keep it disabled until hosted verification is complete. Never enable production through a code default.

Apply supabase/migrations/20260910_saved_leagues.sql only when provisioning a new database. It creates owner-only CRUD policies and revokes anonymous grants. Do not rerun this migration against an existing table. supabase/tests/saved_leagues_rls.sql tests owner access, cross-account denial, ownership-transfer denial and anonymous denial using rolled-back fixtures; it requires an existing auth user in a test database.

Keep future destructive data tests in a separate development project. A published project contains real user records and must no longer be treated as disposable test storage.

## Validation and operational notes

Run npm run test:accounts for account and saved-league tests. Hosted verification must check the custom domain, HTTP cookie flags, signup/email/reset behavior, private-data denial, saved-league persistence and mobile layouts. Provider-mocked tests do not replace live email or hosted checks.

Public signup requires configured email delivery, abuse controls, a privacy notice and monitored provider limits. Supabase leaked-password screening is a paid-plan feature; it is not currently enabled. MFA is enabled for the administrative service accounts. Do not store administrative credentials, SMTP credentials, user emails, league selections or test codes in this repository.

Global sign-out revokes refresh sessions; already issued access tokens may remain valid until provider expiry. Removing a saved league only removes this website's account reference. An account-deletion request requires a separate authenticated support process.

References: https://supabase.com/docs/guides/database/postgres/row-level-security and https://docs.sleeper.com/.
