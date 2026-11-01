# Requirements (acceptance tests)
- R1: `fn` is called at most `attempts` times in total (attempts=3 means 3 calls, not 4).
- R2: The first successful result is returned immediately, without further calls or waits.
- R3: When every attempt fails, the LAST error is thrown (never a silent undefined).
- R4: Waits happen only BETWEEN attempts: attempts=3 all failing waits exactly twice, baseMs then 2*baseMs.
