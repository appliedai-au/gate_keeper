// CLI-runtime alternative, staged source only. Include both shared helper files
// in the verified function bundle; preserve the existing app's other functions.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { secrets } from 'base44:runtime';
import { createLearningStatusBackend } from '../../../../shared/learning-status-backend.js';

const handle = createLearningStatusBackend({
  authenticate: (request: Request) => createClientFromRequest(request).auth.me(),
  readSecret: (name: string) => secrets.get(name),
});

export default async function gatekeeperLearningStatus(request: Request) {
  return handle(request);
}
