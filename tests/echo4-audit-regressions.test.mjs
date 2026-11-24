import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildPlan, install, rollbackTransaction } from '../installer/echo4-install.mjs';
import { assertRuntimeRegistration, readConfigPath, readJson } from '../installer/host-ops.mjs';
import { verifySessionEvidence } from '../installer/echo4-live-gateway-smoke.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fake=path.join(root,'tests','fixtures','fake-openclaw.mjs');
function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'echo4-audit-'));}
function stateFile(dir,initial={}){const f=path.join(dir,'state.json');fs.writeFileSync(f,JSON.stringify({version:'2026.11.7',config:{},installed:false,commands:[],...initial},null,2));return f;}
function withFake(file,fn){const old=process.env.FAKE_OPENCLAW_STATE;process.env.FAKE_OPENCLAW_STATE=file;try{return fn();}finally{if(old===undefined)delete process.env.FAKE_OPENCLAW_STATE;else process.env.FAKE_OPENCLAW_STATE=old;}}
function readState(f){return JSON.parse(fs.readFileSync(f,'utf8'));}

test('E4-FIX-R01 A1 plugin inventory read failure is fail-closed before mutation',()=>{
  const d=tmp(),f=stateFile(d,{installed:true});process.env.FAKE_FAIL_ON='plugins list';
  try{assert.throws(()=>withFake(f,()=>buildPlan({command:fake,monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data')})),e=>e.code==='PLUGIN_LIST_FAILED');}
  finally{delete process.env.FAKE_FAIL_ON;}
  const st=readState(f);assert.equal(st.installed,true);assert.equal(st.commands.some(a=>a[0]==='plugins'&&a[1]==='install'),false);
});

test('E4-FIX-R02 A1 config read failure is fail-closed before plugin installation',()=>{
  const d=tmp(),f=stateFile(d,{config:{agents:{entries:{main:{tools:{allow:['read']}}}}}});process.env.FAKE_FAIL_ON='config get agents.entries.main.tools';
  try{assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})),e=>e.code==='CONFIG_READ_FAILED');}
  finally{delete process.env.FAKE_FAIL_ON;}
  const st=readState(f);assert.equal(st.installed,false);assert.deepEqual(st.config.agents.entries.main.tools.allow,['read']);
});

test('E4-FIX-R03 A2 failed config restore produces ROLLBACK_INCOMPLETE',()=>{
  const d=tmp(),f=stateFile(d);const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));
  process.env.FAKE_FAIL_ON='config unset agents.entries.echo-monitor';let rb;try{rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir}));}finally{delete process.env.FAKE_FAIL_ON;}
  assert.equal(rb.ok,false);assert.equal(rb.status,'ROLLBACK_INCOMPLETE');assert.ok(rb.errors.some(x=>x.phase==='config-restore'||x.phase==='config-verify'));assert.notEqual(readState(f).config.agents.entries['echo-monitor'],undefined);
});

test('E4-FIX-R04 A3 rollback blocks later user config and workspace edits',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'m'),v=path.join(d,'v');const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));
  fs.writeFileSync(path.join(m,'AGENTS.md'),'USER EDIT AFTER INSTALL');const st=readState(f);st.config.agents.entries.main.tools.alsoAllow.push('other_new_tool');fs.writeFileSync(f,JSON.stringify(st,null,2));
  const rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir}));assert.equal(rb.ok,false);assert.equal(rb.status,'ROLLBACK_BLOCKED_USER_CHANGES');assert.ok(rb.conflicts.length>=2);assert.equal(fs.readFileSync(path.join(m,'AGENTS.md'),'utf8'),'USER EDIT AFTER INSTALL');assert.ok(readState(f).config.agents.entries.main.tools.alsoAllow.includes('other_new_tool'));assert.equal(readState(f).installed,true);
});

test('E4-FIX-R05 A4 backup paths are role/path unique for equal workspace basenames',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'a','same'),v=path.join(d,'b','same');for(const [dir,txt] of [[m,'MONITOR ORIGINAL'],[v,'VIEWER ORIGINAL']]){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'AGENTS.md'),txt);fs.writeFileSync(path.join(dir,'SOUL.md'),`${txt} SOUL`);}
  const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx'),forceConflicts:true}));const tx=readJson(path.join(r.transactionDir,'transaction.json'));const backups=tx.workspaceChanges.filter(x=>x.backup).map(x=>x.backup);assert.equal(new Set(backups).size,backups.length);assert.ok(backups.some(x=>x.includes(`${path.sep}monitor${path.sep}`)));assert.ok(backups.some(x=>x.includes(`${path.sep}viewer${path.sep}`)));
  const rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir}));assert.equal(rb.ok,true);assert.equal(fs.readFileSync(path.join(m,'AGENTS.md'),'utf8'),'MONITOR ORIGINAL');assert.equal(fs.readFileSync(path.join(v,'AGENTS.md'),'utf8'),'VIEWER ORIGINAL');
});

