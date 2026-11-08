import { randomBytes } from 'node:crypto';
import { PRODUCT_PATH, COMMANDS, UUID, GITHUB_ID, SLUG, bounded, exactKeys, parseFilters,
  validConfiguration } from './contracts.mjs';
import { sha256, verifyWebhook } from './github.mjs';

const headers = Object.freeze({ 'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Vary': 'Origin', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
const errorMessages = {
  setup_required: 'G8S is waiting for the owner to complete the GitHub and service setup.',
  unauthenticated: 'Sign in with GitHub to continue.', forbidden: 'This account cannot access that resource.',
  not_found: 'This resource is not available to your account.', invalid_request: 'Check the request and try again.',
  invalid_oauth_callback: 'The GitHub sign-in could not be verified. Start again from G8S.',
  oauth_failed: 'GitHub sign-in could not be completed. Please try again.',
  installation_not_authorized: 'GitHub did not confirm access to that installation.',
  installation_already_claimed: 'That installation is already linked to another G8S account.',
  revision_conflict: 'These settings changed in another session. Refresh before saving.',
  conflict: 'This action conflicts with the current saved state. Refresh before trying again.',
  runs_paused: 'New runs are paused by an administrator.', quota_exceeded: 'Your run allowance has been reached.',
  rate_limited: 'Too many sign-in requests are in progress. Please try again shortly.',
  github_unavailable: 'GitHub is unavailable. No new review was started.',
  github_access_denied: 'GitHub did not grant the access required for this action.',
  github_not_found: 'The requested GitHub resource is no longer available.',
  export_too_large: 'This export is too large. Choose a shorter date range.',
  method_not_allowed: 'That method is not available.', invalid_signature: 'The webhook could not be authenticated.',
  product_unavailable: 'G8S could not complete this request. Please try again.',
};
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };

export function productUnavailable(_req, res) {
  res.writeHead(503, headers);
  res.end(JSON.stringify({ error: { code: 'setup_required', message: errorMessages.setup_required } }));
}

async function readBody(req, max = 128 * 1024, raw = false) {
  req.setTimeout?.(10000, () => req.destroy());
  const chunks = []; let length = 0;
  try {
    for await (const chunk of req) {
      length += chunk.length;
      if (length > max) fail('invalid_request', 413);
      chunks.push(chunk);
    }
  } finally { req.setTimeout?.(0); }
  const data = Buffer.concat(chunks);
  if (raw) return data;
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] || '')) fail('invalid_request', 415);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { fail('invalid_request'); }
}

