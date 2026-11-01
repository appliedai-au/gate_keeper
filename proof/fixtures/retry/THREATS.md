# Threat model (adversarial tests)
- T1: Invalid `attempts` (0, negative, fractional, NaN) throws RangeError before calling fn.
- T2: Backoff is capped at 30000 ms so large attempt counts cannot sleep for hours or overflow.
- T3: An error thrown by `sleep` propagates instead of being swallowed.
