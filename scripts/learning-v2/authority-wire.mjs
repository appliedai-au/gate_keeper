/**
 * Exact custom-provider wire mapping for approved TrueForge0.180/0.182:
 * InstructionBuilder + AgentThread + convertMCPServers, ai7.0.118 and
 * @ai-sdk/openai-compatible3.0.57. No runtime request supplies this template.
 *
 * Primary source: truefoundry/trueforge d15fbad7d9c0296316cfdc3712a73039219c10ba,
 * packages/trueforge-core/src/core/{InstructionBuilder.ts,runtime/AgentThread.ts,
 * runtime/contextUtils.ts,capabilities/builtins/CurrentDateTime.ts};
 * vercel/ai tag @ai-sdk/openai-compatible@3.0.57.
 */
import { copy, requireThat } from './contracts.mjs';

const IDENTITY = 'You are the Agent, an AI assistant that helps users accomplish tasks by leveraging available tools and capabilities.';
const INTERNAL = [
  'Messages wrapped in tfy-internal tags contain information hidden from the user. The Agent must keep this information in mind when conversing with the user.',
  'The Agent must never generate any content with tfy-internal tags.',
  'The Agent cannot generate any content with tfy-internal tags.',
].join('\n');
const section = (name, body) => '<' + name + '>\n' + body + '\n</' + name + '>';

export function authoritySystemPrompt(instructions) {
  requireThat(typeof instructions === 'string' && instructions.trim(), 'owned system instructions absent');
  return section('system-prompt', [
    section('agent-identity', IDENTITY),
    section('agent-capabilities', section('internal-messages', INTERNAL)),
    '<user-instructions><![CDATA[\n' + instructions.trim() + '\n]]></user-instructions>',
  ].join('\n\n'));
}

export function authorityProviderBody(entry, upstreamModelId) {
  const spec = entry.sessionRequest.agent.spec;
  requireThat(spec.model.params.temperature === 0.2 && spec.model.params.maxTokens === 8000 &&
    entry.turnRequest.input.length === 1 && entry.turnRequest.input[0].type === 'user.message' &&
    typeof entry.turnRequest.input[0].content === 'string', 'frozen custom provider input');
  return copy({ model: upstreamModelId, max_tokens: 8000, temperature: 0.2,
    messages: [{ role: 'system', content: authoritySystemPrompt(spec.instructions) },
      { role: 'user', content: entry.turnRequest.input[0].content }],
    tools: [{ type: 'function', function: { name: 'get_current_datetime',
      description: 'mcp server: current-datetime\nReturns the current datetime in ISO-8601 (UTC) and unix epoch MS format.',
      parameters: { type: 'object', properties: {}, required: [] } } }],
    tool_choice: 'auto', stream: true, stream_options: { include_usage: true } });
}
