/** Compact, append-only authority changes over the existing durable journal. */
import { canonical, copy, digest, record, requireThat } from './contracts.mjs';

function changes(before, after, path = [], result = []) {
  if (canonical(before) === canonical(after)) return result;
  if (before && after && typeof before === 'object' && typeof after === 'object' &&
      Array.isArray(before) === Array.isArray(after)) {
    if (Array.isArray(after)) {
      requireThat(after.length >= before.length, 'authority arrays cannot discard history');
      after.forEach((value, index) => {
        if (index >= before.length) result.push({ path: [...path, index], value: copy(value) });
        else changes(before[index], value, [...path, index], result);
      });
    } else {
      requireThat(Object.keys(before).every(key => Object.hasOwn(after, key)), 'authority cannot remove evidence');
      for (const key of Object.keys(after)) {
        if (!Object.hasOwn(before, key)) result.push({ path: [...path, key], value: copy(after[key]) });
        else changes(before[key], after[key], [...path, key], result);
      }
    }
  } else result.push({ path, value: copy(after) });
  return result;
}

function apply(state, change) {
  record(change, ['path', 'value'], 'authority journal change');
  requireThat(Array.isArray(change.path) && change.path.length > 0 && change.path.length < 64,
    'authority journal path');
  let target = state;
  for (const [index, key] of change.path.entries()) {
    requireThat((typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key)) ||
      Number.isSafeInteger(key) && key >= 0, 'authority journal key');
    requireThat(target && typeof target === 'object', 'authority journal target');
    if (Array.isArray(target)) requireThat(Number.isSafeInteger(key) && key <= target.length,
      'authority journal array index');
    if (index === change.path.length - 1) target[key] = copy(change.value);
    else {
      requireThat(Object.hasOwn(target, key), 'authority journal absent parent');
      target = target[key];
    }
  }
}

export class AuthorityLedger {
  #journal; #binding; #initial; #clock; #tail = Promise.resolve();
  constructor({ journal, binding, initial, clock = () => Date.now() }) {
    requireThat(journal && typeof journal.read === 'function' && typeof journal.append === 'function',
      'authority journal unavailable');
    this.#journal = journal; this.#binding = copy(binding); this.#initial = copy(initial); this.#clock = clock;
  }
  async #read() {
    const snapshot = await this.#journal.read();
    let state = null;
    for (const [index, event] of snapshot.events.entries()) {
      requireThat(event.schema === 'gk-detached-authority-event-v1' &&
        canonical(event.binding) === canonical(this.#binding), 'authority journal binding drift');
      if (index === 0) {
        requireThat(event.kind === 'initialized' && event.previousDigest === null,
          'authority journal initialization');
        state = copy(event.state);
      } else {
        requireThat(state && event.previousDigest === digest(state) && Array.isArray(event.changes),
          'authority journal state chain');
        for (const change of event.changes) apply(state, change);
      }
      requireThat(event.stateDigest === digest(state), 'authority journal state digest');
    }
    return { head: snapshot.head, state };
  }
  async initialize() {
    return this.#exclusive(async () => {
      const { head, state } = await this.#read();
      if (state) return copy(state);
      requireThat(head === null, 'authority journal has no state');
      const initial = copy(this.#initial);
      await this.#journal.append(null, { schema: 'gk-detached-authority-event-v1',
        binding: this.#binding, kind: 'initialized', recordedAt: new Date(this.#clock()).toISOString(),
        previousDigest: null, stateDigest: digest(initial), state: initial });
      return initial;
    });
  }
  async read() {
    const { state } = await this.#read();
    requireThat(state, 'authority not initialized');
    return state;
  }
  #exclusive(action) {
    const work = this.#tail.then(action);
    this.#tail = work.catch(() => {});
    return work;
  }
  async change(kind, action) {
    return this.#exclusive(async () => {
      const { head, state } = await this.#read();
      requireThat(state, 'authority not initialized');
      const next = copy(state);
      const value = await action(next);
      const patch = changes(state, next);
      if (patch.length) await this.#journal.append(head, { schema: 'gk-detached-authority-event-v1',
        binding: this.#binding, kind, recordedAt: new Date(this.#clock()).toISOString(),
        previousDigest: digest(state), stateDigest: digest(next), changes: patch });
      return value;
    });
  }
}
