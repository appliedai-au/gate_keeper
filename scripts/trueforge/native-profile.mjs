// TrueForge-native Gate Keeper profile builder.
// Generates a review/repair-capable specification for TrueForge's own harness.
// This module intentionally has NO network calls and does not update an agent.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const load = name => readFileSync(new URL("../../agent/"+name, import.meta.url), "utf8");
const config = JSON.parse(load("native-trueforge-profile.json"));
const reviewer = JSON.parse(load("agent.json"));
const instructions = load("native-trueforge-instructions.md");

export function validateApprovalTools(value) {
  if (!Array.isArray(value) || value.length!==2 ||
      !value.includes("@write") || !value.includes("@destructive") ||
      new Set(value).size!==2)
    throw new Error("NATIVE_PROFILE_REJECTED: write/destructive approvals required");
  return [...value];
}

export function buildNativeTrueForgeSpec({
  registeredGithubConnector = null,
  sandboxProviderVerified = false,
  independentGatewayVerified = false,
} = {}) {
  if (!sandboxProviderVerified || !independentGatewayVerified)
    throw new Error("NATIVE_PROFILE_HELD: sandbox provider and independent budget gateway qualification required");
  if (registeredGithubConnector !== config.github_connector_name)
    throw new Error("NATIVE_PROFILE_HELD: configured GitHub MCP connector not verified");
  if (config.release.default !== "held" || config.release.production_automatic_merges !== false ||
      config.release.production_automatic_deployments !== false)
    throw new Error("NATIVE_PROFILE_REJECTED: unsafe release defaults");
  if (!Array.isArray(config.github_tools) || config.github_tools.length!==1 ||
      config.github_tools[0] !== "@read-only")
    throw new Error("NATIVE_PROFILE_REJECTED: unexpected GitHub tool permissions");
  const approval = validateApprovalTools(config.mcp_approval);
  const manifest = {
    model: { ...reviewer.model },
    instructions: instructions.trim(),
    mcp_servers: [{
      name: registeredGithubConnector,
      enable_tools: ["@read-only"],
      require_approval_for_tools: approval,
      preload: false,
    }],
    config: JSON.parse(JSON.stringify(config.config)),
  };
  if (manifest.config.sandbox?.enabled !== true ||
      manifest.config.dynamic_sub_agents?.enabled !== true ||
      manifest.config.sandbox?.file_downloads !== false)
    throw new Error("NATIVE_PROFILE_REJECTED: mandatory sandbox boundary disabled");
  return { name: config.agent_name, manifest, release: "HELD_PENDING_LIVE_QUALIFICATION" };
}

export function nativeProfileReadiness() {
  return {
    status: "HELD",
    agentName: config.agent_name,
    runtime: "TrueForge",
    coordinator: "TrueForge internal agent loop; dynamic subagents on demand",
    sandboxProvider: "must be independently verified before registration",
    githubConnector: config.github_connector_name,
    githubTools: config.github_tools,
    budgetGateway: "must be independently verified before registration",
    liveWrites: false,
    newServicesRequired: 0,
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(nativeProfileReadiness(), null, 2));
}
