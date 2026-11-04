// Editor-runtime alternative. Include the two shared helper modules when
// integrating with the verified existing app layout. Never deploy both variants.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createLearningStatusBackend } from '../shared/learning-status-backend.js';

const handle = createLearningStatusBackend({
  authenticate: request => createClientFromRequest(request).auth.me(),
  readSecret: name => Deno.env.get(name),
});

Deno.serve(handle);
