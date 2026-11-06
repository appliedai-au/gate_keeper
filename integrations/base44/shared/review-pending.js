import { keysAre, validId } from './review-contract.js';

const terminal = job => ['complete', 'failed'].includes(job?.state);

/** Browser references are recovery hints; the server retains all job custody. */
export function parsePendingRequest(text) {
  try {
    const value = JSON.parse(text);
    if (!keysAre(value, ['key', 'jobId']) ||
        !(value.key === null || validId(value.key)) ||
        !(value.jobId === null || validId(value.jobId)) ||
        (value.key === null && value.jobId === null)) return null;
    return { key: value.key, jobId: value.jobId };
  } catch { return null; }
}

export function pendingAfterReply(pending, reply) {
  if (reply.job && !terminal(reply.job))
    return { key: reply.job.requestKey, jobId: reply.job.id };
  if (!pending) return null;
  const matched = [reply.job, ...reply.jobs].find(job => job &&
    (job.id === pending.jobId || job.requestKey === pending.key));
  if (!matched) return pending;
  return terminal(matched) ? null : { key: matched.requestKey, jobId: matched.id };
}
