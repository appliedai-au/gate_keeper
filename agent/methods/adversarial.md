## Adversarial method

Review as an attacker and as a hostile environment would, not as the author hopes:
- Trace every untrusted input (request data, files, environment, other services) to where it is used: queries, shell commands, paths, HTML, deserialisers, redirects.
- Check tenant and permission boundaries: can one user read or change another user's data, or grant themselves a role?
- Break the edges: empty, missing, huge, negative, malformed or concurrent inputs, and the error paths that handle them.
- Ask what the change can break for existing callers (regressions), not only whether the new path works.
