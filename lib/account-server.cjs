'use strict';

const MIN_PASSWORD = 12;
const {leagueAction} = require('./saved-leagues.cjs');
const {readAccess,resolveAccess} = require('./subscription-access.cjs');
const {tradeAction} = require('./trade-calculator.cjs');
const {finderAction} = require('./trade-finder.cjs');
const {outlookAction} = require('./league-outlook.cjs');
const {preferenceAction,ACTIONS:PREFERENCE_ACTIONS}=require('./finder-preferences.cjs');
const {pinnedAction,ACTIONS:PIN_ACTIONS} = require('./saved-trades.cjs');
const {simulate} = require('./devy-simulator.cjs');
const {adminAction,ACTIONS:ADMIN_ACTIONS} = require('./membership-admin.cjs');
const MAX_BODY = 8192;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAGUE_ACTIONS = new Set(['leagues', 'league-lookup', 'league-add', 'league-update', 'league-remove']);
const TRADE_ACTIONS = new Set(['trade-config','trade-league','trade-evaluate','finder-league','finder-rosters','finder-matches','devy-config','devy-evaluate']);
const SAFE_ACTIONS = new Set(['outlook-league','access', 'session', 'signup', 'resend', 'verify', 'signin', 'forgot', 'reset', 'signout', ...LEAGUE_ACTIONS, ...ADMIN_ACTIONS, ...TRADE_ACTIONS, ...PIN_ACTIONS, ...PREFERENCE_ACTIONS]);

