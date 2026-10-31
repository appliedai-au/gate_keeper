# Threat model (adversarial tests)
- T1: Attribute breakout: double and single quotes are escaped (&quot; and &#39;), so href or text cannot close the attribute or tag.
- T2: Script URLs are rejected: link() throws an Error with code "E_UNSAFE_URL" for any scheme other than http, https or mailto (e.g. javascript:, data:, vbscript:).
- T3: Scheme checks are case-, whitespace- and control-character-insensitive: "  JaVaScRiPt:alert(1)", "java\tscript:x" and "\u0000javascript:x" are rejected.
