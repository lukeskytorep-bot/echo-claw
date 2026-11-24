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


test('E4-T41 runtime diagnostic text cannot masquerade as tool or hook registration',()=>{
  assert.throws(()=>assertRuntimeRegistration({id:'echo-claw',status:'failed',diagnostics:['Missing echo_owner_session echo_monitor_session before_model_request model_call_started model_call_ended']}),e=>e.code==='RUNTIME_REGISTRATION_INCOMPLETE');
});

test('E4-T42 live smoke proof rejects wrong protocol conductor tasking and unbound transport',()=>{
  const d=tmp(),db=new DatabaseSync(path.join(d,'bad.sqlite')); db.exec(`CREATE TABLE sessions(session_id,state,mode,protocol_id,protocol_version,conductor_mode,tasking_mode,created_at,updated_at);CREATE TABLE attempts(attempt_id,session_id,status,response_transport_attempt_id,step_id,step_instance_id,accepted_at);CREATE TABLE transport_receipts(transport_attempt_id,attempt_id,status,authorized_at,completed_at);CREATE TABLE step_results(session_id,step_instance_id,step_id,attempt_id,transport_attempt_id,accepted_at);CREATE TABLE reveals(session_id,revealed_at);`);
  const now=new Date().toISOString(); db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)').run('s','BLIND_RUNNING','manual','rcp','1.5a','ai_monitor','neutral_code',now,now); db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?)').run('a','s','ACCEPTED','other','rcp.phase1','i',now); db.prepare('INSERT INTO transport_receipts VALUES (?,?,?,?,?)').run('t','other-attempt','COMPLETED',now,now); db.prepare('INSERT INTO step_results VALUES (?,?,?,?,?,?)').run('s','i','rcp.phase1','a','t',now);
  const proof=verifySessionEvidence(db,{sessionId:'s',full:false,startedAt:now}); db.close(); assert.equal(proof.ok,false); assert.equal(proof.assertions.protocol,false); assert.equal(proof.assertions.conductor,false); assert.equal(proof.assertions.tasking,false);
});

test('E4-T43 SIGKILL after plugin installation is reconciled from durable install intent',()=>{
  const helper=path.join(root,'tests','fixtures','installer-crash-recovery.mjs'); const run=spawnSync(process.execPath,[helper],{encoding:'utf8',timeout:30_000}); assert.equal(run.status,0,run.stderr||run.stdout); const report=JSON.parse(run.stdout); assert.equal(report.ok,true); assert.equal(report.phase,'PLUGIN_INSTALL_PENDING'); assert.equal(report.intent,'PENDING'); assert.equal(report.rollback,'ROLLED_BACK'); assert.equal(report.installed,false);
});

test('E4-T44 overlapping Monitor and Viewer workspaces are rejected before plugin mutation',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'shared'),v=path.join(d,'shared','viewer'); assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx'),forceConflicts:true})),e=>e.code==='WORKSPACE_OVERLAP'); assert.equal(readState(f).installed,false); assert.equal(readState(f).commands.some(a=>a[0]==='plugins'&&a[1]==='install'),false);
});

