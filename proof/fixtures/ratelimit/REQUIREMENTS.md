# Requirements (acceptance tests)
- R1: A key may make at most `limit` allowed requests in ANY rolling period of `windowMs` milliseconds: a request at time t is allowed only if fewer than `limit` allowed requests for that key happened in (t - windowMs, t].
- R2: A request exactly windowMs after an earlier allowed request no longer counts that earlier request.
- R3: Rejected requests do not count towards the limit.
- R4: Keys are independent.
