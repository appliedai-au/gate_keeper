// Hosted editor adapter only. The portable bridge owns auth and validation.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { createReviewBridge } from '../../../../shared/review-backend.js';

export default async function gatekeeperReview(request: Request) {
  // Resolve runtime bindings inside this invocation, never at module load.
  const handle = createReviewBridge({
    authenticate: (incoming: Request) => createClientFromRequest(incoming).auth.me(),
    readEnv: (name: string) => secrets.get(name),
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
