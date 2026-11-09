# Threat model (adversarial tests)
- T1: Invalid versions throw TypeError rather than being ordered: missing parts ("1.2"), extra parts ("1.2.3.4"), a "v" prefix, leading zeros in a core part ("01.2.3") or in a numeric pre-release identifier ("1.2.3-01"), empty identifiers ("1.2.3-", "1.2.3-a..b"), and non-strings.
