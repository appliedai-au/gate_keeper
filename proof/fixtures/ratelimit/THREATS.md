# Threat model (adversarial tests)
- T1: Burst at a boundary. A client must not get 2 x limit requests through by sending `limit` just before and `limit` just after a fixed window boundary.
- T2: API keys are client-supplied strings. Any string, including "__proto__", "constructor" and "toString", must behave like any other key.
- T3: Memory stays bounded: after sweep(now), keys with no allowed request in (now - windowMs, now] are no longer tracked.
