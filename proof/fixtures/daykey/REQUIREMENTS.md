# Requirements (acceptance tests)
- R1: Days are Melbourne calendar days (IANA zone Australia/Melbourne), including daylight saving: AEDT (UTC+11) from the first Sunday in October to the first Sunday in April, AEST (UTC+10) otherwise.
- R2: An event at 13:30 UTC on 4 October 2026 (00:30 AEDT on 5 October) belongs to 2026-10-05.
- R3: An event at 13:30 UTC on 4 July 2026 (23:30 AEST) belongs to 2026-07-04.
