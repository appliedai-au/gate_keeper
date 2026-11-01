# Architecture (integration tests)
- One limiter instance serves all keys; size() reports tracked keys and sweep(now) is called periodically by the server.
