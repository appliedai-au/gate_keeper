// Explicit completed-history adapter; its portable validation stays unchanged.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { createLearningHistoryBackend } from '../../../../shared/learning-history-backend.js';

export default async function gatekeeperLearningHistory(request: Request) {
  const handle = createLearningHistoryBackend({
    authenticate: (incoming: Request) => createClientFromRequest(incoming).auth.me(),
    readSecret: (name: string) => secrets.get(name),
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      // workerd lacks redirect:error. Preserve that policy with manual + reject.
      if (init?.redirect !== 'error') throw new TypeError('Unexpected upstream redirect policy');
      const response = await fetch(input, { ...init, redirect: 'manual' });
      const status = response.status;
      if ((status >= 300 && status <= 399) || response.redirected)
        throw new TypeError('Upstream redirect rejected');
      return response;
    },
  });
  return handle(request);
}
