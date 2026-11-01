# Threat model (adversarial tests)
- T1: Malformed or ambiguous amounts ("1e3", "-1.00", "12.345", "0x10", "12.", "", " ") must be rejected, never silently mis-parsed.
- T2: Non-string input must throw TypeError.
