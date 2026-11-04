// Explicit status-only process. Never included in the production Dockerfile CMD.
import { startConfiguredReadOnlyStatus } from './status-config.mjs';
await startConfiguredReadOnlyStatus({
  path: '/var/lib/gk-v2-private-journal/status-config.json',
});
