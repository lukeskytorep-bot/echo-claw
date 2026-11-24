import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { preflight, buildPlan, install, rollbackTransaction } from '../installer/echo4-install.mjs';
import { supportedNodeVersion, supportedOpenClawVersion, assertRuntimeRegistration, readConfigPath, readJson } from '../installer/host-ops.mjs';
import { verifySessionEvidence } from '../installer/echo4-live-gateway-smoke.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fake = path.join(root, 'tests', 'fixtures', 'fake-openclaw.mjs');
function tmp(){ return fs.mkdtempSync(path.join(os.tmpdir(),'echo4-')); }
function stateFile(dir, initial={}){ const file=path.join(dir,'state.json'); fs.writeFileSync(file,JSON.stringify({version:'2026.11.7',config:{},installed:false,commands:[],...initial},null,2)); return file; }
function withFake(file, fn){ const old=process.env.FAKE_OPENCLAW_STATE; process.env.FAKE_OPENCLAW_STATE=file; try{return fn();} finally{ if(old===undefined) delete process.env.FAKE_OPENCLAW_STATE; else process.env.FAKE_OPENCLAW_STATE=old; } }
function readState(file){return JSON.parse(fs.readFileSync(file,'utf8'));}


test('E4-T45 generic backend not-found error is not mistaken for a missing config key',()=>{
  const d=tmp(),f=stateFile(d),wrapper=path.join(d,'fake-backend-error.mjs');
  fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';const a=process.argv.slice(2);if(a[0]==='config'&&a[1]==='get'){console.error('backend service not found');process.exit(1);}const r=spawnSync(${JSON.stringify(fake)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
  assert.throws(()=>withFake(f,()=>readConfigPath('agents.entries.main.tools',{command:wrapper})),e=>e.code==='CONFIG_READ_FAILED');
});

test('E4-T46 live smoke proof rejects impossible transport chronology',()=>{
  const d=tmp(),db=new DatabaseSync(path.join(d,'chronology.sqlite')); db.exec(`CREATE TABLE sessions(session_id,state,mode,protocol_id,protocol_version,conductor_mode,tasking_mode,created_at,updated_at);CREATE TABLE attempts(attempt_id,session_id,status,response_transport_attempt_id,step_id,step_instance_id,accepted_at);CREATE TABLE transport_receipts(transport_attempt_id,attempt_id,status,authorized_at,completed_at);CREATE TABLE step_results(session_id,step_instance_id,step_id,attempt_id,transport_attempt_id,accepted_at);CREATE TABLE reveals(session_id,revealed_at);`);
  const started='2026-01-01T00:00:00.000Z', authorized='2026-01-01T00:00:03.000Z', completed='2026-01-01T00:00:02.000Z', accepted='2026-01-01T00:00:01.000Z'; db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)').run('s','BLIND_RUNNING','manual','rv-lite-core','1.1.0','human_user','no_code',started,accepted); db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?)').run('a','s','ACCEPTED','t','rv-lite-core.prepare','i',accepted); db.prepare('INSERT INTO transport_receipts VALUES (?,?,?,?,?)').run('t','a','COMPLETED',authorized,completed); db.prepare('INSERT INTO step_results VALUES (?,?,?,?,?,?)').run('s','i','rv-lite-core.prepare','a','t',accepted);
  const proof=verifySessionEvidence(db,{sessionId:'s',full:false,startedAt:started}); db.close(); assert.equal(proof.ok,false); assert.equal(proof.assertions.transportChronology,false);
});

test('E4-T47 automatic rollback preserves a concurrent workspace edit and reports blocked rollback',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'m'),v=path.join(d,'v'),wrapper=path.join(d,'fake-concurrent-workspace.mjs'),target=path.join(m,'AGENTS.md');
  fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';const a=process.argv.slice(2);if(a[0]==='plugins'&&a[1]==='inspect'){fs.writeFileSync(${JSON.stringify(target)},'USER EDIT DURING INSTALL');console.error('forced post-install failure');process.exit(42);}const r=spawnSync(${JSON.stringify(fake)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
  let thrown; try{withFake(f,()=>install({command:wrapper,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));}catch(e){thrown=e;}
  assert.ok(thrown); assert.equal(thrown.rollback?.status,'ROLLBACK_BLOCKED_USER_CHANGES'); assert.equal(fs.readFileSync(target,'utf8'),'USER EDIT DURING INSTALL'); assert.equal(readState(f).installed,true);
});

test('E4-T48 automatic rollback preserves a concurrent config edit and reports blocked rollback',()=>{
  const d=tmp(),f=stateFile(d),wrapper=path.join(d,'fake-concurrent-config.mjs');
  fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';const a=process.argv.slice(2);if(a[0]==='plugins'&&a[1]==='inspect'){const f=process.env.FAKE_OPENCLAW_STATE;const s=JSON.parse(fs.readFileSync(f,'utf8'));s.config.agents.entries.main.tools.alsoAllow.push('USER_TOOL_DURING_INSTALL');fs.writeFileSync(f,JSON.stringify(s,null,2));console.error('forced post-install failure');process.exit(42);}const r=spawnSync(${JSON.stringify(fake)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
  let thrown; try{withFake(f,()=>install({command:wrapper,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));}catch(e){thrown=e;}
  assert.ok(thrown); assert.equal(thrown.rollback?.status,'ROLLBACK_BLOCKED_USER_CHANGES'); assert.ok(readState(f).config.agents.entries.main.tools.alsoAllow.includes('USER_TOOL_DURING_INSTALL')); assert.equal(readState(f).installed,true);
});

test('E4-T49 runtime inspection follows OpenClaw 2026.11 structured toolNames/typedHooks and rejects unloaded or non-imported plugins',()=>{
  const good={plugin:{id:'echo-claw',status:'enabled',toolNames:['echo_owner_session','echo_monitor_session']},inspectionScope:'cli',imported:true,typedHooks:[{name:'before_model_request'},{name:'model_call_started'},{name:'model_call_ended'}],diagnostics:[]};
  assert.doesNotThrow(()=>assertRuntimeRegistration(good));
  assert.throws(()=>assertRuntimeRegistration({...good,plugin:{...good.plugin,status:'disabled'}}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
  assert.throws(()=>assertRuntimeRegistration({...good,imported:false}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
  assert.throws(()=>assertRuntimeRegistration({...good,typedHooks:[],diagnostics:['before_model_request model_call_started model_call_ended']}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
});

