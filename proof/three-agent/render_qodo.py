# Renders Qodo PR-Agent's /review prompts (MIT) with PR-Agent's own default settings
# (pr_agent/settings/configuration.toml @ b7b979341a54). Templates are used unchanged.
import sys, json, tomllib
from jinja2 import Environment, StrictUndefined
from jinja2.sandbox import SandboxedEnvironment
E = sys.argv[1]
CAP = int(sys.argv[2]) if len(sys.argv) > 2 else 20
prompts = tomllib.load(open(E + "/qodo-reviewer.toml", "rb"))["pr_review_prompt"]
frag = tomllib.load(open(E + "/qodo_prompt_fragments.toml", "rb"))["prompt_fragments"]["diff_hunk_format"]
hunk = SandboxedEnvironment(undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True).from_string(frag).render(include_line_numbers=True, include_ai_metadata=False).strip()
# Owner decision 3 Nov 2026: lift the default 3-issue cap to 20 ("all agents need to be unhobbled"). Only change.
base = dict(num_max_findings=CAP, require_score=False, require_tests=True, require_estimate_effort_to_review=True,
  require_risk_assessment=False, require_merge_recommendation=False, require_failure_modes=False, require_priority_files=False,
  require_estimate_contribution_time_cost=False, require_can_be_split_review=False, require_security_review=True, require_todo_scan=False,
  question_str="", answer_str="", extra_instructions="", skills_context="", repo_context="", previous_findings="", commit_messages_str="",
  custom_labels="", enable_custom_labels=False, is_ai_metadata=False, diff_hunk_format=hunk, related_tickets=[], related_tickets_omitted=0,
  duplicate_prompt_examples=False, date="2026-11-03", num_pr_files=1)
env = Environment(undefined=StrictUndefined)
tasks = json.load(sys.stdin)
out = {"system": env.from_string(prompts["system"]).render(**base, title="", branch="", description="", diff=""), "users": {}}
for t in tasks:
    diff = "## File: '%s'\n\n@@ -0,0 +1,%d @@\n__new hunk__\n%s\n" % (t["filename"], len(t["code"]), "\n".join("%d +%s" % (i + 1, l) for i, l in enumerate(t["code"])))
    out["users"][t["id"]] = env.from_string(prompts["user"]).render(**base, title=t["title"], branch="feature/" + t["id"], description=t["context"], diff=diff.rstrip("\n"))
json.dump(out, sys.stdout)
