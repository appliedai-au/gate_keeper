# Architecture (integration tests)
- `sleep` is injected; retry never uses timers directly, so callers and tests control waiting.
