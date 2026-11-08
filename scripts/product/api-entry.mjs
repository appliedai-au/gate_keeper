import { createProductApiServer } from './api-server.mjs';
let service;
try {
  service = await createProductApiServer();
  await new Promise((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(service.config.port, '::', () => {
      service.server.off('error', reject); resolve();
    });
  });
  console.log(JSON.stringify({ event: 'G8S_API_LISTENING', sourceCommit: service.config.sourceCommit,
    configured: service.configured, worker: 'not_in_this_service',
    missingGitHubBindings: service.config.missingGitHubBindings }));
  let closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    try { await service.close(); clearTimeout(deadline); }
    catch { process.exitCode = 1; console.error('G8S_API_SHUTDOWN_FAILED'); }
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  service.server.on('error', () => { process.exitCode = 1; void stop(); });
} catch {
  console.error('G8S_API_STARTUP_REFUSED');
  process.exitCode = 1;
  const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
  try { await service?.close(); } catch { /* Never log private configuration/errors. */ }
  clearTimeout(deadline);
}