function cookies(header = '') {
  const result = Object.create(null);
  for (const part of header.split(';')) {
    const split = part.indexOf('=');
    if (split < 0) continue;
    try { result[part.slice(0, split).trim()] = decodeURIComponent(part.slice(split + 1)); } catch (_) { /* Ignore malformed cookies. */ }
  }
  return result;
}
function validPassword(value) {
  return typeof value === 'string' && [...value].length >= MIN_PASSWORD && Buffer.byteLength(value, 'utf8') <= 72;
}
function allowedOrigin(req, env) {
  const origin = req.headers.origin;
  const allowed = new Set((env.ACCOUNT_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) allowed.add('https://' + host);
  }
  if (!env.VERCEL && !env.ACCOUNT_ALLOWED_ORIGINS) {
    allowed.add('http://127.0.0.1:8770');
    allowed.add('http://localhost:8770');
  }
  return typeof origin === 'string' && allowed.has(origin);
}
function createHandler(clientFactory, env = {}) {
  return async function account(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    let renewed = false;
    const development = env.ACCOUNT_DEVELOPMENT === 'true' && env.VERCEL_ENV !== 'production';
    const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(development ? {...body,environment:'development',...(body.user!==undefined?{sessionRenewed:renewed}:{})} : body)); };
    if (env.VERCEL_ENV === 'production' && env.ACCOUNT_PUBLIC_ENABLED !== 'true') {
      return reply(503, { error: 'Accounts are being prepared. Please check back later.' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'Use the account form to continue.' }); }
    if (!allowedOrigin(req, env)) return reply(403, { error: 'Open the account page on this website to continue.' });
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Invalid request format.' });
    let body;
    try {
      if (Number(req.headers['content-length'] || 0) > MAX_BODY) return reply(413, { error: 'Request is too large.' });
      body = req.body;
      if (body === undefined) {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk.toString('utf8');
          if (Buffer.byteLength(raw) > MAX_BODY) return reply(413, { error: 'Request is too large.' });
        }
        body = JSON.parse(raw);
      } else if (typeof body === 'string' || Buffer.isBuffer(body)) body = JSON.parse(body.toString());
      if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) throw new Error('body');
    } catch (_) { return reply(400, { error: 'Invalid request.' }); }
    const action = body.action;
    if (!SAFE_ACTIONS.has(action)) return reply(400, { error: 'Unknown account action.' });
    if(action==='outlook-league'&&(env.LEAGUE_OUTLOOK_ENABLED!=='true'||env.SUBSCRIPTION_ACCESS_ENABLED!=='true'||env.VERCEL_ENV==='production'))return reply(503,{error:'League Outlook is being prepared in development.'});
    if (action === 'access' && env.SUBSCRIPTION_ACCESS_ENABLED !== 'true') return reply(503, {error:'Membership access is being prepared.'});
    if (TRADE_ACTIONS.has(action) && env.SUBSCRIPTION_ACCESS_ENABLED !== 'true') return reply(503, {error:'The new trade calculator is being prepared.'});
    if ((PIN_ACTIONS.has(action)||PREFERENCE_ACTIONS.has(action)) && env.SUBSCRIPTION_ACCESS_ENABLED !== 'true') return reply(503, {error:'Pinned trades are being prepared.'});
    if (ADMIN_ACTIONS.has(action) && env.MEMBERSHIP_ADMIN_ENABLED !== 'true') return reply(503, {error:'Membership administration is being prepared.'});
    const secure = !!env.VERCEL || (req.headers.origin || '').startsWith('https://');
    const prefix = secure ? '__Host-dt-' : 'dt-dev-';
    const jar = cookies(req.headers.cookie);
    const cookie = (name, value, seconds) => `${prefix}${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
    const clear = () => res.setHeader('Set-Cookie', [cookie('access', '', 0), cookie('refresh', '', 0)]);
    const save = (session) => {
      if (!session?.access_token || !session?.refresh_token) throw new Error('Missing session');
      const testSeconds=Number(env.ACCOUNT_DEVELOPMENT_COOKIE_SECONDS);
      const cap=development && Number.isInteger(testSeconds) && testSeconds>=60 && testSeconds<=3600 ? testSeconds : 3600;
      const seconds = Math.max(1, Math.min(cap, (session.expires_at || (Date.now() / 1000 + 3600)) - Math.floor(Date.now() / 1000)));
      res.setHeader('Set-Cookie', [cookie('access', session.access_token, Math.floor(seconds)), cookie('refresh', session.refresh_token, 7 * 86400)]);
    };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (['signup', 'resend', 'verify', 'signin', 'forgot', 'reset'].includes(action) && (!EMAIL.test(email) || email.length > 254)) {
      return reply(400, { error: 'Enter a valid email address.' });
    }
    if (['signup', 'reset'].includes(action) && !validPassword(body.password)) {
      return reply(400, { error: 'Use a unique password of at least 12 characters. If you used a very long password, try a shorter passphrase.' });
    }
    if (action === 'signin' && (typeof body.password !== 'string' || !body.password || body.password.length > 1024)) return reply(400, { error: 'Enter your password.' });
    if (['verify', 'reset'].includes(action) && !/^\d{8}$/.test(body.code || '')) return reply(400, { error: 'Enter the 8-digit code from your email.' });
    const limited = error => error?.status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(error?.code);
    const rateError = () => reply(429, { error: 'Please wait a minute before trying again.' });
    const unavailable = error => !error?.status || error.status >= 500 || error.name === 'AuthRetryableFetchError';
    const recordFailure = (stage, error) => {
      // Diagnostics intentionally exclude message, request data, email, code and tokens.
      if (env.ACCOUNT_DIAGNOSTICS === 'true') console.warn('Account provider failure', {
        stage, status: Number(error?.status) || 0,
        code: /^[a-z_]{1,64}$/.test(error?.code || '') ? error.code : 'unclassified',
      });
    };
    try {
      const client = clientFactory();
      if (action === 'signup') {
        const { error } = await client.auth.signUp({ email, password: body.password });
        if (limited(error)) return rateError();
        if (error && !['user_already_exists', 'email_exists'].includes(error.code)) return reply(400, { error: 'Unable to create your account right now. Please try again later.' });
        return reply(200, { message: 'Check your email for a verification code. If you already have an account, sign in or reset your password.' });
      }
      if (action === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email);
        if (limited(error)) return rateError();
        if (error) return reply(400, { error: 'Unable to request a reset right now. Please try again later.' });
        return reply(200, { message: 'If an account exists for this email, a reset code is on its way.' });
      }
      if (action === 'resend') {
        const { error } = await client.auth.resend({ type: 'signup', email });
        if (limited(error)) return rateError();
        if (error && unavailable(error)) return reply(503, { error: 'Email services are temporarily unavailable. Please try again shortly.' });
        return reply(200, { message: 'If your account needs verification, a new verification code is on its way. Use the newest email.' });
      }
      if (action === 'signin') {
        const { data, error } = await client.auth.signInWithPassword({ email, password: body.password });
        if (error) recordFailure('signin', error);
        if (limited(error)) return rateError();
        if (error && unavailable(error)) return reply(503, { error: 'We could not reach the sign-in service. Please try again shortly; this does not mean your password is incorrect.' });
        if (error || !data?.session) return reply(401, { error: 'Unable to sign in. Check your details and make sure your email is verified.' });
        save(data.session);
        return reply(200, { user: { email: data.user.email } });
      }
      if (action === 'verify' || action === 'reset') {
        const { data, error } = await client.auth.verifyOtp({ email, token: body.code, type: action === 'reset' ? 'recovery' : 'email' });
        if (error) recordFailure(action + '_verify', error);
        if (limited(error)) return rateError();
        if (error && unavailable(error)) return reply(503, { error: 'We could not reach account verification. Please try again shortly; this does not mean your code has expired.' });
        if (error) return reply(400, { error: action === 'reset' ? 'That reset code was not accepted. Use the newest password-reset email, or select Send a new code below.' : 'That verification code was not accepted. Use the newest account-verification email, or select Send a new code below.' });
        if (!data?.session) return reply(503, { error: 'Verification did not finish. Please try again shortly.' });
        if (action === 'reset') {
          const updated = await client.auth.updateUser({ password: body.password });
          if (updated.error) recordFailure('reset_update', updated.error);
          // Recovery is a temporary session, never returned to the browser.
          await client.auth.signOut({ scope: updated.error ? 'local' : 'global' });
          clear();
          if (updated.error?.code === 'same_password') return reply(400, { error: 'Your new password must be different from the current one. Select Send a new code, then choose a different password.' });
          if (updated.error) return reply(400, { error: 'The code was accepted, but the password could not be updated. Select Send a new code and try again.' });
          return reply(200, { message: 'Password updated. Sign in with your new password.' });
        }
        save(data.session);
        return reply(200, { user: { email: data.user.email } });
      }
      let access = jar[prefix + 'access'];
      let refresh = jar[prefix + 'refresh'];
      let user = null;
      if (access) {
        const checked = await client.auth.getUser(access);
        if (!checked.error) user = checked.data?.user;
      }
      if (!user && jar[prefix + 'refresh']) {
        const refreshed = await client.auth.refreshSession({ refresh_token: jar[prefix + 'refresh'] });
        if (!refreshed.error && refreshed.data?.session) {
          access = refreshed.data.session.access_token;
          renewed = true;
          refresh = refreshed.data.session.refresh_token;
          user = refreshed.data.user;
          if (action !== 'signout') save(refreshed.data.session);
        }
      }
      if (action === 'signout') {
        if (access && user) {
          // This endpoint uses the caller's access token, never an admin key.
          const result = await client.auth.admin.signOut(access, body.everywhere === true ? 'global' : 'local');
          if (result.error) { clear(); return reply(502, { error: 'This browser is signed out, but other sessions could not be revoked. Please try again.' }); }
        }
        clear();
        return reply(200, { message: 'You are signed out.' });
      }
      if(action==='outlook-league'){
        if(!user?.email_confirmed_at){clear();return reply(401,{error:'Sign in to view League Outlook.'});}
        const membership=await readAccess(user,clientFactory(access));
        try{return reply(200,await outlookAction(body,membership,{directory:env.OUTLOOK_RESEARCH_DIR}));}
        catch(error){if([400,403,502,503].includes(error.status))return reply(error.status,{error:error.message});throw error;}
      }
      if (PIN_ACTIONS.has(action)||PREFERENCE_ACTIONS.has(action)) {
        if(!user?.email_confirmed_at){clear();return reply(401,{error:'Sign in to save or view pinned trades.'});}
        const db=clientFactory(access),membership=await readAccess(user,db);
        try{return reply(200,await (PREFERENCE_ACTIONS.has(action)?preferenceAction:pinnedAction)(action,body,user,db,membership));}
        catch(error){if([400,401,403,409,502,503].includes(error.status))return reply(error.status,{error:error.message});throw error;}
      }
      if (TRADE_ACTIONS.has(action)) {
        const membership = user?.email_confirmed_at ? await readAccess(user,clientFactory(access)) : resolveAccess(null);
        try {return reply(200,action.startsWith('finder-')?await finderAction(action,body,membership):action.startsWith('devy-')?simulate(action,body,membership):await tradeAction(action,body,membership));}
        catch(error){if([400,403,502].includes(error.status))return reply(error.status,{error:error.message});throw error;}
      }
      if (!user || !user.email_confirmed_at) { clear(); return (LEAGUE_ACTIONS.has(action) || ADMIN_ACTIONS.has(action) || action === 'access') ? reply(401, {error:'Sign in to continue.'}) : reply(200, { user: null }); }
      if (ADMIN_ACTIONS.has(action)) {
        const [status,result] = await adminAction(action,body,clientFactory(access),{access_token:access,refresh_token:refresh},save);
        return reply(status,result);
      }
      if (action === 'access') return reply(200, {access:await readAccess(user, clientFactory(access))});
      if (LEAGUE_ACTIONS.has(action)) {
        const [status, result] = await leagueAction(action, body, user, clientFactory(access));
        return reply(status, result);
      }
      return reply(200, { user: { email: user.email } });
    } catch (_) {
      // Never log bodies, passwords, codes or session tokens.
      return reply(503, { error: 'Account services are temporarily unavailable. Please try again shortly.' });
    }
  };
}
module.exports = { createHandler, validPassword, cookies, allowedOrigin };