test('E4-FIX-R06 A5 runtime inspection rejects diagnostic text masquerading as registrations',()=>{
  assert.throws(()=>assertRuntimeRegistration({status:'failed',diagnostics:['Missing echo_owner_session echo_monitor_session before_model_request model_call_started model_call_ended']}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
});

test('E4-FIX-R07 A6 strict smoke proof rejects mismatched session and unbound transport',()=>{
  const d=tmp(),db=new DatabaseSync(path.join(d,'bad.sqlite'));db.exec(`CREATE TABLE sessions(session_id,state,mode,protocol_id,protocol_version,conductor_mode,tasking_mode,created_at,updated_at);CREATE TABLE attempts(attempt_id,session_id,status,response_transport_attempt_id,step_id,step_instance_id,accepted_at);CREATE TABLE transport_receipts(transport_attempt_id,attempt_id,status,authorized_at,completed_at);CREATE TABLE step_results(session_id,step_instance_id,step_id,attempt_id,transport_attempt_id,accepted_at);CREATE TABLE reveals(session_id,revealed_at);`);const now=new Date().toISOString();db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)').run('s','BLIND_RUNNING','manual','rcp','1.5a','ai_monitor','neutral_code',now,now);db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?)').run('a','s','ACCEPTED','other','rcp.phase1','i',now);db.prepare('INSERT INTO transport_receipts VALUES (?,?,?,?,?)').run('t','b','COMPLETED',now,now);db.prepare('INSERT INTO step_results VALUES (?,?,?,?,?,?)').run('s','i','rcp.phase1','a','t',now);const proof=verifySessionEvidence(db,{sessionId:'s',full:false,startedAt:now});db.close();assert.equal(proof.ok,false);assert.equal(proof.assertions.protocol,false);
});

test('E4-FIX-R08 A7 pending install intent is reconciled after SIGKILL and rolled back',()=>{
  const helper=path.join(root,'tests','fixtures','installer-crash-recovery.mjs');const run=spawnSync(process.execPath,[helper],{encoding:'utf8',timeout:30_000});assert.equal(run.status,0,run.stderr||run.stdout);const report=JSON.parse(run.stdout);assert.equal(report.ok,true);assert.equal(report.phase,'PLUGIN_INSTALL_PENDING');assert.equal(report.intent,'PENDING');assert.equal(report.rollback,'ROLLED_BACK');assert.equal(report.installed,false);
});

test('E4-FIX-R09 overlapping Monitor and Viewer workspaces are rejected before plugin mutation',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'shared'),v=path.join(d,'shared','viewer');assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx'),forceConflicts:true})),e=>e.code==='WORKSPACE_OVERLAP');assert.equal(readState(f).installed,false);assert.equal(readState(f).commands.some(a=>a[0]==='plugins'&&a[1]==='install'),false);
});

test('E4-FIX-R10 generic backend not-found error is not mistaken for a missing config key',()=>{
  const d=tmp(),f=stateFile(d),wrapper=path.join(d,'fake-backend-error.mjs');
  fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';const a=process.argv.slice(2);if(a[0]==='config'&&a[1]==='get'){console.error('backend service not found');process.exit(1);}const r=spawnSync(${JSON.stringify(fake)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
  const old=process.env.FAKE_OPENCLAW_STATE; process.env.FAKE_OPENCLAW_STATE=f;
  try { assert.throws(()=>readConfigPath('agents.entries.main.tools',{command:wrapper}),e=>e.code==='CONFIG_READ_FAILED'); }
  finally { if(old===undefined) delete process.env.FAKE_OPENCLAW_STATE; else process.env.FAKE_OPENCLAW_STATE=old; }
});

