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


test('E4-T21 installation never invokes gateway restart implicitly',()=>{ const d=tmp(),f=stateFile(d); withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})); const s=readState(f); assert.equal(s.commands.some(a=>a[0]==='gateway'&&a[1]==='restart'),false); });
test('E4-T22 package declares the deliberately narrow ECHO-4 validated Node host range',()=>{ const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')); assert.equal(p.engines.node,'>=24.16.0 <25 || >=26.1.0 <27'); });

test('E4-T23 a completed installation can be explicitly rolled back from its transaction record',()=>{ const d=tmp(),f=stateFile(d,{config:{agents:{entries:{main:{tools:{allow:['read']}}}}}}); const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})); const rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir})); assert.equal(rb.ok,true); const st=readState(f); assert.equal(st.installed,false); assert.deepEqual(st.config.agents.entries.main.tools.allow,['read']); assert.equal(fs.existsSync(path.join(d,'m','AGENTS.md')),false); });

test('E4-T24 git installation refuses an unpinned source',()=>{ const d=tmp(),f=stateFile(d); assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',source:'git',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})),e=>e.code==='GIT_REF_REQUIRED'); assert.equal(readState(f).installed,false); });

test('E4-T25 host self-test requires the owner tool policy as well as Monitor and Viewer policies',()=>{ const d=tmp(), f=stateFile(d,{gateway:true,installed:true,config:{plugins:{entries:{'echo-claw':{hooks:{allowModelRequest:true,allowConversationAccess:true,allowPromptModification:true},config:{ownerAgentId:'main',monitorAgentId:'echo-monitor',viewerAgentId:'echo-viewer'}}}},agents:{entries:{'echo-monitor':{tools:{allow:['echo_monitor_session']}},'echo-viewer':{tools:{deny:['*']}},main:{tools:{}}}}}}); const r=spawnSync(process.execPath,[path.join(root,'installer','echo4-host-self-test.mjs')],{env:{...process.env,ECHO_OPENCLAW_BIN:fake,FAKE_OPENCLAW_STATE:f},encoding:'utf8'}); assert.notEqual(r.status,0); const report=JSON.parse(r.stdout); assert.equal(report.checks.find(x=>x.id==='owner-tool-policy').ok,false); });

test('E4-T26 host self-test accepts owner tool through alsoAllow',()=>{ const d=tmp(), f=stateFile(d,{gateway:true,installed:true,config:{plugins:{entries:{'echo-claw':{hooks:{allowModelRequest:true,allowConversationAccess:true,allowPromptModification:true},config:{ownerAgentId:'main',monitorAgentId:'echo-monitor',viewerAgentId:'echo-viewer'}}}},agents:{entries:{'echo-monitor':{tools:{allow:['echo_monitor_session']}},'echo-viewer':{tools:{deny:['*']}},main:{tools:{alsoAllow:['echo_owner_session']}}}}}}); const r=spawnSync(process.execPath,[path.join(root,'installer','echo4-host-self-test.mjs')],{env:{...process.env,ECHO_OPENCLAW_BIN:fake,FAKE_OPENCLAW_STATE:f},encoding:'utf8'}); const report=JSON.parse(r.stdout); assert.equal(report.checks.find(x=>x.id==='owner-tool-policy').ok,true); assert.equal(report.checks.find(x=>x.id==='runtime-registration').ok,true); });


test('E4-T27 installer requires explicit capability consent before any mutation',()=>{ const d=tmp(),f=stateFile(d); assert.throws(()=>withFake(f,()=>install({command:fake,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})),e=>e.code==='CAPABILITY_CONSENT_REQUIRED'); const st=readState(f); assert.equal(st.installed,false); assert.equal(st.commands.some(a=>a[0]==='plugins'&&a[1]==='install'),false); });

test('E4-T28 local and Git installs pass both source acknowledgement and capability consent to OpenClaw',()=>{ for(const source of ['local-link','git']){ const d=tmp(),f=stateFile(d); withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',source,gitRef:source==='git'?'abc123':null,monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})); const cmd=readState(f).commands.find(a=>a[0]==='plugins'&&a[1]==='install'); assert.ok(cmd.includes('--force')); assert.ok(cmd.includes('--accept-capabilities')); } });

test('E4-T29 preflight validates the built plugin entry from the project root',()=>{ const d=tmp(),f=stateFile(d); withFake(f,()=>preflight({command:fake,nodeVersion:'24.22.1'})); const cmd=readState(f).commands.find(a=>a[0]==='plugins'&&a[1]==='validate'); assert.deepEqual(cmd.slice(0,4),['plugins','validate','--root',root]); assert.ok(cmd.includes('--entry')); assert.ok(cmd.includes('./dist/index.js')); assert.ok(cmd.includes('--json')); });

test('E4-T30 reachable Gateway makes plugin reload a required install gate',()=>{ const d=tmp(),f=stateFile(d,{gateway:true}); process.env.FAKE_FAIL_ON='plugins reload'; try { assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})),e=>e.code==='PLUGIN_RELOAD_FAILED'); } finally { delete process.env.FAKE_FAIL_ON; } const st=readState(f); assert.equal(st.installed,false); });

