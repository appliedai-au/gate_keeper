/**
 * Database acceptance cases. All identities and activity below are synthetic
 * test fixtures in a disposable database. They are never seed/app data.
 * The caller supplies an isolated PostgreSQL-compatible pool and applies the
 * schema first. This helper makes no network, GitHub, model or secret call.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ProductStore, DEFAULT_CONFIGURATION } from '../scripts/product/store.mjs';

export async function exerciseProductStore(pool) {
  const store = new ProductStore(pool), completed = [];
  const passed = name => completed.push(name);
  const denies = (operation, code) => assert.rejects(operation, error => error.code === code);
  await store.ready();
  const one = await store.upsertIdentity({ githubId: '1001', login: 'g8s-store-test-one', name: null, email: null, avatarUrl: null });
  const two = await store.upsertIdentity({ githubId: '1002', login: 'g8s-store-test-two', name: null, email: null, avatarUrl: null });
  const user = one.user.id, other = two.user.id, slug = one.organizations[0].slug;
  const org = one.organizations[0].id;
  assert.equal(one.user.email, null);
  assert.equal(one.organizations[0].name, 'g8s-store-test-one');
  assert.equal((await store.upsertIdentity({ githubId: '1001', login: 'g8s-store-test-one', name: null, email: null, avatarUrl: null })).user.id, user);
  await denies(() => store.membership(other, slug), 'not_found');
  // Adding a membership never changes this v1's strict per-user data ownership.
  await pool.query(`INSERT INTO g8s_product.memberships(org_id,user_id,role) VALUES ($1,$2,'member')`, [org, other]);
  await denies(() => store.membership(other, slug), 'not_found');
  passed('identity upsert, personal organisation, membership cannot cross owner boundary');

  const emptyOverview = await store.overview(user, slug), emptyReviews = await store.reviews(user, slug);
  assert.equal(emptyOverview.hasData, false); assert.deepEqual(emptyOverview.series, []);
  assert.equal(emptyReviews.closureRate, null); assert.deepEqual(emptyReviews.unresolved, []);
  const emptyBilling = await store.settings(user, slug, 'billing');
  assert.equal(emptyBilling.usage.modelSpendUsd, null);
  assert.equal(emptyBilling.usage.estimatedModelCostUsd, null);
  assert.equal(emptyBilling.usage.monthlyRunLimit, 0);
  assert.equal((await store.adminList('overview')).paused, true);
  passed('empty metrics remain empty, absent costs remain unknown, admission defaults disabled');

  // Fixed digest and named verifier placeholders are not usable credentials.
  const oauth = { stateHash: '1'.repeat(64), browserHash: '2'.repeat(64),
    verifier: 'G8S_PKCE_VERIFIER_PLACEHOLDER_FOR_TESTS_ONLY_01', purpose: 'signin', userId: null,
    returnPath: null, expiresAt: new Date(Date.now() + 300000) };
  await store.createOAuth(oauth);
  await denies(() => store.consumeOAuth(oauth.stateHash, '3'.repeat(64)), 'invalid_oauth_callback');
  assert.equal((await store.consumeOAuth(oauth.stateHash, oauth.browserHash)).purpose, 'signin');
  await denies(() => store.consumeOAuth(oauth.stateHash, oauth.browserHash), 'invalid_oauth_callback');
  await store.createSession({ sessionHash: '4'.repeat(64), userId: user, expiresAt: new Date(Date.now() + 300000) });
  assert.equal((await store.getSession('4'.repeat(64))).user.id, user);
  await store.deleteSession('4'.repeat(64));
  assert.equal(await store.getSession('4'.repeat(64)), null);
  passed('browser-bound OAuth is single use and sessions revoke durably');

  const installation = { id: '2001', account: { id: '1001', login: 'g8s-store-test-one', type: 'User' }, repositorySelection: 'selected' };
  const repo = { id: '3001', name: 'fixture', fullName: 'g8s-store-test-one/fixture', private: true, defaultBranch: 'main' };
  await store.saveInstallation({ userId: user, orgId: org, installation, repositories: [repo] });
  await denies(() => store.saveInstallation({ userId: other, installation, repositories: [repo] }), 'installation_already_claimed');
  assert.equal((await store.listRepositories(user, slug)).repositories[0].id, '3001');
  assert.equal((await store.listRepositories(user, slug)).repositories[0].enabled, false);
  await store.updateRepository(user, slug, '3001', { enabled: true });
  await denies(() => store.updateRepository(other, slug, '3001', { enabled: false }), 'not_found');
  await denies(() => store.overview(other, two.organizations[0].slug, { repository: '3001' }), 'not_found');
  passed('verified installations cannot be taken over and repository filters cannot cross users');

  let settings = await store.settings(user, slug, 'configuration');
  assert.equal(settings.connections[0].id, '2001');
  assert.equal(settings.capabilities.autoFillSummaries, false);
  assert.equal(settings.capabilities.invitationsEmail, false);
  await store.saveSettings(user, slug, 'configuration', { configuration: { ...DEFAULT_CONFIGURATION, customInstructions: 'Test fixture instructions.' }, revision: settings.revision });
  await denies(() => store.saveSettings(user, slug, 'configuration', { configuration: DEFAULT_CONFIGURATION, revision: settings.revision }), 'revision_conflict');
  assert.equal((await store.settings(user, slug, 'configuration')).configuration.customInstructions, 'Test fixture instructions.');
  const rules = await store.saveSettings(user, slug, 'rules', { rules: [{ name: 'Fixture rule', description: 'Check fixture data bounds.', severity: 'medium', enabled: true }] });
  assert.equal(rules.rules[0].metPercentage, null);
  const ruleId = rules.rules[0].id;
  await denies(() => store.saveSettings(other, two.organizations[0].slug, 'rules', { rules: [{ id: ruleId,
    name: 'Forged fixture rule', description: 'Must be refused.', severity: 'low', enabled: true }] }), 'invalid_request');
  await denies(() => store.saveSettings(user, slug, 'organization', { name: 'Fixture', logoUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), 'invalid_request');
  const invitation = await store.inviteMember(user, slug, { email: 'synthetic-recipient@example.invalid', role: 'member' });
  assert.equal(invitation.delivery, 'not_sent');
  assert.equal((await store.exportAudit(user, slug)).entries.length > 0, true);
  await denies(() => store.exportAudit(other, slug), 'not_found');
  passed('settings revision, rules ownership, raster logo boundary, honest invitation and audit export');

  const deliveryId = randomUUID(), head = 'a'.repeat(40);
  const payload = { action: 'opened', installation: { id: 2001 }, repository: { id: 3001 }, pull_request: { number: 1, head: { sha: head } } };
  assert.equal((await store.receiveDelivery({ deliveryId, event: 'pull_request', payload })).duplicate, false);
  assert.equal((await store.receiveDelivery({ deliveryId, event: 'pull_request', payload })).duplicate, true);
  assert.equal((await store.receiveDelivery({ deliveryId: randomUUID(), event: 'pull_request', payload })).duplicate, true);
  await denies(() => store.receiveDelivery({ deliveryId, event: 'pull_request', payload: { ...payload, action: 'edited' } }), 'conflict');
  assert.equal((await store.claimDelivery()).deliveryId, deliveryId);
  await store.finishDelivery(deliveryId, { status: 'processed' });
  const envelope = { deliveryId, installationId: '2001', repositoryId: '3001', prNumber: 1, headSha: head, baseSha: 'e'.repeat(40),
    title: 'Synthetic review fixture', prUrl: 'https://github.com/g8s-store-test-one/fixture/pull/1',
    authorLogin: 'g8s-store-test-one', authorType: 'User', baseBranch: 'main', draft: false, merged: false,
    trigger: 'pull_request', actorLogin: null, actorGithubId: null, actorType: null, findingId: null };
  const queued = await store.enqueueRun(envelope);
  assert.equal(queued.length, 1); assert.equal((await store.enqueueRun(envelope)).length, 0);
  assert.equal(await store.claimRun(), null);
  await store.setPause(user, { paused: false, reason: 'Isolated test control only.' });
  assert.equal(await store.claimRun(), null);
  await store.setLimits(user, user, { monthlyRunLimit: 10, maxConcurrentRuns: 1 });
  let run = await store.claimRun(); assert.equal(run.id, queued[0].id);
  assert.equal(run.repository_full_name, repo.fullName);
  assert.equal(run.github_repository_id, '3001'); assert.equal(run.github_installation_id, '2001');
  assert.equal(run.org_slug, slug); assert.equal(run.owner_github_login, 'g8s-store-test-one');
  assert.equal(run.rules[0].id, ruleId);
  assert.equal(await store.claimRun(), null);
  passed('durable delivery/body replay dedup and quota/pause-controlled run admission');

  const input = { binding: { sourceCommit: 'b'.repeat(40), runtimeDigest: 'c'.repeat(64) }, files: [], configuration: DEFAULT_CONFIGURATION };
  await denies(() => store.transitionRun(run.id, 'preparing', 'session_dispatch', { input }), 'invalid_request');
  run = await store.transitionRun(run.id, 'preparing', 'session_dispatch', { input,
    observation: { stage: 'session_intent', payload: { purpose: 'synthetic-test-only' } } });
  assert.equal(await store.transitionRun(run.id, 'preparing', 'session_dispatch', { input,
    observation: { stage: 'session_intent', payload: {} } }), null);
  run = await store.transitionRun(run.id, 'session_dispatch', 'session_created', { sessionId: 'synthetic-session-id',
    observation: { stage: 'session_receipt', payload: { id: 'synthetic-session-id' } } });
  assert.equal((await store.recoverableRuns()).some(row => row.id === run.id), true);
  run = await store.transitionRun(run.id, 'session_created', 'turn_dispatch', { observation: { stage: 'turn_intent', payload: {} } });
  run = await store.transitionRun(run.id, 'turn_dispatch', 'running', { turnId: 'synthetic-turn-id', observation: { stage: 'turn_receipt', payload: {} } });
  const finding = { id: randomUUID(), file: 'fixture.ts', line: 7, endLine: 7, severity: 'medium', category: 'correctness',
    title: 'Synthetic finding for database acceptance', explanation: 'This only exercises database projection.', evidence: 'fixture line' };
  const result = { summary: 'Synthetic completed review, used only by this isolated database test.',
    organizationRisk: 'medium', repositoryRisk: 'low', risk: 'medium', findings: [finding],
    ruleEvaluations: [{ ruleId, met: false, evidence: 'Synthetic evaluation evidence.' }],
    estimatedCostUsd: 0.125, costSource: 'trueforge_metrics_estimate' };
  run = await store.transitionRun(run.id, 'running', 'post_dispatch', { result, risk: result.risk,
    estimatedCostUsd: result.estimatedCostUsd, costSource: result.costSource,
    observation: { stage: 'post_intent', payload: { commit_id: head, event: 'COMMENT', body: 'Synthetic review body.' } } });
  run = await store.transitionRun(run.id, 'post_dispatch', 'review_posted', { githubReviewId: '4001',
    observation: { stage: 'post_receipt', payload: { id: '4001' } } });
  run = await store.finishRun(run.id, result); assert.equal(run.state, 'complete');
  assert.equal((await store.finishRun(run.id, result)).state, 'complete');
  await denies(() => store.runDetail(other, slug, run.id), 'not_found');
  const detail = await store.runDetail(user, slug, run.id);
  assert.equal(detail.findings.length, 1); assert.equal(detail.findings[0].id, finding.id);
  assert.equal(detail.run.verdict, 'COMMENT');
  assert.equal(JSON.stringify(detail).includes('synthetic-session-id'), false);
  assert.equal(Object.hasOwn(detail.run, 'input'), false);
  assert.equal(Object.hasOwn(detail.run, 'sessionId'), false);
  assert.equal(Object.hasOwn(detail.run, 'turnId'), false);
  passed('write intent CAS, durable receipts, atomic result finalization and safe public detail');

  let overview = await store.overview(user, slug);
  assert.equal(overview.totalReviews, 1); assert.equal(overview.stats.prsReviewed.value, 1);
  assert.equal(overview.stats.findings.value, 1); assert.equal(overview.recentPrs[0].approved, false);
  assert.equal(overview.ruleActivity[0].evaluations, 1); assert.equal(overview.ruleActivity[0].metPercentage, 0);
  assert.equal((await store.reviews(user, slug)).closed, 0);
  await denies(() => store.resolveFinding(other, slug, finding.id, { status: 'closed' }), 'not_found');
  await store.resolveFinding(user, slug, finding.id, { status: 'closed' });
  assert.equal((await store.reviews(user, slug)).closed, 1);
  assert.equal((await store.reviews(user, slug)).closureRate, 100);
  await store.markPullRequest({ installationId: '2001', repositoryId: '3001', prNumber: 1,
    merged: true, title: envelope.title, prUrl: envelope.prUrl });
  assert.equal((await store.reviews(user, slug, { merged: true })).findingsOnMergedPrs, 1);
  assert.equal((await store.settings(user, slug, 'billing')).usage.modelSpendUsd, null);
  assert.equal((await store.settings(user, slug, 'billing')).usage.estimatedModelCostUsd, 0.125);
  for (const section of ['users', 'installations', 'repositories', 'runs', 'audit']) assert.ok(await store.adminList(section));
  const changedBaseDelivery = randomUUID();
  await store.receiveDelivery({ deliveryId: changedBaseDelivery, event: 'pull_request', payload: { action: 'edited', fixtureBase: 'f'.repeat(40) } });
  const changedBase = await store.enqueueRun({ ...envelope, deliveryId: changedBaseDelivery, baseSha: 'f'.repeat(40), baseBranch: 'release' });
  assert.equal(changedBase.length, 1, 'an unchanged head with a new base/ref is a different review revision');
  const baseView = await store.overview(user, slug);
  assert.equal(baseView.recentPrs[0].approved, false);
  assert.equal(baseView.recentPrs[0].risk, null);
  assert.equal(baseView.recentPrs[0].status, 'queued');
  const baseRun = await store.claimRun(); assert.equal(baseRun.id, changedBase[0].id);
  assert.equal(baseRun.base_sha, 'f'.repeat(40)); assert.equal(baseRun.base_branch, 'release');
  // A second model pass can only start once and retains the organization's
  // baseline in a separate private column while clearing old upstream ids.
  let passRun = await store.transitionRun(baseRun.id, 'preparing', 'session_dispatch', { input,
    observation: { stage: 'organization_session_intent', payload: {} } });
  passRun = await store.transitionRun(baseRun.id, 'session_dispatch', 'session_created', { sessionId: 'synthetic-org-session',
    observation: { stage: 'organization_session_receipt', payload: {} } });
  passRun = await store.transitionRun(baseRun.id, 'session_created', 'turn_dispatch', { observation: { stage: 'organization_turn_intent', payload: {} } });
  passRun = await store.transitionRun(baseRun.id, 'turn_dispatch', 'running', { turnId: 'synthetic-org-turn',
    observation: { stage: 'organization_turn_receipt', payload: {} } });
  passRun = await store.transitionRun(baseRun.id, 'running', 'session_dispatch', { reviewPass: 'repository', baselineResult: result,
    sessionId: null, turnId: null, observation: { stage: 'repository_session_intent', payload: {} } });
  assert.equal(passRun.review_pass, 'repository'); assert.equal(passRun.session_id, null); assert.equal(passRun.turn_id, null);
  assert.deepEqual(passRun.baseline_result, result);
  passRun = await store.transitionRun(baseRun.id, 'session_dispatch', 'session_created', { sessionId: 'synthetic-repo-session',
    observation: { stage: 'repository_session_receipt', payload: {} } });
  passRun = await store.transitionRun(baseRun.id, 'session_created', 'turn_dispatch', { observation: { stage: 'repository_turn_intent', payload: {} } });
  passRun = await store.transitionRun(baseRun.id, 'turn_dispatch', 'running', { turnId: 'synthetic-repo-turn',
    observation: { stage: 'repository_turn_receipt', payload: {} } });
  await denies(() => store.transitionRun(baseRun.id, 'running', 'session_dispatch', { reviewPass: 'repository', baselineResult: result,
    observation: { stage: 'third_pass_intent', payload: {} } }), 'conflict');
  await denies(() => store.transitionRun(baseRun.id, 'running', 'post_dispatch', { result: { ...result, risk: 'low' },
    observation: { stage: 'post_intent', payload: { commit_id: head, event: 'APPROVE' } } }), 'runtime_policy_violation');
  await denies(() => store.transitionRun(baseRun.id, 'running', 'post_dispatch', { result: { ...result, findings: [] },
    observation: { stage: 'post_intent', payload: { commit_id: head, event: 'APPROVE' } } }), 'runtime_policy_violation');
  await store.transitionRun(baseRun.id, 'running', 'failed', { errorCode: 'synthetic_fixture_complete' });
  const changedDelivery = randomUUID();
  await store.receiveDelivery({ deliveryId: changedDelivery, event: 'pull_request', payload: { action: 'synchronize', fixtureHead: 'd'.repeat(40) } });
  // A fresh head can be outside review scope (for example, the PR became a
  // draft). Its existence still invalidates the old current-risk/approval view.
  assert.equal((await store.enqueueRun({ ...envelope, deliveryId: changedDelivery,
    headSha: 'd'.repeat(40), draft: true, prType: 'maintenance' })).length, 0);
  const changed = await store.overview(user, slug);
  assert.equal(changed.recentPrs[0].reviewIsCurrent, false);
  assert.equal(changed.recentPrs[0].approved, false);
  assert.equal(changed.recentPrs[0].risk, null);
  assert.equal(changed.recentPrs[0].findingsCount, null);
  assert.equal(changed.recentPrs[0].status, 'awaiting_review');
  assert.equal((await pool.query('SELECT risk FROM g8s_product.pull_requests WHERE owner_user_id=$1 AND pr_number=1', [user])).rows[0].risk, null);
  passed('analytics use saved results, explicit closure evidence and labelled estimate provenance');

  const commentPayload = { action: 'created', comment: { id: 5001, body: '@g8s help' } }, helpDelivery = randomUUID();
  await store.receiveDelivery({ deliveryId: helpDelivery, event: 'issue_comment', payload: commentPayload });
  const help = await store.enqueueRun({ ...envelope, deliveryId: helpDelivery, trigger: 'help',
    actorLogin: 'g8s-store-test-one', actorGithubId: '1001', actorType: 'User', draft: true, merged: true, state: 'closed' });
  assert.equal(help.length, 1);
  const helpRun = await store.claimRun(); assert.equal(helpRun.id, help[0].id);
  await store.setPause(user, { paused: true, reason: 'Pause before a model intent.' });
  assert.equal((await store.privateRunById(helpRun.id)).state, 'queued');
  assert.equal(await store.transitionRun(helpRun.id, 'preparing', 'post_dispatch', { input,
    observation: { stage: 'post_intent', payload: {} } }), null);
  assert.equal(await store.claimRun(), null);
  await store.setPause(user, { paused: false, reason: 'Resume only the saved test queue.' });
  const resumed = await store.claimRun(); assert.equal(resumed.id, helpRun.id);
  assert.equal(new Date(resumed.started_at).getTime(), new Date(helpRun.started_at).getTime());
  await store.transitionRun(resumed.id, 'preparing', 'held', { errorCode: 'synthetic_uncertain' });
  assert.equal((await store.recoverableRuns()).some(row => row.id === resumed.id), false);
  passed('help has no review-only draft/closed restriction and pause requeues only proven untouched preparation');

  await store.syncInstallationRepositories('2001', []);
  assert.equal((await store.listRepositories(user, slug)).repositories[0].enabled, false);
  assert.equal((await store.listRepositories(user, slug)).repositories[0].available, false);
  await store.syncInstallationRepositories('2001', [repo]);
  assert.equal((await store.listRepositories(user, slug)).repositories[0].enabled, false);
  assert.equal((await store.listRepositories(user, slug)).repositories[0].available, true);
  await store.disableInstallation('2001', 'installation_removed');
  assert.equal((await store.getInstallation('2001')).disabled_reason, 'installation_removed');
  await store.createSession({ sessionHash: '5'.repeat(64), userId: user, expiresAt: new Date(Date.now() + 300000) });
  await store.setLimits(other, user, { monthlyRunLimit: 0, maxConcurrentRuns: 1, disabled: true });
  assert.equal(await store.getSession('5'.repeat(64)), null);
  passed('repository removal never re-enables itself and disabled users lose sessions');

  const configured = new ProductStore(pool, { defaultMonthlyRunLimit: 7, maxConcurrentRuns: 2 });
  const three = await configured.upsertIdentity({ githubId: '7001', login: 'g8s-revocation-test', name: null, email: null, avatarUrl: null });
  const revocationUser = three.user.id, revocationOrg = three.organizations[0];
  assert.equal((await configured.usage(revocationUser)).monthlyRunLimit, 7);
  assert.equal((await configured.usage(revocationUser)).maxConcurrentRuns, 2);
  await store.upsertIdentity({ githubId: '7001', login: 'g8s-revocation-test', name: null, email: null, avatarUrl: null });
  assert.equal((await store.usage(revocationUser)).monthlyRunLimit, 7, 'later defaults cannot replace an existing allocation');
  await store.setLimits(other, revocationUser, { monthlyRunLimit: 3, maxConcurrentRuns: 1 });
  await configured.upsertIdentity({ githubId: '7001', login: 'g8s-revocation-test', name: null, email: null, avatarUrl: null });
  assert.equal((await configured.usage(revocationUser)).monthlyRunLimit, 3, 'administrator overrides remain authoritative');
  passed('owner-configured signup limits apply only at first identity creation');

  const revocationInstallation = { id: '7002', account: { id: '7001', login: three.user.login, type: 'User' }, repositorySelection: 'selected' };
  const revocationRepo = { id: '7003', name: 'fixture', fullName: three.user.login + '/fixture', private: true, defaultBranch: 'main' };
  const saveRevocationInstallation = { userId: revocationUser, orgId: revocationOrg.id, installation: revocationInstallation, repositories: [revocationRepo] };
  await store.saveInstallation(saveRevocationInstallation);
  await store.updateRepository(revocationUser, revocationOrg.slug, '7003', { enabled: true });
  const oauthFixture = { browserHash: '7'.repeat(64), purpose: 'signin', userId: null, returnPath: '/',
    verifier: 'G8S_PKCE_VERIFIER_PLACEHOLDER_FOR_TESTS_ONLY_03', expiresAt: new Date(Date.now() + 300000) };
  await store.createOAuth({ ...oauthFixture, stateHash: '6'.repeat(64) });
  const pendingBeforeRevocation = await store.consumeOAuth('6'.repeat(64), oauthFixture.browserHash);
  assert.ok(Number.isFinite(Date.parse(pendingBeforeRevocation.createdAt)));
  await store.createSession({ sessionHash: '8'.repeat(64), userId: revocationUser,
    oauthStartedAt: pendingBeforeRevocation.createdAt, expiresAt: new Date(Date.now() + 300000) });
  await pool.query('SELECT pg_sleep(0.005)');
  const revocationPayload = { action: 'revoked', sender: { id: 7001 } }, revocationDelivery = randomUUID();
  await store.receiveDelivery({ deliveryId: revocationDelivery, event: 'github_app_authorization', payload: revocationPayload });
  assert.equal(await store.getSession('8'.repeat(64)), null);
  assert.equal((await store.getInstallation('7002')).disabled_reason, 'authorization_revoked');
  assert.equal((await store.listRepositories(revocationUser, revocationOrg.slug)).repositories[0].enabled, false);
  const revokedAt = (await pool.query('SELECT authorization_revoked_at FROM g8s_product.users WHERE id=$1', [revocationUser])).rows[0].authorization_revoked_at;
  assert.ok(revokedAt);
  await denies(() => store.createSession({ sessionHash: '9'.repeat(64), userId: revocationUser,
    oauthStartedAt: pendingBeforeRevocation.createdAt, expiresAt: new Date(Date.now() + 300000) }), 'invalid_oauth_callback');
  await denies(() => store.saveInstallation({ ...saveRevocationInstallation, oauthStartedAt: pendingBeforeRevocation.createdAt }), 'invalid_oauth_callback');
  await store.upsertIdentity({ githubId: '7001', login: three.user.login, name: null, email: null, avatarUrl: null });
  assert.equal(new Date((await pool.query('SELECT authorization_revoked_at FROM g8s_product.users WHERE id=$1', [revocationUser])).rows[0].authorization_revoked_at).getTime(), new Date(revokedAt).getTime());
  await pool.query('SELECT pg_sleep(0.005)');
  await store.createOAuth({ ...oauthFixture, stateHash: 'a'.repeat(64) });
  const freshFlow = await store.consumeOAuth('a'.repeat(64), oauthFixture.browserHash);
  await store.createSession({ sessionHash: 'b'.repeat(64), userId: revocationUser,
    oauthStartedAt: freshFlow.createdAt, expiresAt: new Date(Date.now() + 300000) });
  assert.equal((await store.getSession('b'.repeat(64))).user.id, revocationUser);
  await store.saveInstallation({ ...saveRevocationInstallation, oauthStartedAt: freshFlow.createdAt });
  assert.equal((await store.getInstallation('7002')).disabled_reason, null);
  await store.updateRepository(revocationUser, revocationOrg.slug, '7003', { enabled: true });
  await pool.query('SELECT pg_sleep(0.005)');
  assert.equal((await store.receiveDelivery({ deliveryId: revocationDelivery, event: 'github_app_authorization', payload: revocationPayload })).duplicate, true);
  assert.equal((await store.getSession('b'.repeat(64))).user.id, revocationUser, 'replaying the original delivery preserves the newer sign-in');
  assert.equal((await store.getInstallation('7002')).disabled_reason, null);
  assert.equal((await store.listRepositories(revocationUser, revocationOrg.slug)).repositories[0].enabled, true);
  assert.equal(new Date((await pool.query('SELECT authorization_revoked_at FROM g8s_product.users WHERE id=$1', [revocationUser])).rows[0].authorization_revoked_at).getTime(), new Date(revokedAt).getTime(), 'replay does not advance the revocation watermark');
  const secondRevocationDelivery = randomUUID();
  assert.equal((await store.receiveDelivery({ deliveryId: secondRevocationDelivery, event: 'github_app_authorization', payload: revocationPayload })).duplicate, false);
  assert.equal(Number((await pool.query('SELECT count(*) AS count FROM g8s_product.webhook_deliveries WHERE delivery_id=ANY($1::text[])', [[revocationDelivery, secondRevocationDelivery]])).rows[0].count), 2, 'each distinct revocation delivery is retained despite matching bodies');
  assert.equal(await store.getSession('b'.repeat(64)), null, 'a new signed revocation delivery invalidates the newer sign-in');
  assert.equal((await store.getInstallation('7002')).disabled_reason, 'authorization_revoked');
  await denies(() => store.createSession({ sessionHash: 'c'.repeat(64), userId: revocationUser,
    oauthStartedAt: freshFlow.createdAt, expiresAt: new Date(Date.now() + 300000) }), 'invalid_oauth_callback');
  const beforeUnknown = Number((await pool.query('SELECT count(*) AS count FROM g8s_product.users')).rows[0].count);
  await store.receiveDelivery({ deliveryId: randomUUID(), event: 'github_app_authorization', payload: { action: 'revoked', sender: { id: 7009 } } });
  assert.equal(Number((await pool.query('SELECT count(*) AS count FROM g8s_product.users')).rows[0].count), beforeUnknown);
  const newButRevoked = await store.upsertIdentity({ githubId: '7009', login: 'g8s-first-signup-revoked', name: null, email: null, avatarUrl: null });
  await denies(() => store.createSession({ sessionHash: 'd'.repeat(64), userId: newButRevoked.user.id,
    oauthStartedAt: pendingBeforeRevocation.createdAt, expiresAt: new Date(Date.now() + 300000) }), 'invalid_oauth_callback');
  passed('ingress revocation fences stale callbacks, preserves newer sign-ins on delivery replay and persists pre-signup watermarks');

  for (let index = 0; index < 18; index++) await store.createSession({ sessionHash: (10000 + index).toString(16).padStart(64, '0'),
    userId: other, expiresAt: new Date(Date.now() + 300000) });
  assert.equal(Number((await pool.query('SELECT count(*) AS count FROM g8s_product.sessions WHERE user_id=$1', [other])).rows[0].count), 16);
  assert.equal(await store.getSession((10000).toString(16).padStart(64, '0')), null);
  assert.equal((await store.getSession((10017).toString(16).padStart(64, '0'))).user.id, other);
  await pool.query("UPDATE g8s_product.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [other]);
  await pool.query(`INSERT INTO g8s_product.oauth_states(state_hash,browser_hash,purpose,verifier,return_path,expires_at)
    SELECT lpad(to_hex(value+100000),64,'0'),$1,'signin',$2,'/',now()+interval '5 minutes' FROM generate_series(1,10000) value`,
  [oauthFixture.browserHash, oauthFixture.verifier]);
  await denies(() => store.createOAuth({ ...oauthFixture, stateHash: 'e'.repeat(64) }), 'rate_limited');
  assert.equal(Number((await pool.query('SELECT count(*) AS count FROM g8s_product.sessions WHERE user_id=$1', [other])).rows[0].count), 0);
  await pool.query("UPDATE g8s_product.oauth_states SET expires_at=now()-interval '1 second'");
  await store.createOAuth({ ...oauthFixture, stateHash: 'f'.repeat(64) });
  assert.equal(Number((await pool.query('SELECT count(*) AS count FROM g8s_product.oauth_states')).rows[0].count), 1);
  await store.consumeOAuth('f'.repeat(64), oauthFixture.browserHash);
  passed('OAuth admission and active sessions are bounded and expired rows are removed');

  const polled = [];
  for (let index = 0; index < 25; index++) {
    const id = randomUUID(); polled.push(id);
    await pool.query(`INSERT INTO g8s_product.runs(id,owner_user_id,org_id,repository_id,installation_id,delivery_id,
      pr_number,head_sha,base_sha,base_branch,title,pr_url,trigger,dedup_key,state,input,session_id,turn_id,created_at,updated_at,started_at)
      SELECT $1,owner_user_id,org_id,repository_id,installation_id,delivery_id,pr_number,head_sha,base_sha,base_branch,
        title,pr_url,trigger,$2,'running',input,'synthetic-fairness-session','synthetic-fairness-turn',
        now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '2 minutes'
      FROM g8s_product.runs WHERE id=$3`, [id, 'fairness-fixture-' + index, run.id]);
  }
  const progressBefore = (await pool.query('SELECT updated_at FROM g8s_product.runs WHERE id=$1', [polled[0]])).rows[0].updated_at;
  const firstPoll = await store.recoverableRuns(), secondPoll = await store.recoverableRuns();
  assert.equal(firstPoll.length, 20); assert.equal(secondPoll.length, 20);
  assert.equal(new Set([...firstPoll, ...secondPoll].map(row => row.id)).size, 25);
  assert.equal(new Date((await pool.query('SELECT updated_at FROM g8s_product.runs WHERE id=$1', [polled[0]])).rows[0].updated_at).getTime(), new Date(progressBefore).getTime());
  await pool.query("UPDATE g8s_product.runs SET started_at=now()-interval '2 hours' WHERE id=$1", [polled[0]]);
  assert.equal((await store.expireAbandoned()).observationTimeoutCount, 1);
  const timeout = await store.privateRunById(polled[0]);
  assert.equal(timeout.state, 'held'); assert.equal(timeout.error_code, 'observation_timeout');
  passed('recovery polling rotates beyond twenty jobs without fake progress and holds overdue observations');
  return completed;
}
