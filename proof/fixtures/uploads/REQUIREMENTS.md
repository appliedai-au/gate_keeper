# Requirements (acceptance tests)
- R1: Nested relative paths resolve inside the root: "reports/2026/q3.pdf" -> "/srv/uploads/reports/2026/q3.pdf".
- R2: Paths that normalise to a location still inside the root are allowed: "a/../b.txt" -> "/srv/uploads/b.txt".
- R3: Any path that would resolve outside the root is rejected with an Error whose code is "E_TRAVERSAL".
