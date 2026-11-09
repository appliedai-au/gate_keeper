# Requirements (acceptance tests)
- R1: Entries resolve inside destDir: ("/tmp/out", "docs/readme.md") -> "/tmp/out/docs/readme.md".
- R2: Entry names that normalise to a location still inside destDir are allowed: "a/../b.txt" -> "/tmp/out/b.txt".
- R3: An entry that would land outside destDir is rejected with an Error whose code is "E_ZIP_SLIP"; planExtraction rejects the whole archive.
