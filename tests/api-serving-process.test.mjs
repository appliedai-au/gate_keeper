import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../scripts/product/api-entry.mjs', import.meta.url));
test('actual product entrypoint serves setup-required, reports no worker and exits cleanly', { timeout: 15000 }, async t => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'], env: {
    PATH: process.env.PATH, PORT: String(port), STANDALONE: 'false', G8S_API_SERVICE: 'enabled',
    RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40), G8S_PRODUCT_SOURCE_COMMIT: 'a'.repeat(40),
    G8S_PRODUCT_ENABLED: 'disabled', G8S_PRODUCT_WORKER_ENABLED: 'disabled',
    G8S_PUBLIC_API_ORIGIN: 'https://gate.g8s.test', G8S_FRONTEND_ORIGIN: 'https://g8s.test',
  } });
  let stdout = '', stderr = '', launchError;
  child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  child.once('error', error => { launchError = error; });
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  t.after(async () => { child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited; clearTimeout(kill); });
  let ready = false;
  for (let n = 0; n < 100 && !ready; n++) {
    if (launchError || child.exitCode !== null) assert.fail('entrypoint exited: ' + (launchError?.message || stderr));
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(100) });
      ready = response.status === 200; await response.text(); } catch { /* Process is starting. */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(ready, true);
  const response = await fetch(`http://127.0.0.1:${port}/gatekeeper/product-v1/session`, {
    headers: { Origin: 'https://g8s.test' }, signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'setup_required');
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://g8s.test');
  const receipt = stdout.trim().split('\n').map(line => JSON.parse(line)).find(row => row.event === 'G8S_API_LISTENING');
  assert.equal(receipt.configured, false); assert.equal(receipt.worker, 'not_in_this_service');
  assert.ok(receipt.missingGitHubBindings.includes('G8S_GITHUB_CLIENT_SECRET'));
  child.kill('SIGTERM'); assert.deepEqual(await exited, { code: 0, signal: null });
  assert.equal(stderr, '');
});
