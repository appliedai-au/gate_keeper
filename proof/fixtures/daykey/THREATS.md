# Threat model (adversarial tests)
- T1: A timestamp that is not a finite number (NaN, Infinity, a string, null) throws TypeError instead of producing a bogus day or "Invalid Date".
