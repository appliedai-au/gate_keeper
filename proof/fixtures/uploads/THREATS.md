# Threat model (adversarial tests)
- T1: Directory traversal ("../etc/passwd", "a/../../etc/shadow", "reports/../../..") must not escape UPLOAD_ROOT.
- T2: Absolute paths ("/etc/passwd") are attacker-controlled locations and must be rejected (E_TRAVERSAL).
- T3: NUL bytes ("a.txt\u0000.png") must be rejected (E_TRAVERSAL).
- T4: Tricky-but-safe names ("....//x", "..foo/bar") that stay inside the root must still resolve inside it.
