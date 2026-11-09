# Third-party notices and provenance

## TrueForge starter — MIT

- Upstream: https://github.com/nerdconf/trueforge-starter
- Source commit: `9d6207e5fe9e062db8cdc0e9b7df05dfabadb51f`
- Source tree: `8471b4589e806125770f548a993f1cd5eb78d6b4`
- Gate Keeper import: `72dfde8d8a8b560727c15b93b6a1f33c26ff57ce`
  (31 October 2026, 01:23:11 UTC).
- Copyright: **2026 NERDCONF and the Stranger Builds participants**.
- Complete original licence: [trueforge-starter-MIT.txt](third_party_licenses/trueforge-starter-MIT.txt).

The upstream material and retained portions in modified files remain subject
to MIT. Gate Keeper's root notice does not claim exclusive ownership of them
or remove their MIT permissions. Keep the full upstream copyright and
permission notice with copies or substantial portions of that material.

### Imported path inventory

Every path below was present in the imported source tree. This is a provenance
inventory, not a claim that every byte of a subsequently modified file belongs
to the same holder. Use the source commit and Git history to distinguish
inherited portions and later additions. New files are not automatically
ownership-cleared merely because they do not appear in this list.

- `.env.example`
- `.gitignore`
- `CONTRIBUTING.md`
- `LICENSE`
- `README.md`
- `agent/agent.json`
- `agent/instructions.md`
- `agent/skills/review-checklist/SKILL.md`
- `evals/score.ts`
- `evals/tasks/01-python-utils.json`
- `evals/tasks/02-express-users.json`
- `evals/tasks/03-python-deploy.json`
- `evals/tasks/04-ts-fetch.json`
- `package-lock.json`
- `package.json`
- `runs/summary.csv`
- `scripts/export-session.ts`
- `scripts/improve.ts`
- `scripts/lib.ts`
- `scripts/run-evals.ts`
- `scripts/setup.ts`
- `tsconfig.json`

The imported `LICENSE` text is preserved verbatim at
`third_party_licenses/trueforge-starter-MIT.txt`; the root `LICENSE` now explains
the mixed licensing. Original starter contribution guidance is retained in
`CONTRIBUTING.md` as historical upstream guidance, not a licence grant for
Gate Keeper additions.

## Dependencies and runtime

`@truefoundry/trueforge-sdk` 0.180.0 is recorded as MIT in `package-lock.json`.
The checked-in lockfile records dependencies under MIT and Apache-2.0.
These packages retain their own copyright, licence and applicable NOTICE
files; the root project licence metadata does not relicense dependencies.

TrueForge itself is separate upstream software:
https://github.com/truefoundry/trueforge (see its own LICENSE).
Runtime packages, container contents, assets and hosted services must be
reviewed in the form actually distributed or used. This inventory is not a
complete software bill of materials or a substitute for packaging required
third-party notices with distributed artifacts.

## Earlier releases

Earlier public Gate Keeper revisions were distributed under MIT. Their
existing licence grants remain unaffected. Neither this inventory nor the
root notice retroactively converts those copies to exclusive proprietary
material.
