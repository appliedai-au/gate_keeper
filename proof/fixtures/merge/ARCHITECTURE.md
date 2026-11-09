# Architecture (integration tests)
- The workspace defaults object is shared by every request in the process. deepMerge and effectiveSettings must return a new object and must not modify either input, at any depth.
