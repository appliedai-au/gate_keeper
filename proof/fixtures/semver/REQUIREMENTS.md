# Requirements (acceptance tests)
Versions follow Semantic Versioning 2.0.0: MAJOR.MINOR.PATCH, optional -PRERELEASE, optional +BUILD.
- R1: Core parts compare numerically: 1.10.0 > 1.9.0 > 1.2.10 > 1.2.9.
- R2: A pre-release is lower than its release: 1.0.0-rc.1 < 1.0.0.
- R3: Pre-release identifiers compare left to right: numeric identifiers numerically, alphanumeric identifiers in ASCII order, numeric lower than alphanumeric, and when all shared identifiers are equal the shorter list is lower. So 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0.
- R4: Build metadata is ignored: 1.0.0+20130313 equals 1.0.0+exp.sha.5114f85.
