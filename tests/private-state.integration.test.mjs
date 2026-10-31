import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,statSync,rmSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const root=resolve('.');
function run(js, privateRoot) {
  return spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',js],
    {cwd:root,env:{...process.env,GATE_KEEPER_STATE_DIR:privateRoot},encoding:'utf8',timeout:15000});
}
function fixture() {
  const folder=mkdtempSync(join(realpathSync(tmpdir()),'gk-private-test-'));
  return {folder,state:join(folder,'state'),cleanup:()=>rmSync(folder,{recursive:true,force:true})};
}

test('legacy owned 0755 run directories are tightened before evidence write',()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.state,'runs','run-01'),{recursive:true,mode:0o755});
    const p=join(f.state,'runs','run-01');
    const result=run(`import {writeJson} from './scripts/lib.ts';
      writeJson(process.env.GATE_KEEPER_STATE_DIR+'/runs/run-01/intent.json',{test:true});`,f.state);
    assert.equal(result.status,0,result.stderr);
    assert.equal(statSync(p).mode & 0o777,0o700);
    assert.equal(statSync(join(f.state,'runs')).mode & 0o777,0o700);
    assert.equal(statSync(join(p,'intent.json')).mode & 0o777,0o600);
  } finally {f.cleanup();}
});

test('symlinked private root ancestor is rejected before storing evidence',()=>{
  const f=fixture();
  try {
    const external=join(f.folder,'external');
    mkdirSync(external);
    const alias=join(f.folder,'alias');
    symlinkSync(external,alias,'dir');
    const result=run(`await import('./scripts/lib.ts')`,join(alias,'state'));
    assert.notEqual(result.status,0,'symlinked root unexpectedly accepted');
    assert.match(result.stderr,/PRIVATE_EVIDENCE_REJECTED/);
  } finally {f.cleanup();}
});

test('existing file symlink is rejected as an evidence read target',()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.state,'runs'),{recursive:true,mode:0o700});
    const target=join(f.folder,'outside.json');
    writeFileSync(target,'{"fake":true}');
    symlinkSync(target,join(f.state,'runs','score.json'));
    const result=run(`import {assertPrivatePath} from './scripts/lib.ts';
      assertPrivatePath(process.env.GATE_KEEPER_STATE_DIR+'/runs/score.json');`,f.state);
    assert.notEqual(result.status,0,'existing file symlink unexpectedly accepted');
    assert.match(result.stderr,/PRIVATE_EVIDENCE_REJECTED: unsafe existing file/);
  } finally {f.cleanup();}
});

test('paths outside canonical private root are refused',()=>{
  const f=fixture();
  try {
    const result=run(`import {assertPrivatePath} from './scripts/lib.ts';
      assertPrivatePath('/tmp/should-not-write-gk-private-test.json');`,f.state);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/PRIVATE_EVIDENCE_REJECTED: path escapes private state/);
  } finally {f.cleanup();}
});

test('dangling symlink target cannot be read as private evidence',()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.state,'runs'),{recursive:true,mode:0o700});
    const absent=join(f.folder,'nonexistent-target.json');
    symlinkSync(absent,join(f.state,'runs','receipt.json'));
    const result=run(`import {assertPrivatePath} from './scripts/lib.ts';
      assertPrivatePath(process.env.GATE_KEEPER_STATE_DIR+'/runs/receipt.json');`,f.state);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/PRIVATE_EVIDENCE_REJECTED: unsafe existing file/);
  } finally {f.cleanup();}
});
test('path traversal cannot create intermediate folders outside private state',()=>{
  const f=fixture();
  try {
    const outside=join(f.folder,'outside');
    mkdirSync(outside,{mode:0o700});
    mkdirSync(f.state,{mode:0o700});
    symlinkSync(outside,join(f.state,'escape'));
    const result=run(`import {writeJson} from './scripts/lib.ts';
      writeJson(process.env.GATE_KEEPER_STATE_DIR+'/escape/created/score.json',{bad:true});`,f.state);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/PRIVATE_EVIDENCE_REJECTED: directory owner or type/);
    assert.equal(existsSync(join(outside,'created')),false);
  } finally {f.cleanup();}
});
