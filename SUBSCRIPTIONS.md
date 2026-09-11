# Subscription and access rollout

Started September 11, 2026. Owner location: Bozeman, Montana, USA.
Status: first server access-policy implementation and database migration prepared locally.
No billing, premium page restrictions, administrator grants, or new free-use limits are live.
The existing password gates remain until the protected replacements are verified.

## Agreed features and proposed defaults

Use one premium feature bundle. A paid subscription and an owner-issued complimentary grant
unlock the same bundle. Keep billing state separate from access: a comp is not a paid subscription.

| Feature | Free | Premium or complimentary |
| --- | --- | --- |
| Trade calculator | Two teams; existing manual player search and scoring controls | Up to twelve teams; Add Team; Sleeper league import and account My Leagues |
| League trade roster selection | Unavailable | Select a different roster for each team; select assets from that roster's player/pick list |
| League trade ranks | Unavailable | Before/after Contending and Rebuilding rank within the entire league |
| Best Available | Unavailable after paid launch | Full page access |
| Median Rankings | Unavailable after paid launch | Full page including saved leagues and lineup builder |
| Devy Mock Simulator | Proposed two rounds; owner has not finalized one versus two | All seven rounds |

Other free pages retain their current access. Do not automatically gate the existing strength-of-schedule
page, Team Analyzer, or League Rankings; additional changes need their own agreed feature split.
Monthly/annual price, final free draft-round limit, refunds, trial policy, and paid-launch date remain open.

## League-aware trades

- Reuse account saved leagues and default roster. Each trade box can select one of the league's rosters;
  prevent selecting the same roster in two boxes. Manual mode retains the current search interaction.
- In a selected roster box, show an owned-asset selector, including players and picks. Use Sleeper player
  IDs and pick identities (season, round, original roster) internally, not display names.
- Preserve the existing pick inventory and valuation rules from sleeper_data.js. Show season, round,
  and original team on each pick; current ownership changes in the hypothetical trade. Unranked values
  stay visibly unranked rather than being invented.
- Apply all outgoing/incoming transfers to cloned rosters; never write back to Sleeper or saved-league
  preferences. Prevent duplicate transfers, self-transfers, stale destinations and assets not owned by the sender.
- Recompute Contending and Rebuilding scores for every roster using the existing top-fifteen
  player-and-pick average, with the chosen scoring-format adjustments applied consistently to before/after.
  Re-rank the whole league, including nonparticipating teams. Keep current ordinal tie ordering stable.
- Display before -> after rank for both systems. Trade stud bonus stays in the trade balance only;
  it is not a roster asset and must not alter league ranks.
- Keep per-team Overall/Contending/Rebuilding value preferences and current multi-team destination logic.

## Secure access and owner management

The foundation uses a verified Supabase user ID, an owner-filtered subscription record and independent
complimentary grants. No browser role, email match, local-storage flag or checkout-success URL grants access.
The new account `access` action remains off unless SUBSCRIPTION_ACCESS_ENABLED=true; do not enable it
until the migration and RLS isolation checks have passed in an isolated development Supabase project.

Paid access requires an eligible subscription status and a confirmed, unexpired paid-through date.
Scheduled cancellations keep access through the paid period. A failed renewal never extends it.
Trials/grace periods are not currently enabled. Comps may have an expiry or no expiry, and can be revoked;
revoking a comp does not remove independently paid access. Billing cancellation does not remove a comp.

Prepare an owner-only membership screen listing account email, paid status, renewal/access end date,
complimentary status and expiry. Add grant/revoke controls, explicit confirmation and an audit trail.
Grant the owner's verified account permanent complimentary access after owner identity is confirmed.
Administrator membership is separate from premium access and must use a server-controlled immutable user ID,
step-up MFA and audit records. Never automatically make the first signup or a user-editable email an administrator.

The supplied migration allows authenticated users to read only their own access columns. They cannot write
subscriptions or grants, see admin notes, or query other accounts. Service credentials belong only in server
environment variables. The migration has not yet been applied or exercised against PostgreSQL.

