# Subscription sandbox integration - October 16, 2026

Local implementation; hosted payment delivery and checkout are not yet verified. No live billing or production release is authorized. Keep BILLING_WEBHOOK_READY unset until the notification endpoint and development database are ready.

## Implemented

- Authenticated, same-origin account actions: billing-status, billing-checkout, billing-portal, billing-refresh. Existing HTTP-only cookies and verified Supabase identities are reused. Browser input cannot choose customer, price, amount, quantity, trial or redirect.
- Stripe SDK 23.0.0, API version 2024-10-28.acacia. Explicitly pins invoice.subscription, invoice.charge and line.price rather than assuming the Dashboard's newer generated sample matches.
- Service-only customer mapping, per-user database leases, 12 interactive operations/minute, persisted customer/checkout idempotency keys, reuse of open sessions, and duplicate-subscription prevention. Uncertain creation attempts older than 23 hours require review instead of another creation request.
- /api/stripe-webhook verifies original bytes through the SDK with a five-minute signature tolerance. Rejects live/Connect events, oversized bodies and invalid signatures. Failed processing returns a retryable status. Event ID and membership snapshot commit atomically. Fetches current provider state while holding the same account lease as checkout, preventing stale event payloads from restoring obsolete access.
- Access requires matching paid invoice coverage backed by a successful captured, unrefunded, undisputed test charge. No access comes from return URLs, trials, out-of-band invoices, pending payments, credit notes or prorations. Failed renewals cannot extend paid coverage. Scheduled cancellation keeps paid coverage; immediate cancellation removes it. Complimentary grants are independent.
- Hidden development membership controls for checkout, portal and manual status refresh. No public paywall is enabled.

## Confirmed dashboard setup

Sandbox acct_1UQuk03u6z47lQ6H; product prod_VSE1NfTM1QgX1m; monthly USD $10 placeholder price price_1URJZt3u6z47lQ6HMNYUQRHB. These are test identifiers, not credentials or approved launch prices.

Saved in Vercel only for Preview branch feat/subscription-access-foundation: BILLING_MODE=sandbox, STRIPE_TEST_MONTHLY_PRICE_ID, STRIPE_TEST_SECRET_KEY, SUPABASE_BILLING_SECRET_KEY, STRIPE_TEST_ACCOUNT_ID and STRIPE_TEST_PORTAL_CONFIG_ID. Credentials are Secrets; their values are not in this repository. The owner removed a broader Preview duplicate.

The development billing migration was applied October 16. All three new tables have RLS enabled and deny SELECT to anon/authenticated. The environment row matches the development project and Stripe sandbox. Portal configuration bpc_1URKVo3u6z47lQ6HxM3Bkp3O was saved and reloaded: invoice history, payment-method updates and cancellation at period end enabled; customer-profile editing, plan switching and quantity changes disabled. Cancellation reasons remain enabled. The portal header explicitly identifies test subscription management. These are sandbox settings only.

## Remaining development setup

1. Completed: supabase/migrations/202610160001_billing_sandbox.sql in DEVELOPMENT project phkbpputgegvesmpscrx. Never apply this test binding to production. Billing records prevent account deletion until a billing retention/deletion procedure is established.
2. Completed: STRIPE_TEST_ACCOUNT_ID (Config) and SUPABASE_BILLING_SECRET_KEY (Secret), branch-only. The owner copied the DEVELOPMENT key directly between dashboards. It provides privileged database access; never use a production key or public variable prefix. No secret values in chat, Git or logs.
3. Deploy the reviewed billing changes to the subscription branch, preserving unrelated work. Return origin defaults to Vercel's exact branch hostname, falling back to its deployment hostname. An explicit BILLING_RETURN_ORIGIN must match one of those; localhost testing needs explicit http://localhost:8773 and private test configuration.
4. Create a Stripe sandbox webhook destination for https://<verified-development-branch-host>/api/stripe-webhook using API version 2024-10-28.acacia. Events: checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid, invoice.payment_failed, invoice.payment_action_required, invoice.voided, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, charge.refunded, charge.dispute.created, charge.dispute.closed, credit_note.created, credit_note.updated, credit_note.voided.
5. Save the destination signing secret as STRIPE_TEST_WEBHOOK_SECRET (Secret), same branch scope, and redeploy. Preserve preview protection for people. Check Vercel's available options for machine access scoped to this exact endpoint; do not disable protection for the whole preview. Never put any bypass credential in source, screenshots or chat.
6. Completed: test customer portal configuration and branch-scoped STRIPE_TEST_PORTAL_CONFIG_ID. Its saved options are recorded above; no retention coupon selected. These restrictions are not final business policies.
7. Verify a signed sandbox event reaches the endpoint and unsigned requests fail. Set BILLING_WEBHOOK_READY=true only after schema, credentials, portal and delivery checks succeed. Redeploy the preview. A Dashboard setup guide marked Complete is not proof of integration success.
8. Test actual sandbox purchases, repeated clicks, failed/authentication-required cards, renewal failure, scheduled/immediate cancellation, refunds, disputes and event retries with development accounts. Compare Stripe and Supabase membership records. Test two-account isolation and sign-out before public use.

## Verification and limits

Local tests cover request builders, real SDK signatures, origin/authentication gates, payment evidence, checkout idempotency, stale attempts, event reconciliation, refunds/disputes and PostgreSQL permissions/transactions. Run node --test tests/billing-*.test.cjs. The database test requires PGLITE_TEST_MODULE; a skipped test is not verification.

Hosted delivery, Checkout, portal, preview machine access and hosted two-account checks are pending. The initial flow allows cards only, without discounts, trials, prorations or plan changes. Any refund or dispute conservatively removes that invoice's coverage; restoring access following a partial refund or won dispute needs owner review. Lists paginate up to 1,000 entries; larger or inconsistent histories require review rather than silent truncation. No scheduled reconciliation job is active: use signed-in payment refresh and retry failed events during testing. Production needs monitoring/reconciliation, retention, published terms, tax decisions, final prices and separate launch approval. Stripe test clocks and the website's real clock differ; fast-forwarding Stripe alone does not prove website expiry works.

## Recovery

In Stripe Workbench > Event deliveries, select this destination and check failed deliveries. Save event ID, time, status and a short description privately. Fix configuration/database errors, then retry delivery. Never manually grant premium or extend paid-through dates to hide a failure.

For an uncertain customer/checkout attempt older than 23 hours, inspect Stripe for the stored request before creating another. Do not clear idempotency fields blindly. Reconcile completed sessions first: a failed response may still have created the payment object.

To stop new test checkouts, unset BILLING_WEBHOOK_READY and redeploy; retain the webhook for existing tests. To disable all billing, unset BILLING_MODE and redeploy; Stripe events will fail until restored. Neither action deletes credentials.

## Official references

- https://docs.stripe.com/api/invoices/object?api-version=2024-10-28.acacia
- https://docs.stripe.com/api/checkout/sessions/create?api-version=2024-10-28.acacia
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/sandboxes
