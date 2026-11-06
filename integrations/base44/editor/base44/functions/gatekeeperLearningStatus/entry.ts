// Hosted editor adapter only. The qualified portable backend owns all validation.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { createLearningStatusBackend } from '../../../../shared/learning-status-backend.js';

const BINDINGS = [
  'GATEKEEPER_LEARNING_OWNER_ID', 'GATEKEEPER_LEARNING_EXPERIMENT_ID',
  'GATEKEEPER_LEARNING_SOURCE_COMMIT', 'GATEKEEPER_LEARNING_READ_TOKEN',
] as const;
type Binding = typeof BINDINGS[number];
type ErrorKind = 'timeout' | 'dns' | 'tls' | 'network' | 'unsupported-option' | 'other';
type Observation =
  | { event: 'GK_LS_SECRET_BEGIN'; binding?: Binding }
  | { event: 'GK_LS_SECRET_RESULT'; binding?: Binding; nonemptyString: boolean }
  | { event: 'GK_LS_SECRET_ERROR'; binding?: Binding; kind: ErrorKind }
  | { event: 'GK_LS_FETCH_BEGIN' }
  | { event: 'GK_LS_FETCH_RESULT'; status?: number }
  | { event: 'GK_LS_FETCH_ERROR'; kind: ErrorKind };

function observe(value: Observation) {
  try { console.info(value); } catch { /* Diagnostics must not change the result. */ }
}

// Read only bounded classification hints, never log them or an error object.
function errorKind(error: unknown): ErrorKind {
  try {
    const field = (value: unknown, key: string, maximum: number) => {
      if (value === null || typeof value !== 'object') return '';
      const text = (value as Record<string, unknown>)[key];
      return typeof text === 'string' ? text.slice(0, maximum) : '';
    };
    const name = field(error, 'name', 80);
    const cause = error !== null && typeof error === 'object'
      ? (error as Record<string, unknown>).cause : null;
    const hints = [name, field(error, 'code', 80), field(error, 'message', 1024), field(cause, 'code', 80)].join(' ');
    if (name === 'AbortError' || name === 'TimeoutError' || /\bETIMEDOUT\b|timed?\s*out|timeout/i.test(hints)) return 'timeout';
    if (/\bENOTFOUND\b|\bEAI_AGAIN\b|\bDNS\b|name or service not known|failed to lookup address/i.test(hints)) return 'dns';
    if (/\bTLS\b|\bSSL\b|CERT_|certificate/i.test(hints)) return 'tls';
    if (/unsupported|not implemented|not supported|invalid/i.test(hints) &&
        /\bcache\b|\bredirect\b|\bsignal\b|\boption\b|\bRequestInit\b/i.test(hints)) return 'unsupported-option';
    if (/\bECONNRESET\b|\bECONNREFUSED\b|\bENETUNREACH\b|\bEHOSTUNREACH\b|\bEPIPE\b|fetch failed|network|error sending request|connection (?:reset|refused|closed)|socket/i.test(hints)) return 'network';
  } catch { /* Host error getters may throw; the original error still propagates. */ }
  return 'other';
}

export default async function gatekeeperLearningStatus(request: Request) {
  // Construct inside the invocation, after hosted runtime globals are available.
  const handle = createLearningStatusBackend({
    authenticate: (incoming: Request) => createClientFromRequest(incoming).auth.me(),
    readSecret: async (name: string) => {
      const binding = BINDINGS.includes(name as Binding) ? { binding: name as Binding } : {};
      observe({ event: 'GK_LS_SECRET_BEGIN', ...binding });
      try {
        const value = await secrets.get(name);
        observe({ event: 'GK_LS_SECRET_RESULT', ...binding,
          nonemptyString: typeof value === 'string' && value.length > 0 });
        return value;
      } catch (error) {
        observe({ event: 'GK_LS_SECRET_ERROR', ...binding, kind: errorKind(error) });
        throw error;
      }
    },
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      observe({ event: 'GK_LS_FETCH_BEGIN' });
      try {
        // workerd lacks redirect:error. Preserve that policy with manual + reject.
        if (init?.redirect !== 'error') throw new TypeError('Unexpected upstream redirect policy');
        const response = await fetch(input, { ...init, redirect: 'manual' });
        const responseStatus = response.status;
        if ((responseStatus >= 300 && responseStatus <= 399) || response.redirected)
          throw new TypeError('Upstream redirect rejected');
        let status: number | undefined;
        try {
          if (Number.isSafeInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599) status = responseStatus;
        } catch { /* A diagnostic read cannot replace a returned response. */ }
        observe({ event: 'GK_LS_FETCH_RESULT', ...(status === undefined ? {} : { status }) });
        return response;
      } catch (error) {
        observe({ event: 'GK_LS_FETCH_ERROR', kind: errorKind(error) });
        throw error;
      }
    },
  });
  return handle(request);
}