## Feature enforcement and payment integration still to build

1. Apply/verify isolated development database migration, add owner administration with MFA and audit, test
   paid/free/expired/revoked/complimentary accounts without creating test records in production.
2. Protect premium page routes, data and server operations before activating any restrictions. Move premium
   operations/data out of public static delivery. Hiding buttons or putting an API check before otherwise
   public JavaScript is not an authorization boundary. Existing public Git history cannot be made secret
   retrospectively; audit direct file URLs and repository exposure for new premium assets.
3. Build league-aware trades and gate Add Team/league operations on the server. Enforce simulator round
   limits on server-owned simulation sessions. Preserve styles and test desktop/mobile behavior.
4. Use Stripe-hosted Checkout and Customer Portal in test mode for purchase, payment updates and cancellation.
   Bind Stripe customers/subscriptions to verified account IDs. Keep all price IDs allowlisted on the server.
   Verify webhook signatures against raw request bytes, handle retries idempotently and reconcile out-of-order
   events with current provider state. Establish paid-through only from verified payment records; never from
   a client's chosen price, customer ID or success redirect. Keep test and live keys, prices and webhooks separate.
5. Test first payment, renewal, failed payment, recovery, cancellation, immediate revocation, duplicate/late
   webhooks, account isolation, direct protected URLs and comp expiry. Test checkout return with existing
   Strict SameSite account cookies. Add account membership status and self-service billing link.
6. Review the full preview, complete business/provider launch setup, then separately approve real charges and
   the free-use restrictions. Show price, cadence, renewal/cancellation terms and included features before checkout.

No Stripe account or paid hosting upgrade has been created in this step. Prices and legal business details
must be supplied by the owner; identity/tax/bank information should be entered directly with the provider.

## Business setup references (checked September 11, 2026)

- An LLC is not mandatory just to start selling subscriptions. Montana permits sole proprietorships;
  a sole proprietor operating under a name other than their own must register an assumed business name.
  An LLC can provide liability separation, subject to exceptions and proper operation. Do not represent
  Dynasty Toolbox as an LLC until one exists. [Montana business structures](https://sosmt.gov/business/business-structures/)
- Confirm the correct local license for the actual operating address. Bozeman distinguishes home-based
  and commercial business licenses inside city limits; a Bozeman mailing address alone does not establish
  city jurisdiction. [City business-license guidance](https://www.bozemanmt.gov/home/showpublisheddocument/13803/638767715239670000)
- Use a separate business bank account for business revenue/expenses. Banks commonly request formation or
  DBA documents and an EIN, or an SSN for some sole proprietors. Confirm with the chosen bank.
  [SBA business setup and banking](https://www.sba.gov/counseling/launch-your-business/)
- Montana has no general sales tax. That does not remove income-tax obligations or potential obligations
  for taxable sales to customers elsewhere. Decide initial sales countries and review digital-subscription
  taxability/nexus with a qualified accountant before charging. [Montana sales-tax guidance](https://revenue.mt.gov/taxes/general-sales-tax)
- Stripe supports US sole-proprietor accounts and requires identity/tax verification. Hosted Checkout
  keeps card-entry fields with Stripe; the app stores identifiers and subscription state, not raw card data.
  [Stripe proprietor verification](https://support.stripe.com/questions/update-your-sole-proprietor-business-data),
  [Checkout](https://docs.stripe.com/payments/checkout), [Customer Portal](https://docs.stripe.com/customer-management)
- The current Vercel Hobby plan is for noncommercial personal use. Arrange a commercial-use plan before
  paid launch; do not upgrade or accept a paid plan without the owner's approval.
  [Vercel Hobby terms](https://vercel.com/docs/plans/hobby)
- Before launch, settle refund/cancellation policy, terms/privacy notice, support contact, pricing and
  billing cadence, and review commercial-use rights for third-party data and imagery. A Montana business
  adviser/attorney/accountant can help choose a suitable structure and confirm local requirements.
