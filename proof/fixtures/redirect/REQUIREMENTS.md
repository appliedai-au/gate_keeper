# Requirements (acceptance tests)
- R1: Same-site paths are kept, including query and fragment: "/account?tab=2#x" stays "/account?tab=2#x".
- R2: A missing or empty `next` redirects to "/".
- R3: Anything that is not a same-site path redirects to "/" (it does not throw).
