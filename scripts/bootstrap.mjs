// One-shot setup: execute only inside Gate Keeper's private Railway network.
import { readFileSync } from 'node:fs';
import { TrueForge } from '@truefoundry/trueforge-sdk';

const baseUrl = process.env.TRUEFORGE_BASE_URL;
if (!baseUrl || !/^http:\/\/[a-z0-9-]+\.railway\.internal:\d{2,5}\/?$/.test(baseUrl)) {
  console.error('BLOCKED: TRUEFORGE_BASE_URL must point to a private Railway service');
  process.exit(2);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/healthz', {signal: AbortSignal.timeout(5000)});
    if (res.ok) break;
  } catch {}
  if (attempt === 19) {
    console.error('BLOCKED: TrueForge private health endpoint unavailable after 20 attempts');
    process.exit(2);
  }
  await pause(3000);
}

const tf = new TrueForge({baseUrl, timeoutInSeconds: 45});
const agent = JSON.parse(readFileSync('agent/agent.json', 'utf8'));
const instructions = readFileSync('agent/instructions.md', 'utf8').trim();
const skill = readFileSync('agent/skills/review-checklist/SKILL.md', 'utf8');
try {
  const { data: models } = await tf.models.list();
  const modelNames = models.map((m) => m.name);
  console.log('GATE_KEEPER_MODELS=' + JSON.stringify(modelNames));
  const targetModel = process.env.TF_MODEL || agent.model.name;
  if (!modelNames.includes(targetModel)) {
    console.error('BLOCKED_NO_MODEL: Configure ' + targetModel + ' in the protected TrueForge Settings > Models. No agent changes made.');
    process.exitCode = 3;
  } else {
    const spec = {
      model: { ...agent.model, name: targetModel },
      instructions: instructions + '\n\n---\n\n# Skill: review-checklist\n\n' + skill,
      config: {askUserQuestions: {enabled: false}, generativeUi: {enabled: false}},
    };
    const found = await tf.agents.list({agentName:agent.name});
    let existing;
    for await (const item of found) if (item.name === agent.name) {existing=item; break;}
    if (existing) {
      const {data: saved} = await tf.agents.update(existing.id,{description:agent.description,manifest:spec});
      console.log('GATE_KEEPER_REGISTERED=updated id=' + saved.id + ' model=' + targetModel);
    } else {
      const {data: saved} = await tf.agents.create({name:agent.name,description:agent.description,manifest:spec});
      console.log('GATE_KEEPER_REGISTERED=created id=' + saved.id + ' model=' + targetModel);
    }
    console.log('EVALS_NOT_RUN: run baseline only when model settings and budget are confirmed');
  }
} catch (err) {
  console.error('BOOTSTRAP_FAILED: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 4;
}
