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


test('E4-T31 manual rollback restores pre-existing ECHO config after uninstall',()=>{ const d=tmp(), prior={enabled:false,config:{dataDir:path.join(d,'data'),ownerAgentId:'main',customLegacy:'preserve-me'}}; const f=stateFile(d,{config:{plugins:{entries:{'echo-claw':prior},allow:['other'],deny:['blocked']},agents:{entries:{main:{tools:{allow:['read']}}}}}}); const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})); withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir})); const st=readState(f); assert.deepEqual(st.config.plugins.entries['echo-claw'],prior); assert.deepEqual(st.config.plugins.allow,['other']); assert.deepEqual(st.config.plugins.deny,['blocked']); });

test('E4-T32 host self-test applies a real Gateway plugin reload gate before runtime inspection',()=>{ const d=tmp(), f=stateFile(d,{gateway:true,installed:true,config:{plugins:{entries:{'echo-claw':{hooks:{allowModelRequest:true,allowConversationAccess:true,allowPromptModification:true},config:{ownerAgentId:'main',monitorAgentId:'echo-monitor',viewerAgentId:'echo-viewer'}}}},agents:{entries:{'echo-monitor':{tools:{allow:['echo_monitor_session']}},'echo-viewer':{tools:{deny:['*']}},main:{tools:{alsoAllow:['echo_owner_session']}}}}}}); const r=spawnSync(process.execPath,[path.join(root,'installer','echo4-host-self-test.mjs')],{env:{...process.env,ECHO_OPENCLAW_BIN:fake,FAKE_OPENCLAW_STATE:f},encoding:'utf8'}); assert.notEqual(r.stdout.trim(),''); const report=JSON.parse(r.stdout); assert.equal(report.checks.find(x=>x.id==='gateway-plugin-reload').ok,true); const commands=readState(f).commands; const reloadIndex=commands.findIndex(a=>a[0]==='plugins'&&a[1]==='reload'); const inspectIndex=commands.findIndex(a=>a[0]==='plugins'&&a[1]==='inspect'); assert.ok(reloadIndex>=0&&inspectIndex>reloadIndex); assert.ok(commands[reloadIndex].includes('--wait')); assert.ok(commands[reloadIndex].includes('--json')); });