test('E4-FIX-R11 strict smoke proof rejects impossible transport chronology',()=>{
  const d=tmp(),db=new DatabaseSync(path.join(d,'chronology.sqlite')); db.exec(`CREATE TABLE sessions(session_id,state,mode,protocol_id,protocol_version,conductor_mode,tasking_mode,created_at,updated_at);CREATE TABLE attempts(attempt_id,session_id,status,response_transport_attempt_id,step_id,step_instance_id,accepted_at);CREATE TABLE transport_receipts(transport_attempt_id,attempt_id,status,authorized_at,completed_at);CREATE TABLE step_results(session_id,step_instance_id,step_id,attempt_id,transport_attempt_id,accepted_at);CREATE TABLE reveals(session_id,revealed_at);`);
  const started='2026-01-01T00:00:00.000Z', authorized='2026-01-01T00:00:03.000Z', completed='2026-01-01T00:00:02.000Z', accepted='2026-01-01T00:00:01.000Z';
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)').run('s','BLIND_RUNNING','manual','rv-lite-core','1.1.0','human_user','no_code',started,accepted); db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?)').run('a','s','ACCEPTED','t','rv-lite-core.prepare','i',accepted); db.prepare('INSERT INTO transport_receipts VALUES (?,?,?,?,?)').run('t','a','COMPLETED',authorized,completed); db.prepare('INSERT INTO step_results VALUES (?,?,?,?,?,?)').run('s','i','rv-lite-core.prepare','a','t',accepted);
  const proof=verifySessionEvidence(db,{sessionId:'s',full:false,startedAt:started}); db.close(); assert.equal(proof.ok,false); assert.equal(proof.assertions.transportChronology,false);
});

test('E4-FIX-R12 automatic rollback preserves a concurrent workspace edit',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'m'),v=path.join(d,'v'),wrapper=path.join(d,'fake-concurrent-workspace.mjs'),target=path.join(m,'AGENTS.md');
  fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';const a=process.argv.slice(2);if(a[0]==='plugins'&&a[1]==='inspect'){fs.writeFileSync(${JSON.stringify(target)},'USER EDIT DURING INSTALL');console.error('forced post-install failure');process.exit(42);}const r=spawnSync(${JSON.stringify(fake)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
  let thrown; try{withFake(f,()=>install({command:wrapper,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));}catch(e){thrown=e;}
  assert.ok(thrown); assert.equal(thrown.rollback?.status,'ROLLBACK_BLOCKED_USER_CHANGES'); assert.equal(fs.readFileSync(target,'utf8'),'USER EDIT DURING INSTALL'); assert.equal(readState(f).installed,true);
});

test('E4-FIX-R13 automatic rollback preserves a concurrent config edit',()=>{
  const d=tmp(),f=stateFile(d),wrapper=path.join(d,'fake-concurrent-config.mjs');
  fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';const a=process.argv.slice(2);if(a[0]==='plugins'&&a[1]==='inspect'){const f=process.env.FAKE_OPENCLAW_STATE;const s=JSON.parse(fs.readFileSync(f,'utf8'));s.config.agents.entries.main.tools.alsoAllow.push('USER_TOOL_DURING_INSTALL');fs.writeFileSync(f,JSON.stringify(s,null,2));console.error('forced post-install failure');process.exit(42);}const r=spawnSync(${JSON.stringify(fake)},a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`,{mode:0o755});
  let thrown; try{withFake(f,()=>install({command:wrapper,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));}catch(e){thrown=e;}
  assert.ok(thrown); assert.equal(thrown.rollback?.status,'ROLLBACK_BLOCKED_USER_CHANGES'); assert.ok(readState(f).config.agents.entries.main.tools.alsoAllow.includes('USER_TOOL_DURING_INSTALL')); assert.equal(readState(f).installed,true);
});

test('E4-FIX-R14 runtime inspection follows OpenClaw 2026.11 toolNames/typedHooks structure',()=>{
  const good={plugin:{id:'echo-claw',status:'enabled',toolNames:['echo_owner_session','echo_monitor_session']},inspectionScope:'cli',imported:true,typedHooks:[{name:'before_model_request'},{name:'model_call_started'},{name:'model_call_ended'}],diagnostics:[]};
  assert.doesNotThrow(()=>assertRuntimeRegistration(good));
  assert.throws(()=>assertRuntimeRegistration({...good,plugin:{...good.plugin,status:'disabled'}}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
  assert.throws(()=>assertRuntimeRegistration({...good,imported:false}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
  assert.throws(()=>assertRuntimeRegistration({...good,typedHooks:[],diagnostics:['before_model_request model_call_started model_call_ended']}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
});
