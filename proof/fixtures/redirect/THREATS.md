# Threat model (adversarial tests)
- T1: Open redirect: absolute URLs ("https://evil.test", "http://evil.test/x") must not be returned.
- T2: Scheme-relative and backslash tricks ("//evil.test", "/\\evil.test", "\\\\evil.test", "/%2F%2Fevil.test" after decoding by the browser) must not be returned.
- T3: Script and data schemes ("javascript:alert(1)", " JaVaScRiPt:x") and control characters ("/\tevil", "/\nx") must not be returned.
