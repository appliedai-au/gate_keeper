# Threat model (adversarial tests)
- T1: page must be an integer >= 1; 0, negative, fractional, NaN or non-number pages throw RangeError (never silently return another page's data).
- T2: For a non-empty list, a page beyond the last page throws RangeError.
- T3: size validation still holds (0, negative, fractional sizes throw RangeError).
