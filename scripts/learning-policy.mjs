/** Independent Gate Keeper learning admission.
 * This policy NEVER runs TrueForge, promotes an agent or changes an evaluator.
 * A detached verifier (separate credentials and service) owns the signing key.
 */
import {createHash, createPublicKey, verify as ed25519Verify} from 'node:crypto';
import {readFileSync} from 'node:fs';

const PATH=/^agent\/(?:instructions\.md|skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md)$/;
const H64=/^[a-f0-9]{64}$/;
const H40=/^[a-f0-9]{40}$/;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(value);

export function validateCandidate(files, baselineInstructions) {
  if (!Array.isArray(files) || files.length<1 || files.length>16) throw Error('invalid candidate count');
  if (typeof baselineInstructions!=='string' || !baselineInstructions.includes('## Output\n')) throw Error('missing baseline output contract');
  const baselineOutput=baselineInstructions.slice(baselineInstructions.indexOf('## Output\n'));
  const seen=new Set(); let bytes=0;
  for (const file of files) {
    if (!file || typeof file.path!=='string' || !PATH.test(file.path) || seen.has(file.path)) throw Error('invalid/duplicate candidate path');
    seen.add(file.path);
    if (typeof file.text!=='string' || !file.text.endsWith('\n') || file.text.includes('\0')) throw Error('invalid candidate body');
    bytes+=Buffer.byteLength(file.text);
    if (file.path==='agent/instructions.md') {
      const pos=file.text.indexOf('## Output\n');
      if(pos<0 || file.text.slice(pos)!==baselineOutput) throw Error('output contract changed');
    } else {
      if(!file.text.startsWith('---\n')) throw Error('skill frontmatter missing');
      const end=file.text.indexOf('\n---\n',4);
      if(end<0) throw Error('skill frontmatter malformed');
      const front=file.text.slice(4,end);
      if(!/^name:\s*\S.+$/m.test(front) || !/^description:\s*\S.+$/m.test(front)) throw Error('skill frontmatter fields missing');
    }
  }
  if(bytes>100000) throw Error('candidate too large');
  return [...files].sort((a,b)=>a.path.localeCompare(b.path));
}
export function candidateDigest(files, baselineInstructions) {
  return hash(canonical(validateCandidate(files,baselineInstructions)));
}

/** A passing score written by the learning agent is never authorisation.
 * The detached report must be independently signed and exactly source-bound.
 */
export function verifyQualification({report,signature,publicKeyPem,expected}) {
  if(!report || typeof report!=='object' || Array.isArray(report) || !signature || !publicKeyPem || !expected) throw Error('qualification evidence unavailable');
  // The trusted fingerprint must be injected by the *separate* qualification
  // controller from protected configuration, never from an agent candidate.
  const trustedPin=process.env.GK_VERIFIER_SPKI_SHA256;
  if(!trustedPin || !H64.test(trustedPin)) throw Error('trusted verifier key not configured');
  let spki;
  try {spki=createPublicKey(publicKeyPem).export({type:'spki',format:'der'});}
  catch {throw Error('invalid verifier public key');}
  if(hash(spki)!==trustedPin) throw Error('untrusted verifier key');
  const keys=['candidate_digest','baseline_sha','benchmark_digest','scorer_digest','verifier_digest'];
  for(const key of keys) if(!H64.test(report[key]||'')) throw Error(key+' missing or malformed');
  if(!H40.test(report.source_commit||'')) throw Error('source commit missing');
  if(report.schema!=='gate-keeper-qualification-v1' || report.verdict!=='pass') throw Error('not independently qualified');
  for(const key of [...keys,'source_commit']) if(report[key]!==expected[key]) throw Error(key+' mismatch');
  if(!Number.isInteger(report.baseline_holdout_passed) || report.baseline_holdout_passed<0) throw Error('baseline missing');
  if(!Number.isInteger(report.holdout_total) || report.holdout_total<8 ||
     !Number.isInteger(report.holdout_passed) || report.holdout_passed<report.baseline_holdout_passed ||
     report.holdout_passed!==report.holdout_total) throw Error('private holdout regression or insufficient coverage');
  if(!Number.isFinite(report.training_score) || !Number.isFinite(report.baseline_training_score) ||
     report.training_score<0 || report.training_score>100 || report.training_score<report.baseline_training_score) throw Error('training regression');
  if(!Number.isFinite(report.cost_usd) || report.cost_usd<0 || report.cost_usd>20) throw Error('cost cap/unknown');
  if(report.security_passed!==true || report.reproducible!==true || report.independent!==true) throw Error('missing independent security proof');
  const sig=Buffer.from(signature,'base64');
  if(sig.length!==64 || !ed25519Verify(null,Buffer.from(canonical(report)),publicKeyPem,sig)) throw Error('invalid verifier signature');
  return {qualified:true,candidate_digest:report.candidate_digest,source_commit:report.source_commit};
}
if(process.argv[1]?.endsWith('/learning-policy.mjs')) {
 try {
   if(process.argv[2]!=='verify' || process.argv.length!==6) throw Error('usage: learning-policy.mjs verify <report.json> <signature.b64> <public-key.pem>');
   const report=JSON.parse(readFileSync(process.argv[3],'utf8'));
   const signature=readFileSync(process.argv[4],'utf8').trim();
   const publicKeyPem=readFileSync(process.argv[5],'utf8');
   const expected=JSON.parse(process.env.GK_TRUSTED_EXPECTED||'null');
   const evidence=verifyQualification({report,signature,publicKeyPem,expected});
   // A command-line diagnostic cannot independently promote an agent. A
   // trusted controller must separately enforce policy and perform promotion.
   console.log(JSON.stringify({signature_verified:true,source_commit:evidence.source_commit,
     candidate_digest:evidence.candidate_digest,promotion_authorized:false}));
 } catch(err) {console.error('BLOCKED: '+err.message);process.exitCode=2;}
}