function cookieValue(req, name) {
  const cookies = (req.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(name + '='));
  if (cookies.length !== 1) return null;
  const value = cookies[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}
const cookie = (name, value, age, sameSite = 'None') =>
  `${name}=${value}; Max-Age=${age}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
const signInCookie = '__Host-g8s_oauth';
const sessionCookie = '__Host-g8s_session';
export function auditCSV(entries) {
  const cell = value => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const safe = /^[\s]*[=+@-]/u.test(text) ? "'" + text : text;
    return '"' + safe.replace(/"/gu, '""') + '"';
  };
  return [['Timestamp', 'User', 'Action', 'Details'], ...entries.map(entry =>
    [entry.timestamp, entry.user?.email || entry.user?.login || '', entry.action, entry.details])]
    .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function createProductService({ store, github, config, entropy = size => randomBytes(size).toString('base64url'),
  clock = () => Date.now() }) {
  const origin = config.frontendOrigin;
  const callbackUrl = config.apiOrigin + PRODUCT_PATH + '/auth/github/callback';
  let stopping = false;

  function send(req, res, status, data, extra = {}) {
    if (res.destroyed || res.writableEnded) return;
    const cors = req.headers.origin === origin ? { 'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true' } : {};
    const body = JSON.stringify(data);
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) return send(req, res, 503,
      { error: { code: 'product_unavailable', message: errorMessages.product_unavailable } });
    res.writeHead(status, { ...headers, ...cors, ...extra }); res.end(body);
  }
  function redirect(res, location, cookies = []) {
    res.writeHead(303, { ...headers, Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
    res.end();
  }
  async function authenticate(req) {
    const value = cookieValue(req, sessionCookie);
    if (!value) fail('unauthenticated', 401);
    const session = await store.getSession(sha256(value));
    if (!session) fail('unauthenticated', 401);
    return session;
  }
  function isAdmin(user) { return config.adminGithubIds.has(String(user.githubId)); }
  async function startOAuth(res, { purpose = 'signin', userId = null, installationId = null, returnPath = null } = {}) {
    const state = entropy(32), browser = entropy(32), verifier = entropy(32);
    await store.createOAuth({ stateHash: sha256(state), browserHash: sha256(browser), verifier,
      expiresAt: new Date(clock() + 10 * 60 * 1000), purpose, userId, installationId, returnPath });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: config.githubClientId, redirect_uri: callbackUrl,
      state, code_challenge: Buffer.from(sha256(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256' }).toString();
    redirect(res, url.toString(), [cookie(signInCookie, browser, 600, 'Lax')]);
  }
  async function callback(req, res, url) {
    const state = url.searchParams.get('state'), code = url.searchParams.get('code');
    const browser = cookieValue(req, signInCookie);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(state || '') || !browser || !bounded(code, 512, 1) ||
        url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1)
      fail('invalid_oauth_callback');
    const pending = await store.consumeOAuth(sha256(state), sha256(browser));
    if (!pending || !['signin', 'complete_install'].includes(pending.purpose)) fail('invalid_oauth_callback');
    const authorization = await github.exchangeCode(code, pending.verifier);
    const identity = await github.verifiedUser(authorization);
    if (pending.userId) {
      const existing = await authenticate(req);
      if (existing.user.id !== pending.userId || String(existing.user.githubId) !== identity.githubId)
        fail('installation_not_authorized', 403);
    }
    const saved = await store.upsertIdentity(identity);
    let returnPath = `/${saved.organizations[0].slug}/dashboard`;
    if (pending.installationId) {
      const slug = /^\/([a-z0-9-]+)\/settings\/configuration$/u.exec(pending.returnPath || '')?.[1];
      if (!slug) fail('invalid_oauth_callback');
      const organization = await store.membership(saved.user.id, slug);
      const verified = await github.verifyInstallation(authorization, pending.installationId);
      await store.saveInstallation({ userId: saved.user.id, orgId: organization.id, ...verified,
        oauthStartedAt: pending.createdAt });
      returnPath = pending.returnPath;
    }
    const session = entropy(32);
    await store.createSession({ sessionHash: sha256(session), userId: saved.user.id,
      expiresAt: new Date(clock() + 7 * 86400000), oauthStartedAt: pending.createdAt });
    redirect(res, origin + returnPath, [cookie(sessionCookie, session, 7 * 86400), cookie(signInCookie, '', 0, 'Lax')]);
  }
  async function startInstall(req, res, url) {
    const session = await authenticate(req);
    const slug = url.searchParams.get('org') || session.organizations[0]?.slug;
    if (!SLUG.test(slug || '')) fail('invalid_request');
    await store.membership(session.user.id, slug);
    const state = entropy(32), browser = entropy(32);
    await store.createOAuth({ stateHash: sha256(state), browserHash: sha256(browser), verifier: null,
      expiresAt: new Date(clock() + 10 * 60000), purpose: 'install', userId: session.user.id,
      installationId: null, returnPath: `/${slug}/settings/configuration` });
    const target = `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new?state=${encodeURIComponent(state)}`;
    redirect(res, target, [cookie(signInCookie, browser, 600, 'Lax')]);
  }
  async function finishInstall(req, res, url) {
    const state = url.searchParams.get('state'), installationId = url.searchParams.get('installation_id');
    const browser = cookieValue(req, signInCookie);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(state || '') || !browser || !GITHUB_ID.test(installationId || '') ||
        url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('installation_id').length !== 1)
      fail('invalid_oauth_callback');
    const pending = await store.consumeOAuth(sha256(state), sha256(browser));
    const session = await authenticate(req);
    if (pending.purpose !== 'install' || pending.userId !== session.user.id) fail('installation_not_authorized', 403);
    // The setup query is only a candidate. Fresh OAuth proves the user can read
    // the installation's selected repositories before saveInstallation runs.
    return startOAuth(res, { purpose: 'complete_install', userId: session.user.id,
      installationId, returnPath: pending.returnPath });
  }
  async function webhook(req, res) {
    if (req.method !== 'POST') fail('method_not_allowed', 405);
    const bytes = await readBody(req, 2 * 1024 * 1024, true);
    if (!verifyWebhook(bytes, req.headers['x-hub-signature-256'], config.webhookSecret)) fail('invalid_signature', 401);
    const deliveryId = req.headers['x-github-delivery'], event = req.headers['x-github-event'];
    if (!UUID.test(deliveryId || '') || !['github_app_authorization', 'installation', 'installation_repositories', 'pull_request',
      'issue_comment', 'pull_request_review_comment', 'ping'].includes(event)) fail('invalid_request');
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('invalid_request'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid_request');
    const saved = await store.receiveDelivery({ deliveryId, event, payload });
    // Only the committed inbox is acknowledged. No repo code, GitHub fetch,
    // session creation, or model call happens in this webhook path.
    send(req, res, 202, { data: { accepted: true, duplicate: saved.duplicate } });
  }
  function validateMutation(req) {
    if (req.headers.origin !== origin || req.headers['x-g8s-request'] !== '1') fail('forbidden', 403);
  }

  async function handler(req, res) {
    try {
      if (stopping) fail('product_unavailable', 503);
      const url = new URL(req.url, config.apiOrigin);
      if (url.origin !== config.apiOrigin || !url.pathname.startsWith(PRODUCT_PATH + '/')) fail('not_found', 404);
      const path = url.pathname.slice(PRODUCT_PATH.length);
      if (path === '/webhooks/github') return await webhook(req, res);
      if (req.headers.origin && req.headers.origin !== origin) fail('forbidden', 403);
      if (req.method === 'OPTIONS') {
        const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (req.headers.origin !== origin || requested.some(x => !['content-type', 'x-g8s-request'].includes(x))) fail('forbidden', 403);
        res.writeHead(204, { ...headers, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-G8S-Request', 'Access-Control-Max-Age': '600' });
        res.end(); return;
      }
      if (req.method === 'GET' && path === '/auth/github/start') return await startOAuth(res);
      if (req.method === 'GET' && path === '/auth/github/callback') return await callback(req, res, url);
      if (req.method === 'GET' && path === '/auth/github/install') return await startInstall(req, res, url);
      if (req.method === 'GET' && path === '/auth/github/setup') return await finishInstall(req, res, url);
      const session = await authenticate(req);
      if (req.method === 'GET' && path === '/session') return send(req, res, 200,
        { data: { ...session, isAdmin: isAdmin(session.user), commands: COMMANDS } });
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) fail('method_not_allowed', 405);
      if (req.method !== 'GET') validateMutation(req);
      if (req.method === 'POST' && path === '/auth/logout') {
        await store.deleteSession(sha256(cookieValue(req, sessionCookie)));
        return send(req, res, 200, { data: { signedOut: true } }, { 'Set-Cookie': cookie(sessionCookie, '', 0) });
      }
      const segments = path.split('/').slice(1);
      if (segments.some(part => !/^[a-zA-Z0-9_-]+$/u.test(part))) fail('not_found', 404);
      if (segments[0] === 'admin') {
        if (!isAdmin(session.user)) fail('forbidden', 403);
        if (req.method === 'GET' && segments.length === 2 &&
            ['overview', 'users', 'installations', 'repositories', 'runs', 'audit'].includes(segments[1]))
          return send(req, res, 200, { data: await store.adminList(segments[1], parseFilters(url.searchParams)) });
        if (req.method === 'PUT' && path === '/admin/controls') {
          const body = await readBody(req);
          if (!exactKeys(body, ['paused', 'reason']) || typeof body.paused !== 'boolean' || !bounded(body.reason, 500, 1)) fail('invalid_request');
          return send(req, res, 200, { data: await store.setPause(session.user.id, body) });
        }
        if (req.method === 'PUT' && segments.length === 4 && segments[1] === 'users' &&
            UUID.test(segments[2]) && segments[3] === 'limits') {
          const body = await readBody(req);
          if (!exactKeys(body, ['monthlyRunLimit', 'maxConcurrentRuns'], ['disabled']) ||
              !Number.isInteger(body.monthlyRunLimit) || body.monthlyRunLimit < 0 || body.monthlyRunLimit > 1000000 ||
              !Number.isInteger(body.maxConcurrentRuns) || body.maxConcurrentRuns < 1 || body.maxConcurrentRuns > 16 ||
              body.disabled !== undefined && typeof body.disabled !== 'boolean') fail('invalid_request');
          return send(req, res, 200, { data: await store.setLimits(session.user.id, segments[2], body) });
        }
        fail('not_found', 404);
      }
      if (segments[0] !== 'orgs' || !SLUG.test(segments[1] || '')) fail('not_found', 404);
      const slug = segments[1], userId = session.user.id;
      await store.membership(userId, slug);
      if (req.method === 'GET' && segments.length === 5 && segments[2] === 'settings' &&
          segments[3] === 'audit' && segments[4] === 'export') {
        const exported = await store.exportAudit(userId, slug);
        res.writeHead(200, { ...headers, 'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="g8s-audit.csv"',
          ...(req.headers.origin === origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } : {}) });
        res.end(auditCSV(exported.entries)); return;
      }
      if (req.method === 'GET' && segments.length === 3 && ['overview', 'reviews'].includes(segments[2]))
        return send(req, res, 200, { data: await store[segments[2]](userId, slug, parseFilters(url.searchParams)) });
      if (req.method === 'GET' && segments.length === 4 && segments[2] === 'runs' && UUID.test(segments[3]))
        return send(req, res, 200, { data: await store.runDetail(userId, slug, segments[3]) });
      if (req.method === 'PUT' && segments.length === 4 && segments[2] === 'findings' && UUID.test(segments[3])) {
        const body = await readBody(req);
        if (!exactKeys(body, ['status']) || !['open', 'closed'].includes(body.status)) fail('invalid_request');
        return send(req, res, 200, { data: await store.resolveFinding(userId, slug, segments[3], body) });
      }
      if (segments.length === 4 && segments[2] === 'settings' &&
          ['configuration', 'organization', 'integrations', 'rules', 'audit', 'billing'].includes(segments[3])) {
        if (req.method === 'GET') return send(req, res, 200, { data: segments[3] === 'audit'
          ? await store.auditLog(userId, slug, { page: parseFilters(url.searchParams).page })
          : await store.settings(userId, slug, segments[3]) });
        if (req.method === 'PUT' && ['configuration', 'organization', 'rules'].includes(segments[3])) {
          const body = await readBody(req);
          if (segments[3] === 'configuration' && (!exactKeys(body, ['configuration'], ['revision']) ||
              !validConfiguration(body.configuration))) fail('invalid_request');
          return send(req, res, 200, { data: await store.saveSettings(userId, slug, segments[3], body) });
        }
      }
      if (segments[2] === 'repositories') {
        if (req.method === 'GET' && segments.length === 3) {
          if ([...url.searchParams.keys()].some(key => !['search', 'enabled', 'page'].includes(key))) fail('invalid_request');
          return send(req, res, 200, { data: await store.listRepositories(userId, slug,
            { search: url.searchParams.get('search') || '', enabled: url.searchParams.get('enabled') || 'all',
              page: Number(url.searchParams.get('page') || '0') }) });
        }
        if (req.method === 'POST' && segments.length === 4 && segments[3] === 'disable-all')
          return send(req, res, 200, { data: await store.disableAllRepositories(userId, slug) });
        if (req.method === 'POST' && segments.length === 4 && segments[3] === 'refresh') {
          const configured = await store.settings(userId, slug, 'configuration');
          for (const installation of configured.connections) {
            const client = await github.installationClient(String(installation.id));
            const repositories = [];
            for (const repository of await client.repositories())
              if (await client.mayCommand(repository.fullName, session.user.login, session.user.githubId)) repositories.push(repository);
            await store.syncInstallationRepositories(String(installation.id), repositories);
          }
          return send(req, res, 200, { data: await store.listRepositories(userId, slug) });
        }
        if (req.method === 'PATCH' && segments.length === 4 && GITHUB_ID.test(segments[3])) {
          const body = await readBody(req);
          if (!exactKeys(body, [], ['enabled', 'overrides']) || !Object.keys(body).length ||
              body.enabled !== undefined && typeof body.enabled !== 'boolean' ||
              body.overrides !== undefined && !validConfiguration(body.overrides, true)) fail('invalid_request');
          return send(req, res, 200, { data: await store.updateRepository(userId, slug, segments[3], body) });
        }
      }
      if (segments[2] === 'members' && segments.length === 4) {
        if (req.method === 'POST' && segments[3] === 'invite')
          return send(req, res, 201, { data: await store.inviteMember(userId, slug, await readBody(req)) });
        if (UUID.test(segments[3]) && req.method === 'PATCH')
          return send(req, res, 200, { data: await store.updateMember(userId, slug, segments[3], await readBody(req)) });
        if (UUID.test(segments[3]) && req.method === 'DELETE')
          return send(req, res, 200, { data: await store.removeMember(userId, slug, segments[3]) });
      }
      fail('not_found', 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = Object.hasOwn(errorMessages, error.code) ? error.code : 'product_unavailable';
      const status = code === 'product_unavailable' ? 503 : Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
      send(req, res, status, { error: { code, message: errorMessages[code] } });
    }
  }
  return { handler, stop() { stopping = true; } };
}