test('E4-T33 existing incompatible Monitor or Viewer policy is a plan conflict, not silently overwritten',()=>{ const d=tmp(),f=stateFile(d,{config:{agents:{entries:{'echo-monitor':{workspace:path.join(d,'m'),tools:{allow:['exec']}},'echo-viewer':{workspace:path.join(d,'v'),skills:['legacy']}}}}}); const p=withFake(f,()=>buildPlan({command:fake,monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data')})); assert.equal(p.ok,false); assert.ok(p.conflicts.some(x=>x.path==='agents.entries.echo-monitor.tools.allow')); assert.ok(p.conflicts.some(x=>x.path==='agents.entries.echo-viewer.skills')); });

test('E4-T34 failed workspace conflict does not create or modify the destination directory',()=>{ const d=tmp(),f=stateFile(d); const m=path.join(d,'m'),v=path.join(d,'v'); fs.mkdirSync(m,{recursive:true}); fs.writeFileSync(path.join(m,'AGENTS.md'),'custom'); assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})),e=>e.code==='WORKSPACE_CONFLICT'); assert.equal(fs.existsSync(v),false); assert.equal(fs.readFileSync(path.join(m,'AGENTS.md'),'utf8'),'custom'); });

test('E4-T35 existing incompatible plugin hook policy is detected before installation',()=>{ const d=tmp(),f=stateFile(d,{config:{plugins:{entries:{'echo-claw':{hooks:{allowModelRequest:false},config:{dataDir:path.join(d,'data')}}}}}}); const plan=withFake(f,()=>buildPlan({command:fake,monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data')})); assert.equal(plan.ok,false); assert.ok(plan.conflicts.some(x=>x.path==='plugins.entries.echo-claw.hooks.allowModelRequest')); });



test('E4-T36 plugin inventory read failure is fail-closed before mutation',()=>{
  const d=tmp(),f=stateFile(d,{installed:true}); process.env.FAKE_FAIL_ON='plugins list';
  try { assert.throws(()=>withFake(f,()=>buildPlan({command:fake,monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data')})),e=>e.code==='PLUGIN_LIST_FAILED'); }
  finally { delete process.env.FAKE_FAIL_ON; }
  const st=readState(f); assert.equal(st.installed,true); assert.equal(st.commands.some(a=>a[0]==='plugins'&&a[1]==='install'),false);
});

test('E4-T37 config read failure is fail-closed before plugin installation',()=>{
  const d=tmp(),f=stateFile(d,{config:{agents:{entries:{main:{tools:{allow:['read']}}}}}}); process.env.FAKE_FAIL_ON='config get agents.entries.main.tools';
  try { assert.throws(()=>withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')})),e=>e.code==='CONFIG_READ_FAILED'); }
  finally { delete process.env.FAKE_FAIL_ON; }
  const st=readState(f); assert.equal(st.installed,false); assert.deepEqual(st.config.agents.entries.main.tools.allow,['read']);
});

test('E4-T38 failed config restore reports ROLLBACK_INCOMPLETE',()=>{
  const d=tmp(),f=stateFile(d); const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));
  process.env.FAKE_FAIL_ON='config unset agents.entries.echo-monitor'; let rb;
  try { rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir})); }
  finally { delete process.env.FAKE_FAIL_ON; }
  assert.equal(rb.ok,false); assert.equal(rb.status,'ROLLBACK_INCOMPLETE'); assert.ok(rb.errors.some(x=>x.phase==='config-restore'||x.phase==='config-verify'));
});

test('E4-T39 manual rollback blocks later user configuration and workspace edits',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'m'),v=path.join(d,'v'); const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')}));
  fs.writeFileSync(path.join(m,'AGENTS.md'),'USER EDIT AFTER INSTALL'); const st=readState(f); st.config.agents.entries.main.tools.alsoAllow.push('user_new_tool'); fs.writeFileSync(f,JSON.stringify(st,null,2));
  const rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir}));
  assert.equal(rb.ok,false); assert.equal(rb.status,'ROLLBACK_BLOCKED_USER_CHANGES'); assert.equal(fs.readFileSync(path.join(m,'AGENTS.md'),'utf8'),'USER EDIT AFTER INSTALL'); assert.ok(readState(f).config.agents.entries.main.tools.alsoAllow.includes('user_new_tool'));
});

test('E4-T40 backup paths are unique by role and full workspace path',()=>{
  const d=tmp(),f=stateFile(d),m=path.join(d,'a','same'),v=path.join(d,'b','same');
  for(const [dir,tag] of [[m,'MONITOR ORIGINAL'],[v,'VIEWER ORIGINAL']]){ fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'AGENTS.md'),tag); fs.writeFileSync(path.join(dir,'SOUL.md'),`${tag} SOUL`); }
  const r=withFake(f,()=>install({command:fake,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:m,viewerWorkspace:v,dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx'),forceConflicts:true}));
  const tx=readJson(path.join(r.transactionDir,'transaction.json')); const backups=tx.workspaceChanges.filter(x=>x.backup).map(x=>x.backup); assert.equal(new Set(backups).size,backups.length); assert.ok(backups.some(x=>x.includes(`${path.sep}monitor${path.sep}`))); assert.ok(backups.some(x=>x.includes(`${path.sep}viewer${path.sep}`)));
  const rb=withFake(f,()=>rollbackTransaction({command:fake,transactionDir:r.transactionDir})); assert.equal(rb.ok,true); assert.equal(fs.readFileSync(path.join(m,'AGENTS.md'),'utf8'),'MONITOR ORIGINAL'); assert.equal(fs.readFileSync(path.join(v,'AGENTS.md'),'utf8'),'VIEWER ORIGINAL');
});

