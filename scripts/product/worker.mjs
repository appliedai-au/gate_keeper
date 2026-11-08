/** Durable inbox/queue consumer. Never run in the webhook request path. */
import { randomUUID } from 'node:crypto';
import { COMMANDS, GITHUB_ID, SHA, parseCommand, inReviewScope, severityRank, riskRank, bounded } from './contracts.mjs';
import { projectRepository } from './github.mjs';
import { invokeOnce, checkTurn } from '../reviews/trueforge.mjs';
import { diffLineMap, observeProductReview, hasRepositoryGuidance, combineReviewPasses } from './trueforge.mjs';

const fail = code => { throw Object.assign(new Error(code), { code, status: 503 }); };
const abortedTransaction = error => ['40P01', '40001'].includes(error?.code);
const codeOf = error => abortedTransaction(error) ? 'database_transaction_aborted'
  : /^[a-z][a-z0-9_]{0,99}$/u.test(error?.code || '') ? error.code : 'operation_failed';
const markdown = value => String(value).replace(/@/gu, '@\u200b').replace(/[\\`*_{}\[\]()#+.!|<>~-]/gu, '\\$&');
const trimText = (value, max) => String(value || '').slice(0, max);
const codeBlock = value => {
  const longest = Math.max(2, ...[...String(value).matchAll(/`+/gu)].map(match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${String(value).replace(/@/gu, '@\u200b')}\n${fence}`;
};

export function reviewPublication(row, result, frontendOrigin) {
  const isReview = ['pull_request', 'review'].includes(row.trigger);
  const config = row.input?.configuration || row.configuration;
  let event = 'COMMENT';
  if (isReview && config.blockMergeSeverity !== 'off' &&
      result.findings.some(finding => severityRank(finding.severity) >= severityRank(config.blockMergeSeverity)))
    event = 'REQUEST_CHANGES';
  else if (isReview && config.autoApprove && result.findings.length === 0 &&
      riskRank(result.risk) <= riskRank(config.autoApproveMaxRisk)) event = 'APPROVE';
  const parts = ['## G8S Gatekeeper', markdown(trimText(result.summary, 3500))];
  if (isReview) {
    parts.push(`Risk: **${markdown(result.risk)}**. Findings: **${result.findings.length}**.`);
    for (const finding of result.findings.slice(0, 20)) {
      const fileLink = `https://github.com/${row.repository_full_name}/blob/${row.head_sha}/${finding.file.split('/').map(encodeURIComponent).join('/')}#L${finding.line}`;
      parts.push(`### ${markdown(trimText(finding.title, 120))}\n` +
        `[${markdown(finding.file)}:${finding.line}](${fileLink}) · ${markdown(finding.severity)}\n\n` +
        markdown(trimText(finding.explanation, 500)) + '\n\n' + codeBlock(trimText(finding.evidence, 400)) +
        `\n\nFinding ID: \`${finding.id}\``);
    }
    if (result.findings.length > 20) parts.push(`The remaining ${result.findings.length - 20} findings are listed in the run detail page.`);
    if (!result.findings.length) parts.push('No evidenced errors were returned for this diff. This review does not certify that the code is correct.');
  } else if (result.reply) parts.push(result.reply);
  if (row.org_slug) parts.push(`[Open this run](${frontendOrigin}/${encodeURIComponent(row.org_slug)}/runs/${row.id})`);
  parts.push('Commands: `@g8s review`, `@g8s explain <finding-id>`, `@g8s help`.');
  const body = parts.join('\n\n');
  if (Buffer.byteLength(body) > 60000) fail('publication_too_large');
  return { commit_id: row.head_sha, body, event };
}

