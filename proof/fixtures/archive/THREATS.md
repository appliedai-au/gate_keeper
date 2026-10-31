# Threat model (adversarial tests)
- T1: Zip-slip traversal ("../../etc/cron.d/x", "a/../../x") must not escape destDir.
- T2: Absolute entry names ("/etc/passwd") and Windows drive or backslash forms ("..\\..\\x") must be rejected (E_ZIP_SLIP).
- T3: NUL bytes in entry names must be rejected (E_ZIP_SLIP).
- T4: Safe-but-odd names ("....//x", "..data/y") stay inside destDir.
