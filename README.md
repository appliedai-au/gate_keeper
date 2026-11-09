# Gate Keeper — read-only reviewer

This source snapshot contains the Gate Keeper **reviewer only**. It provides a read-only agent definition, review instructions, an adversarial review method and a review checklist.

## Reviewer files

- `agent/agent.json` — the read-only reviewer manifest.
- `agent/instructions.md` — the review contract, evidence discipline, severity guidance and JSON output format.
- `agent/methods/adversarial.md` — the adversarial review method.
- `agent/skills/review-checklist/SKILL.md` — the review checklist.

Use these reviewer assets with an operator-configured TrueForge instance. Model availability and authorization must be verified in that instance; a model name in the manifest is not a claim of availability or permission to spend. The reviewer reports findings and does not apply changes, execute repairs, merge code or deploy software.

The proprietary application, website/dashboard, client API, executor (including early repair/execution prototypes), learning services and deployment infrastructure are not part of this reviewer snapshot. Do not add those implementations to this public repository.

## Scope and licensing

The reviewer assets retain their existing contents. This scope cleanup does not expand their licence. See `LICENSE`, `THIRD_PARTY_NOTICES.md` and `third_party_licenses/` for the applicable terms and retained attribution.

This is a reviewer source distribution, not a hosted service or an installation of the G8S application. Historical repository references are separate from the scope of this current source tree.
