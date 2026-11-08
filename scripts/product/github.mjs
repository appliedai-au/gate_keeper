/** GitHub transport. Credentials remain in this server process and are never projected/logged. */
import { createHash, createPrivateKey, createHmac, sign, timingSafeEqual } from 'node:crypto';
import { GITHUB_ID, LOGIN, ACTOR_LOGIN, SHA, numericId, validPath, bounded } from './contracts.mjs';

const failure = (code = 'github_unavailable', status = 503) => Object.assign(new Error(code), { code, status });
const encode = value => encodeURIComponent(String(value));
const stringId = value => { if (!numericId(value)) throw failure('invalid_github_response'); return String(value); };
const timeout = () => AbortSignal.timeout(15000);

async function readJSON(response, limit = 2 * 1024 * 1024) {
  if (response.redirected || response.status >= 300 && response.status < 400) throw failure();
  const reader = response.body?.getReader();
  if (!reader) throw failure();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw failure('github_response_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure('invalid_github_response'); }
}

export function verifyWebhook(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== 'string' || secret.length < 32 ||
      typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/u.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function validateGithubUser(value) {
  const githubId = stringId(value?.id);
  if (!LOGIN.test(value.login || '') || value.type !== 'User') throw failure('invalid_github_identity', 403);
  const avatar = value.avatar_url ? new URL(value.avatar_url) : null;
  if (avatar && (avatar.protocol !== 'https:' || avatar.hostname !== 'avatars.githubusercontent.com'))
    throw failure('invalid_github_response');
  return { githubId, login: value.login, name: bounded(value.name, 200) ? value.name : null,
    email: null, avatarUrl: avatar?.toString() || null };
}

export function projectRepository(value) {
  const id = stringId(value?.id);
  if (!bounded(value.name, 100, 1) || !/^[A-Za-z0-9_.-]+$/u.test(value.name) ||
      !LOGIN.test(value.owner?.login || '') || value.full_name !== `${value.owner.login}/${value.name}` ||
      typeof value.private !== 'boolean' || !bounded(value.default_branch, 200, 1))
    throw failure('invalid_github_response');
  return { id, fullName: value.full_name, name: value.name, private: value.private,
    defaultBranch: value.default_branch };
}

/** A login can be renamed/reused; only the verified immutable account may authorize. */
export function permittedCollaborator(permission, login, expectedGithubId) {
  return ACTOR_LOGIN.test(login || '') && GITHUB_ID.test(String(expectedGithubId || '')) &&
    numericId(permission?.user?.id) && String(permission.user.id) === String(expectedGithubId) &&
    typeof permission.user.login === 'string' && permission.user.login.toLowerCase() === login.toLowerCase() &&
    ['admin', 'maintain', 'write'].includes(permission.permission);
}

export function comparisonFiles(comparison, baseSha, headSha, expectedFileCount) {
  if (!SHA.test(baseSha || '') || !SHA.test(headSha || '') || !Number.isSafeInteger(expectedFileCount) ||
      expectedFileCount < 1 || expectedFileCount > 300) throw failure('pull_request_too_large', 422);
  const files = comparison.files;
  if (comparison.base_commit?.sha !== baseSha || !SHA.test(comparison.merge_base_commit?.sha || '') ||
      !Array.isArray(comparison.commits) || comparison.commits.at(-1)?.sha !== headSha ||
      !Array.isArray(files) || files.length !== expectedFileCount || files.length > 300)
    throw failure('unsupported_diff', 422);
  let bytes = 0;
  return files.map(file => {
    if (!validPath(file.filename) || typeof file.patch !== 'string' || file.patch.length > 128000)
      throw failure('unsupported_diff', 422);
    bytes += Buffer.byteLength(file.patch);
    if (bytes > 256000) throw failure('pull_request_too_large', 422);
    return { file: file.filename, patch: file.patch, status: file.status,
      additions: file.additions, deletions: file.deletions };
  });
}

export function createGitHubClient({ appId, clientId, clientSecret, privateKey, callbackUrl,
  fetchImpl = fetch, clock = () => Date.now() }) {
  if (!GITHUB_ID.test(appId)) throw failure('setup_required');
  let signingKey;
  try {
    signingKey = createPrivateKey(privateKey);
    if (signingKey.asymmetricKeyType !== 'rsa' || signingKey.asymmetricKeyDetails.modulusLength < 2048)
      throw failure('setup_required');
  } catch { throw failure('setup_required'); }
  function appAuthorization() {
    const now = Math.floor(clock() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iat: now - 30, exp: now + 480, iss: appId })).toString('base64url');
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), signingKey).toString('base64url')}`;
  }
  async function api(path, authorization, { method = 'GET', body, accepted = [200], signal } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || /[\u0000-\u0020\\]/u.test(path)) throw failure();
    let response;
    try {
      response = await fetchImpl('https://api.github.com' + path, { method, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout()]) : timeout(), headers: { Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'G8S-Gatekeeper',
          Authorization: `Bearer ${authorization}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw failure(); }
    if (!accepted.includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      throw failure(response.status === 404 ? 'github_not_found' : response.status === 403 ? 'github_access_denied' : 'github_unavailable',
        response.status === 403 || response.status === 404 ? 403 : 503);
    }
    return response.status === 204 ? null : readJSON(response);
  }
  async function paged(path, authorization, field = null, maximumRows = 10000) {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
      const result = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, authorization);
      const batch = field ? result?.[field] : result;
      if (!Array.isArray(batch) || batch.length > 100) throw failure('invalid_github_response');
      rows.push(...batch);
      if (rows.length > maximumRows) throw failure('github_response_too_large');
      if (batch.length < 100) return rows;
    }
    throw failure('github_response_too_large');
  }

  async function exchangeCode(code, verifier) {
    if (!bounded(code, 512, 1) || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/u.test(verifier))
      throw failure('invalid_oauth_callback', 400);
    let response;
    try {
      response = await fetchImpl('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'error',
        signal: timeout(), headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code,
          redirect_uri: callbackUrl, code_verifier: verifier }).toString() });
    } catch { throw failure('oauth_failed'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw failure('oauth_failed'); }
    const result = await readJSON(response, 16384);
    if (typeof result.access_token !== 'string' || result.access_token.length < 20 || result.access_token.length > 1024 ||
        result.token_type?.toLowerCase() !== 'bearer') throw failure('oauth_failed');
    return result.access_token;
  }
  async function verifiedUser(authorization) {
    const user = validateGithubUser(await api('/user', authorization));
    // Email is optional: never infer one from the account name or a public field.
    try {
      const emails = await api('/user/emails', authorization);
      if (Array.isArray(emails)) {
        const primary = emails.find(item => item?.primary === true && item.verified === true &&
          bounded(item.email, 254, 3) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(item.email));
        if (primary) user.email = primary.email;
      }
    } catch { /* No email permission is required for account creation. */ }
    return user;
  }
  async function verifyInstallation(authorization, installationId) {
    if (!GITHUB_ID.test(installationId)) throw failure('invalid_request', 400);
    const installations = await paged('/user/installations', authorization, 'installations');
    const installation = installations.find(value => stringId(value.id) === installationId && String(value.app_id) === appId);
    if (!installation || installation.suspended_at || !LOGIN.test(installation.account?.login || '') ||
        !numericId(installation.account?.id) || !['User', 'Organization'].includes(installation.account?.type))
      throw failure('installation_not_authorized', 403);
    const actual = await api(`/app/installations/${installationId}`, appAuthorization());
    if (String(actual.app_id) !== appId || actual.suspended_at ||
        String(actual.account?.id) !== String(installation.account.id)) throw failure('installation_not_authorized', 403);
    const repositories = (await paged(`/user/installations/${installationId}/repositories`, authorization, 'repositories'))
      .filter(repository => repository.permissions?.push === true || repository.permissions?.maintain === true || repository.permissions?.admin === true)
      .map(projectRepository);
    if (!repositories.length) throw failure('installation_not_authorized', 403);
    return { installation: { id: installationId,
      account: { id: stringId(installation.account.id), login: installation.account.login, type: installation.account.type },
      repositorySelection: actual.repository_selection }, repositories };
  }

  async function installationClient(installationId, repositoryId = null, { readOnly = false } = {}) {
    if (typeof readOnly !== 'boolean' || !GITHUB_ID.test(installationId) || repositoryId !== null &&
        (!GITHUB_ID.test(repositoryId) || !Number.isSafeInteger(Number(repositoryId)))) throw failure();
    const requested = { permissions: { contents: 'read', pull_requests: readOnly ? 'read' : 'write', issues: 'read', metadata: 'read' },
      ...(repositoryId === null ? {} : { repository_ids: [Number(repositoryId)] }) };
    const receipt = await api(`/app/installations/${installationId}/access_tokens`, appAuthorization(),
      { method: 'POST', body: requested, accepted: [201] });
    if (typeof receipt.token !== 'string' || receipt.token.length < 20 || receipt.token.length > 1024 ||
        !Number.isFinite(Date.parse(receipt.expires_at)) || Date.parse(receipt.expires_at) <= clock()) throw failure();
    const authorization = receipt.token;
    const repositoryPath = fullName => {
      if (typeof fullName !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u.test(fullName)) throw failure();
      return '/repos/' + fullName.split('/').map(encode).join('/');
    };
    const pullPath = (fullName, number) => {
      if (!Number.isSafeInteger(number) || number < 1) throw failure();
      return `${repositoryPath(fullName)}/pulls/${number}`;
    };
    return {
      async repositories() { return (await paged('/installation/repositories', authorization, 'repositories')).map(projectRepository); },
      async pullRequest(fullName, number) {
        const pr = await api(pullPath(fullName, number), authorization);
        if (pr.number !== number || !SHA.test(pr.head?.sha || '') ||
            repositoryId !== null && String(pr.base?.repo?.id) !== repositoryId ||
            pr.base?.repo?.full_name !== fullName || !ACTOR_LOGIN.test(pr.user?.login || '') ||
            !['User', 'Bot'].includes(pr.user?.type) ||
            !['open', 'closed'].includes(pr.state) || !bounded(pr.title, 1024, 1) ||
            !bounded(pr.base?.ref, 200, 1)) throw failure('invalid_github_response');
        return pr;
      },
      async mayCommand(fullName, login, expectedGithubId) {
        if (!ACTOR_LOGIN.test(login || '') || !GITHUB_ID.test(String(expectedGithubId || ''))) return false;
        const permission = await api(`${repositoryPath(fullName)}/collaborators/${encode(login)}/permission`, authorization);
        return permittedCollaborator(permission, login, expectedGithubId);
      },
      async files(fullName, baseSha, headSha, expectedFileCount) {
        if (!SHA.test(baseSha || '') || !SHA.test(headSha || '') || !Number.isSafeInteger(expectedFileCount) ||
            expectedFileCount < 1 || expectedFileCount > 300) throw failure('pull_request_too_large', 422);
        const comparison = await api(`${repositoryPath(fullName)}/compare/${baseSha}...${headSha}`, authorization);
        return comparisonFiles(comparison, baseSha, headSha, expectedFileCount);
      },
      async instructions(fullName, baseSha) {
        if (!SHA.test(baseSha || '')) throw failure();
        try {
          const content = await api(`${repositoryPath(fullName)}/contents/.g8s/review.md?ref=${encode(baseSha)}`, authorization);
          if (content.type !== 'file' || content.encoding !== 'base64' || content.size > 16000 ||
              typeof content.content !== 'string') throw failure('repository_instructions_invalid', 422);
          const bytes = Buffer.from(content.content.replace(/\n/gu, ''), 'base64');
          if (bytes.length > 16000) throw failure('repository_instructions_invalid', 422);
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (error) {
          if (error.code === 'github_not_found') return '';
          throw error;
        }
      },
      /** Read source artifacts, not an imitation of Gitar. No dispatch or inference. */
      async comparisonEvidence(fullName, number) {
        const root = pullPath(fullName, number), deadline = AbortSignal.timeout(20000);
        let bytes = 0;
        const collect = async path => {
          const rows = [], ids = new Set();
          for (let page = 1; page <= 5; page++) {
            if (deadline.aborted) throw failure();
            const batch = await api(`${path}?per_page=100&page=${page}`, authorization, { signal: deadline });
            if (!Array.isArray(batch) || batch.length > 100) throw failure('invalid_github_response');
            for (const row of batch) {
              if (!numericId(row?.id) || ids.has(String(row.id))) throw failure('invalid_github_response');
              ids.add(String(row.id)); rows.push(row);
            }
            bytes += Buffer.byteLength(JSON.stringify(batch));
            if (bytes > 2 * 1024 * 1024) throw failure('github_response_too_large');
            if (batch.length < 100) return rows;
          }
          // A full last page does not prove that no further page exists.
          throw failure('github_response_too_large');
        };
        return { reviews: await collect(root + '/reviews'), inline: await collect(root + '/comments'),
          comments: await collect(`${repositoryPath(fullName)}/issues/${number}/comments`) };
      },
      // Call only AFTER a durable post intent. No automatic retry or repair.
      async postReview(fullName, number, body) {
        if (readOnly) throw failure('github_access_denied', 403);
        const receipt = await api(`${pullPath(fullName, number)}/reviews`, authorization,
          { method: 'POST', body, accepted: [200] });
        if (!numericId(receipt.id) || !SHA.test(receipt.commit_id || '') ||
            receipt.commit_id !== body.commit_id) throw failure('publication_uncertain');
        return { id: String(receipt.id), url: receipt.html_url };
      },
    };
  }
  return { exchangeCode, verifiedUser, verifyInstallation, installationClient };
}

export const sha256 = value => createHash('sha256').update(value).digest('hex');
