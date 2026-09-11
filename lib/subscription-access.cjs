'use strict';

// Server-only policy. Identity must come from Supabase getUser, records from RLS queries.
// Do not accept membership, roles, payment success URLs, or dates from browser input.
const PREMIUM = Object.freeze({tradeTeams:12, tradeLeagueImport:true, bestAvailable:true, medianRankings:true, devyRounds:7});
const FREE = Object.freeze({tradeTeams:2, tradeLeagueImport:false, bestAvailable:false, medianRankings:false, devyRounds:2});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;

function resolveAccess(userId, subscription, grants = [], now = Date.now()) {
  const none = () => ({premium:false, sources:[], expiresAt:null, features:{...FREE}});
  if (!UUID.test(userId || '') || !Number.isFinite(now)) return none();
  const sources = [], expirations = [];
  // A scheduled cancellation preserves access to the end of the paid period.
  // Failed renewals never extend paid_through. No implicit trial or grace period.
  const paidUntil = timestamp(subscription?.paid_through);
  if (subscription?.user_id === userId && subscription.plan === 'premium' &&
      ['active','past_due'].includes(subscription.status) && paidUntil > now) {
    sources.push('subscription'); expirations.push(paidUntil);
  }
  const validGrants = (Array.isArray(grants) ? grants : []).filter(grant => grant?.user_id === userId &&
    grant.plan === 'premium' && grant.revoked_at === null && timestamp(grant.starts_at) <= now &&
    (grant.expires_at === null || timestamp(grant.expires_at) > now));
  if (validGrants.length) {
    sources.push('complimentary');
    expirations.push(...validGrants.map(grant => grant.expires_at === null ? Infinity : timestamp(grant.expires_at)));
  }
  if (!sources.length) return none();
  const until = Math.max(...expirations);
  return {premium:true, sources, expiresAt:until === Infinity ? null : new Date(until).toISOString(), features:{...PREMIUM}};
}

async function readAccess(user, db, now = Date.now()) {
  if (!UUID.test(user?.id || '') || !user.email_confirmed_at) return resolveAccess(null);
  const [subscription, grants] = await Promise.all([
    db.from('membership_subscriptions').select('user_id,plan,status,paid_through').eq('user_id',user.id).maybeSingle(),
    db.from('access_grants').select('user_id,plan,starts_at,expires_at,revoked_at').eq('user_id',user.id),
  ]);
  // Provider failures must not become premium access or a misleading free-account state.
  if (subscription.error || grants.error) throw new Error('Access service unavailable');
  return resolveAccess(user.id,subscription.data,grants.data,now);
}

function requireFeature(access, feature) {
  if (!Object.hasOwn(PREMIUM,feature) || access?.premium !== true || access.features?.[feature] !== PREMIUM[feature]) {
    const error = new Error('Premium access is required for this feature.');
    error.status = 403; throw error;
  }
}
module.exports = {resolveAccess, readAccess, requireFeature};