export function createProductWorker({ store, github, client, runtime, frontendOrigin,
  schedule = setTimeout, unschedule = clearTimeout, ready = async () => true }) {
  let stopping = false, timer, busy = null;

  async function permittedRepositories(installation) {
    const githubClient = await github.installationClient(String(installation.github_installation_id));
    const repositories = [];
    for (const repo of await githubClient.repositories()) {
      if (await githubClient.mayCommand(repo.fullName, installation.owner_github_login, installation.owner_github_id)) repositories.push(repo);
    }
    return repositories;
  }

  async function processDelivery(delivery) {
    const payload = delivery.payload;
    // Authorization revocation is applied transactionally at verified ingress,
    // including when this model worker is disabled or the model host is down.
    if (['ping', 'github_app_authorization'].includes(delivery.event)) return;
    const installationId = String(payload.installation?.id || '');
    if (!GITHUB_ID.test(installationId)) fail('invalid_webhook');
    const installation = await store.getInstallation(installationId);
    if (!installation) return;
    if (delivery.event === 'installation') {
      if (['deleted', 'suspend'].includes(payload.action))
        await store.disableInstallation(installationId, payload.action === 'deleted' ? 'installation_removed' : 'installation_suspended');
      // Re-enabling needs a fresh user-authorized installation verification.
      return;
    }
    if (installation.disabled_reason) return;
    if (delivery.event === 'installation_repositories') {
      await store.syncInstallationRepositories(installationId, await permittedRepositories(installation));
      return;
    }
    const repository = projectRepository(payload.repository);
    const githubClient = await github.installationClient(installationId, repository.id);
    let command = null, number;
    if (delivery.event === 'pull_request') {
      if (!['opened', 'reopened', 'synchronize', 'ready_for_review', 'edited', 'closed'].includes(payload.action)) return;
      number = payload.pull_request?.number;
    } else {
      if (payload.action !== 'created') return;
      command = parseCommand(payload.comment?.body);
      if (!command) return;
      if (delivery.event === 'issue_comment' && !payload.issue?.pull_request) return;
      number = delivery.event === 'issue_comment' ? payload.issue.number : payload.pull_request?.number;
      if (!['User', 'Bot'].includes(payload.comment?.user?.type) ||
          !await githubClient.mayCommand(repository.fullName, payload.comment?.user?.login, payload.comment?.user?.id)) return;
    }
    // The signed webhook is a notification. Current PR identity, selected repo
    // access, and permission are checked against GitHub before queue admission.
    const pr = await githubClient.pullRequest(repository.fullName, number);
    if (!await githubClient.mayCommand(repository.fullName, installation.owner_github_login, installation.owner_github_id)) return;
    if (delivery.event === 'pull_request' && payload.action === 'closed') {
      await store.markPullRequest({ installationId, repositoryId: repository.id, prNumber: number,
        merged: pr.merged === true, title: pr.title, prUrl: pr.html_url,
        headSha: pr.head.sha, baseSha: pr.base.sha, baseBranch: pr.base.ref });
      return;
    }
    await store.enqueueRun({ deliveryId: delivery.deliveryId, installationId, repositoryId: repository.id,
      prNumber: number, headSha: pr.head.sha, baseSha: pr.base.sha, title: pr.title, prUrl: pr.html_url,
      prType: (() => {
        const labels = (pr.labels || []).map(label => typeof label === 'string' ? label : label.name)
          .filter(name => typeof name === 'string' && /^type:\s*\S/u.test(name)).map(name => name.slice(5).trim());
        return labels.length === 1 && bounded(labels[0], 100, 1) ? labels[0] : 'Unclassified';
      })(),
      authorLogin: pr.user.login, authorType: pr.user.type, baseBranch: pr.base.ref,
      draft: pr.draft === true, merged: pr.merged === true, state: pr.state,
      trigger: command?.command || 'pull_request', actorLogin: command ? payload.comment.user.login : null,
      actorGithubId: command ? String(payload.comment.user.id) : null,
      actorType: command ? payload.comment.user.type : null, findingId: command?.findingId || null });
  }

  async function currentAccess(row) {
    const access = await github.installationClient(String(row.github_installation_id), String(row.github_repository_id));
    if (!await access.mayCommand(row.repository_full_name, row.owner_github_login, row.owner_github_id)) fail('repository_access_revoked');
    if (row.actor_login && !await access.mayCommand(row.repository_full_name, row.actor_login, row.actor_github_id)) fail('command_access_revoked');
    const pr = await access.pullRequest(row.repository_full_name, row.pr_number);
    if (['pull_request', 'review'].includes(row.trigger) &&
        (pr.head.sha !== row.head_sha || pr.base.sha !== row.base_sha || pr.base.ref !== row.base_branch ||
          !inReviewScope(pr, row.configuration))) fail('pull_request_changed');
    // The actual current head is fixed when help/explain are admitted too. An
    // old result is never presented as a review of a different revision.
    if (pr.head.sha !== row.head_sha || pr.base.sha !== row.base_sha || pr.base.ref !== row.base_branch)
      fail('pull_request_changed');
    return { access, pr };
  }
  function assertBinding(row) {
    if (row.input?.binding?.sourceCommit !== runtime.sourceCommit || row.input?.binding?.runtimeDigest !== runtime.runtimeDigest)
      fail('runtime_changed');
  }

  async function markFailure(row, error, uncertain = false) {
    const code = codeOf(error);
    if (code === 'runs_paused') return;
    const held = uncertain || ['session_dispatch', 'turn_dispatch', 'post_dispatch', 'summary_dispatch', 'review_posted'].includes(row.state) ||
      code === 'runtime_policy_violation' || code === 'runtime_changed';
    let estimate = error?.estimatedCostUsd;
    if (row.review_pass === 'repository') estimate = Number.isFinite(estimate) && Number.isFinite(row.baseline_result?.estimatedCostUsd)
      ? estimate + row.baseline_result.estimatedCostUsd : null;
    const knownCost = Number.isFinite(estimate) && estimate >= 0 &&
      error.costSource === 'trueforge_metrics_estimate' ? { estimatedCostUsd: estimate, costSource: error.costSource } : {};
    await store.transitionRun(row.id, row.state, held ? 'held' : 'failed', { errorCode: code, ...knownCost }).catch(() => {});
  }

  async function prepare(row) {
    const { access, pr } = await currentAccess(row);
    if (!SHA.test(pr.base?.sha || '')) fail('invalid_github_response');
    const input = { binding: { sourceCommit: runtime.sourceCommit, runtimeDigest: runtime.runtimeDigest },
      configuration: row.configuration, organizationConfiguration: row.organization_configuration,
      pullRequest: { number: row.pr_number, title: pr.title, body: trimText(pr.body, 32000),
        headSha: row.head_sha, baseSha: pr.base.sha, targetBranch: pr.base.ref },
      rules: (row.rules || []).map(rule => ({ ...rule, enabled: true })) };
    if (['help', 'explain'].includes(row.trigger)) {
      const result = { summary: row.trigger === 'help' ? 'G8S command reference' : 'Evidence from a saved G8S finding',
        findings: [], ruleEvaluations: [], risk: null, estimatedCostUsd: null, costSource: null };
      if (row.trigger === 'help') result.reply = COMMANDS.map(command => `- \`${command.command}\` — ${markdown(command.description)}`).join('\n') +
        '\n\nCommands require repository write permission and an enabled G8S repository. The review command reads code; it does not modify, merge, or deploy it.';
      else {
        const finding = await store.getFindingForRun(row, row.finding_id);
        result.reply = `**${markdown(finding.title)}**\n\n${markdown(finding.file)}:${finding.line}\n\n` +
          markdown(finding.explanation) + '\n\n' + codeBlock(finding.evidence) +
          `\n\nSaved finding: \`${finding.id}\`. This explanation uses the saved review; it makes no model call.`;
      }
      const proposed = { ...row, input, result };
      const publication = reviewPublication(proposed, result, frontendOrigin);
      const claimed = await store.transitionRun(row.id, 'preparing', 'post_dispatch', { input, result,
        observation: { stage: 'post_intent', payload: publication } });
      if (!claimed || stopping) return;
      return publish(claimed, publication, access);
    }
    input.files = await access.files(row.repository_full_name, row.base_sha, row.head_sha, pr.changed_files);
    if (!input.files.length) fail('empty_diff');
    diffLineMap(input.files);
    input.repositoryInstructions = await access.instructions(row.repository_full_name, pr.base.sha);
    await currentAccess(row); // Refuse a retarget/base/head change during preparation.
    const proposed = { ...row, input };
    const request = runtime.request(proposed, 'session');
    const claimed = await store.transitionRun(row.id, 'preparing', 'session_dispatch', { input, model: runtime.model,
      observation: { stage: 'organization_session_intent', payload: request } });
    if (!claimed || stopping) return;
    return dispatchSession(claimed, request);
  }

  async function dispatchSession(claimed, request) {
    try {
      const receipt = (await invokeOnce(options => client.sessions.create(request, options))).data;
      const sessionId = runtime.checkSession(receipt, claimed);
      const next = await store.transitionRun(claimed.id, 'session_dispatch', 'session_created', { sessionId,
        observation: { stage: `${claimed.review_pass || 'organization'}_session_receipt`, payload: receipt } });
      if (next && !stopping) await advance(next);
    } catch (error) { await markFailure(claimed, error, true); }
  }

  async function publish(row, publication, suppliedAccess = null) {
    try {
      const access = suppliedAccess || (await currentAccess(row)).access;
      const receipt = await access.postReview(row.repository_full_name, row.pr_number, publication);
      const next = await store.transitionRun(row.id, 'post_dispatch', 'review_posted', { githubReviewId: receipt.id,
        observation: { stage: 'post_receipt', payload: receipt } });
      if (next && !stopping) await complete(next);
    } catch (error) { await markFailure(row, error, true); }
  }

  async function complete(row) {
    assertBinding(row);
    // Review summaries are always published in the review. Updating a PR's own
    // description is deliberately not performed without an atomic GitHub body
    // update contract. The configuration capability reports this as unwired.
    await store.finishRun(row.id, { ...row.result, githubReviewId: row.github_review_id });
  }

  async function advance(row) {
    try {
      if (stopping) return;
      if (row.state === 'preparing') return await prepare(row);
      assertBinding(row);
      if (row.state === 'review_posted') return await complete(row);
      if (row.state === 'session_created') {
        await currentAccess(row);
        const request = runtime.request(row, 'turn');
        const claimed = await store.transitionRun(row.id, 'session_created', 'turn_dispatch', {
          observation: { stage: `${row.review_pass || 'organization'}_turn_intent`, payload: request } });
        if (!claimed || stopping) return;
        try {
          const receipt = (await invokeOnce(options => client.sessions.createTurn(row.session_id, request, options))).data;
          const turnId = checkTurn(receipt, row.session_id, null, request.input);
          await store.transitionRun(row.id, 'turn_dispatch', 'running', { turnId,
            observation: { stage: `${row.review_pass || 'organization'}_turn_receipt`, payload: receipt } });
        } catch (error) { await markFailure(claimed, error, true); }
        return;
      }
      if (row.state === 'running') {
        const observed = await observeProductReview({ client, row, runtime });
        if (!observed) return;
        try {
          if ((row.review_pass || 'organization') === 'organization' && hasRepositoryGuidance(row.input)) {
            await currentAccess(row);
            const proposed = { ...row, review_pass: 'repository', baseline_result: observed, session_id: null, turn_id: null };
            const request = runtime.request(proposed, 'session');
            const claimed = await store.transitionRun(row.id, 'running', 'session_dispatch', {
              reviewPass: 'repository', baselineResult: observed, sessionId: null, turnId: null,
              observation: { stage: 'repository_session_intent', payload: request } });
            if (claimed && !stopping) await dispatchSession(claimed, request);
            return;
          }
          const result = row.review_pass === 'repository' ? combineReviewPasses(row.baseline_result, observed) : observed;
          result.findings = result.findings.map(finding => ({ ...finding, id: randomUUID() }));
          const { access } = await currentAccess(row);
          const publication = reviewPublication(row, result, frontendOrigin);
          const claimed = await store.transitionRun(row.id, 'running', 'post_dispatch', { result,
            estimatedCostUsd: result.estimatedCostUsd, costSource: result.costSource, risk: result.risk,
            observation: { stage: 'post_intent', payload: publication } });
          if (claimed && !stopping) await publish(claimed, publication, access);
        } catch (error) {
          // markFailure adds a saved organization-pass cost exactly once. Carry
          // this observed pass only, even if publication construction had already
          // combined both passes before access or policy checks failed.
          error.estimatedCostUsd = observed.estimatedCostUsd;
          error.costSource = observed.costSource;
          throw error;
        }
      }
    } catch (error) {
      // Upstream GET failures can be observed again; a terminal parse/policy
      // violation is retained as a real failed/held run, never an empty success.
      if (row.state === 'running' && ['result_unavailable', 'dispatch_uncertain', 'review_unavailable'].includes(error.code)) return;
      await markFailure(row, error);
    }
  }

  async function tick() {
    if (stopping || busy) return;
    busy = (async () => {
      if (!await ready()) return;
      await store.expireAbandoned();
      const delivery = await store.claimDelivery();
      if (delivery) {
        try { await processDelivery(delivery); await store.finishDelivery(delivery.deliveryId, { status: 'processed' }); }
        catch (error) {
          // Intake performs no inference or review publication. A confirmed
          // transaction abort can be retried after the durable inbox lease;
          // command/run deduplication remains in PostgreSQL. This policy never
          // retries outbound model or publication intents with uncertain receipts.
          if (delivery.attempts >= 5 || !(abortedTransaction(error) ||
              ['github_unavailable', 'result_unavailable'].includes(error.code)))
            await store.finishDelivery(delivery.deliveryId, { status: 'failed', code: codeOf(error) });
        }
      }
      for (const row of await store.recoverableRuns()) {
        if (stopping) return;
        await advance(row);
      }
      if (!stopping) {
        const row = await store.claimRun();
        if (row) await advance(row);
      }
    })();
    try { await busy; } finally { busy = null; }
  }
  async function loop() {
    try { await tick(); } catch { /* Fixed public statuses, no raw errors or private input logs. */ }
    if (!stopping) { timer = schedule(loop, 2000); timer?.unref?.(); }
  }
  return { tick, processDelivery, advance,
    start() { if (!stopping && !timer) { timer = schedule(loop, 0); timer?.unref?.(); } },
    stop() { stopping = true; if (timer) unschedule(timer); },
    async drained() { await busy?.catch(() => {}); },
  };
}
