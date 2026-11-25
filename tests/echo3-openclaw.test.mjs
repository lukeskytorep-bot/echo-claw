import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEchoPluginDefinition } from '../src/openclaw/plugin-definition.mjs';
import { EchoOpenClawAdapter } from '../src/openclaw/adapter.mjs';
import { EchoOpenClawStore } from '../src/openclaw/integration-store.mjs';
import { renderViewerPrompt, strictT10SupportVerifier } from '../src/openclaw/prompt-renderer.mjs';
import { resolveProtocol } from '../src/protocol-runtime.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'echo3-')); }

function viewerReplyFor(message) {
  if (/Step: (rv-lite-extended|rv-lite-core)\.prepare/u.test(message) || /Step: rcp\.prepare/u.test(message) || /Step: telepathy\.t0/u.test(message)) return 'READY';
  if (/steps1-2/u.test(message)) {
    const out=[];
    for(let n=1;n<=6;n+=1) out.push(`[[ECHO:RVL:TOUCH:${n}]]`,`[[ECHO:RVL:ECHO_DOT]] dot${n}`,`[[ECHO:RVL:PRIMITIVE_DESCRIPTOR]] primitive${n}`,`[[ECHO:RVL:ADVANCED_DESCRIPTOR]] advanced${n}`,`[[ECHO:RVL:CONTACT_CATEGORY]] category${n}`,`[[ECHO:RVL:FORMING]] form${n}`);
    for(let n=1;n<=3;n+=1) out.push(`[[ECHO:RVL:VECTOR:${n}]] vector${n}`);
    for(let n=1;n<=3;n+=1) out.push(`[[ECHO:RVL:SKETCH:${n}]] +-${n}-+`);
    return out.join('\n');
  }
  if (/Step: rv-lite-extended\.step3/u.test(message)) return ['[[ECHO:RVL:STEP3]] deeper','[[ECHO:RVL:STEP3:EXHAUSTED]]','[[ECHO:RVL:DEEPEN:MAIN_ASPECT]] mass','[[ECHO:RVL:DEEPEN:MAIN_ACTIVITY]] still','[[ECHO:RVL:DEEPEN:CENTER]] dense','[[ECHO:RVL:DEEPEN:SURROUNDINGS]] open','[[ECHO:RVL:DEEPEN:MAP]] [x]'].join('\n');
  if (/Step: rv-lite-core\.step3/u.test(message)) return '[[ECHO:RVL:STEP3]] deeper\n[[ECHO:RVL:STEP3:EXHAUSTED]]';
  if (/\.step4/u.test(message)) return '[[ECHO:RVL:FUNCTIONAL_SKETCH:1]]\n /\\\n/__\\';
  if (/Step: rcp\.phase1/u.test(message)) {
    const out=[]; for(let n=1;n<=6;n+=1) out.push(`[[ECHO:RCP:TOUCH:${n}]]`,`[[ECHO:ECHO_DOT]] calm${n}`,`[[ECHO:CONTACT_CATEGORY]] structure${n}`,`[[ECHO:PRIMITIVE_DESCRIPTOR]] hard${n}`,`[[ECHO:ADVANCED_DESCRIPTOR]] natural${n}`,`[[ECHO:FORMING]] form${n}`); return out.join('\n');
  }
  if (/Step: rcp\.phase[234]/u.test(message)) return '[[ECHO:RCP:RAPID_CONTACT]] mass\n[[ECHO:RCP:VECTOR_ORBIT]] still\n[[ECHO:RCP:FUNCTIONAL_SKETCH]] [x]';
  if (/Step: rcp\.phase5/u.test(message)) return '[[ECHO:RCP:5.1]] movement\n[[ECHO:RCP:5.2:T1]] before\n[[ECHO:RCP:5.2:T2]] now\n[[ECHO:RCP:5.2:T3]] after\n[[ECHO:RCP:5.3]] anomaly';
  if (/Step: rcp\.phase6/u.test(message)) return '[[ECHO:RCP:6:NO_NEW_SIGNAL]]';
  if (/Step: telepathy\.t1\b/u.test(message)) {
    const out=[]; for(let n=1;n<=3;n+=1) out.push(`[[ECHO:TEL:T1:TOUCH:${n}]]`,`[[ECHO:TEL:ECHO_DOT]] calm`,`[[ECHO:TEL:CONTACT_CATEGORY]] subject`,`[[ECHO:TEL:PRIMITIVE_DESCRIPTOR]] soft`,`[[ECHO:TEL:ADVANCED_DESCRIPTOR]] natural`,`[[ECHO:TEL:FORMING]] calm`); return out.join('\n');
  }
  if (/Step: telepathy\.t2/u.test(message)) return '[[ECHO:TEL:T2:RAPID_CONTACT]] still\n[[ECHO:TEL:T2:VECTOR_ORBIT]] still\n[[ECHO:TEL:T2:FUNCTIONAL_SKETCH]] [x]';
  for (let n=3;n<=6;n+=1) if (new RegExp(`Step: telepathy\\.t${n}\\b`,'u').test(message)) return `[[ECHO:TEL:T${n}:RAW]] ${n===3?'quiet':'calm'}`;
  if (/Step: telepathy\.t7/u.test(message)) return Array.from({length:6},(_,i)=>`[[ECHO:TEL:T7:Q${i+1}]] calm`).join('\n');
  if (/Step: telepathy\.t8/u.test(message)) return '[[ECHO:TEL:T8A]] calm\n[[ECHO:TEL:T8B]] calm';
  if (/Step: telepathy\.t9/u.test(message)) {
    const markers=[...message.matchAll(/\[\[ECHO:TEL:T9:Q(\d+):RAW\]\]/gu)].map((m)=>Number(m[1]));
    return [...new Set(markers)].map((n)=>`[[ECHO:TEL:T9:Q${n}:RAW]] calm`).join('\n');
  }
  if (/Step: telepathy\.t10/u.test(message)) return 'calm. [SRC:T1]\nstill. [SRC:T2]\nquiet. [SRC:T3]';
  return 'READY';
}
function makeMockApi({ dataDir=tmp(), retryFirstRun=false, doubleSuccessFirstRun=false, skipModelHooks=false, mismatchedEndCallId=false, pendingRuns=false }={}) {
  const tools=[]; const hooks=new Map(); const runs=new Map(); const generations=new Map(); const runCalls=[]; let runSeq=0; let providerSends=0;
  const api={
    registrationMode:'full',
    pluginConfig:{ dataDir, ownerAgentId:'main', monitorAgentId:'echo-monitor', viewerAgentId:'echo-viewer' },
    logger:{ info() {}, warn() {}, error() {} },
    registerTool(desc,opts){ tools.push({desc,opts}); },
    on(name,handler,opts){ if(!hooks.has(name)) hooks.set(name,[]); hooks.get(name).push({handler,opts}); },
    runtime:{
      capabilities:['test-runtime'],
      system:{
        async captureSessionGeneration({agentId,sessionKey}) { const g=generations.get(sessionKey); return g ? {agentId,sessionKey,...g} : undefined; },
      },
      subagent:{
        async run(opts) {
          runCalls.push(opts); const runId=`run-${++runSeq}`; if(!generations.has(opts.sessionKey)) generations.set(opts.sessionKey,{sessionId:`host-${runSeq}`,lifecycleRevision:1});
          const hookCtx={agentId:'echo-viewer',sessionKey:opts.sessionKey,sessionId:generations.get(opts.sessionKey).sessionId,runId,modelProviderId:'openai',modelId:'mock-model'};
          const invoke=async(name,event)=>{ for(const h of hooks.get(name)??[]) await h.handler(event,hookCtx); };
          if(!skipModelHooks){
            if(retryFirstRun && runSeq===1){
              await invoke('before_model_request',{payload:{messages:[opts.message],attempt:1}}); providerSends+=1;
              await invoke('model_call_started',{runId,callId:`${runId}-c1`,provider:'openai',model:'mock-model'});
              await invoke('model_call_ended',{runId,callId:`${runId}-c1`,outcome:'error'});
              await invoke('before_model_request',{payload:{messages:[opts.message],attempt:2}}); providerSends+=1;
              await invoke('model_call_started',{runId,callId:`${runId}-c2`,provider:'openai',model:'mock-model'});
              await invoke('model_call_ended',{runId,callId:`${runId}-c2`,outcome:'ok',upstreamRequestIdHash:'hash-2'});
            } else if(doubleSuccessFirstRun && runSeq===1){
              await invoke('before_model_request',{payload:{messages:[opts.message],attempt:1}}); providerSends+=1;
              await invoke('model_call_started',{runId,callId:`${runId}-c1`,provider:'openai',model:'mock-model'});
              await invoke('model_call_ended',{runId,callId:`${runId}-c1`,outcome:'ok',upstreamRequestIdHash:'hash-1'});
              // A second provider request after a completed call must fail closed under ECHO-2 T65.
              await invoke('before_model_request',{payload:{messages:[opts.message],attempt:2}}); providerSends+=1;
            } else {
              await invoke('before_model_request',{payload:{messages:[opts.message]}}); providerSends+=1;
              await invoke('model_call_started',{runId,callId:`${runId}-c1`,provider:'openai',model:'mock-model'});
              await invoke('model_call_ended',{runId,callId:mismatchedEndCallId ? `${runId}-unrelated` : `${runId}-c1`,outcome:'ok',upstreamRequestIdHash:`hash-${runSeq}`});
            }
          } else providerSends+=1;
          runs.set(runId,pendingRuns ? {status:'pending'} : {status:'ok',terminalReply:{text:viewerReplyFor(opts.message)}});
          return {runId,sessionKey:opts.sessionKey};
        },
        async waitForRun({runId}) { return runs.get(runId) ?? {status:'error',error:'missing run'}; },
        async getSessionMessages(){ return {messages:[]}; },
        async deleteSession(){},
      },
    },
    _tools:tools,_hooks:hooks,_runs:runs,_generations:generations,_runCalls:runCalls,
    get providerSends(){return providerSends;},
  };
  return api;
}

function register(api){ const def=createEchoPluginDefinition(); def.register(api); return def; }
function toolFor(api,name,ctx){ const r=api._tools.find((x)=>(x.opts?.name??x.opts?.names?.[0])===name); assert.ok(r,`missing ${name}`); return r.desc.create(ctx); }
function ownerCtx(principal='user-A', extra={}){ return {senderIsOwner:true,requesterSenderId:principal,agentId:'main',sessionKey:`agent:echo-monitor:${principal}`,sessionId:`chat-${principal}`,runId:'parent-run',assertInvocationCurrent(){ extra.assertCount && (extra.assertCount.value+=1); }}; }
function monitorCtx(principal='user-A', agentId='echo-monitor'){ return {senderIsOwner:false,requesterSenderId:principal,agentId,sessionKey:`agent:${agentId}:${principal}`,sessionId:`chat-${principal}`,runId:'parent-run',assertInvocationCurrent(){}}; }
async function call(tool,params){ const r=await tool.execute('tc-1',params); return r.details; }

function createParams(overrides={}){ return { action:'create', protocol_id:'rv-lite-extended', protocol_version:'1.1.0', conductor_mode:'human_user', tasking_mode:'neutral_code', mode:'manual', language:'pl', human_blindness:'BLIND', viewer_blindness:'BLIND', target_exposure_class:'public', ...overrides }; }

// Static and authority surface
test('E3-T01 plugin declares exactly owner and monitor tools',()=>{ const m=JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json',import.meta.url))); assert.deepEqual(m.contracts.tools.sort(),['echo_monitor_session','echo_owner_session']); });
test('E3-T02 owner tool unavailable without host owner proof',()=>{ const api=makeMockApi(); register(api); assert.equal(toolFor(api,'echo_owner_session',monitorCtx()),null); });
test('E3-T03 monitor tool unavailable to unconfigured agent',()=>{ const api=makeMockApi(); register(api); assert.equal(toolFor(api,'echo_monitor_session',monitorCtx('user-A','other-agent')),null); });
test('E3-T04 model parameters contain no authority identity fields',()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const keys=Object.keys(t.parameters.properties); for(const k of ['caller_role','principalId','requesterPrincipalId','agentId','viewerSessionId','senderIsOwner','transportAttemptId']) assert.equal(keys.includes(k),false,k); });

test('E3-T05 created session is owner-bound and target identity redacted',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx('user-A')); const s=await call(t,createParams()); assert.equal(s.state,'VIEWER_READY'); assert.equal(s.target_id,null); assert.equal('owner_principal_id' in s,false); });
test('E3-T06 blind Viewer prompt contains no target identity/content',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); const prompt=api._runCalls[0].message; assert.equal(/target_\d+|long-\d+|location-\d+|activity-\d+/iu.test(prompt),false); assert.equal(prompt.includes('TARGET_RESERVED'),false); });
test('E3-T07 every normal Viewer provider request gets durable transport proof and accepted response',async()=>{ const dir=tmp(); const api=makeMockApi({dataDir:dir}); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); const r=await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(r.status,'ACCEPTED'); assert.equal(api.providerSends,1); });
test('E3-T08 provider retry creates a second physical receipt without losing logical attempt',async()=>{ const api=makeMockApi({retryFirstRun:true}); const def=register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); const r=await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(r.status,'ACCEPTED'); assert.equal(api.providerSends,2); });
test('E3-T09 pre-dispatch receipt failure blocks simulated provider send',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); const adapterHook=api._hooks.get('before_model_request')[0]; const original=adapterHook.handler; adapterHook.handler=async()=>{ throw Object.assign(new Error('disk fail'),{code:'WRITE_FAIL'}); }; const r=await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(r.ok,false); assert.equal(r.error.code,'WRITE_FAIL'); assert.equal(api.providerSends,0); adapterHook.handler=original; });
test('E3-T10 Viewer subagent is always launched with tools disabled',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(api._runCalls[0].disableTools,true); assert.equal(api._runCalls[0].promptMode,'minimal'); assert.equal(api._runCalls[0].deliver,false); });
test('E3-T11 multiple Viewer steps reuse one persistent sessionKey',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(api._runCalls.length,2); assert.equal(api._runCalls[0].sessionKey,api._runCalls[1].sessionKey); });
test('E3-T12 Viewer generation reset transitions core to RECOVERING before another provider send',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); const key=api._runCalls[0].sessionKey; const g=api._generations.get(key); api._generations.set(key,{sessionId:'replacement',lifecycleRevision:g.lifecycleRevision+1}); const sends=api.providerSends; const r=await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(r.status,'RECOVERING'); assert.equal(r.session.state,'RECOVERING'); assert.equal(api.providerSends,sends); });
test('E3-T13 owner B cannot read or control owner A session',async()=>{ const api=makeMockApi(); register(api); const a=toolFor(api,'echo_owner_session',ownerCtx('A')); const b=toolFor(api,'echo_owner_session',ownerCtx('B')); const s=await call(a,createParams()); const r=await call(b,{action:'status',session_id:s.session_id}); assert.equal(r.ok,false); assert.equal(r.error.code,'FORBIDDEN_SESSION_OWNER'); });
test('E3-T14 Monitor B cannot read owner A AI-monitor session',async()=>{ const api=makeMockApi(); register(api); const owner=toolFor(api,'echo_owner_session',ownerCtx('A')); const s=await call(owner,createParams({conductor_mode:'ai_monitor'})); const monB=toolFor(api,'echo_monitor_session',monitorCtx('B')); const r=await call(monB,{action:'status',session_id:s.session_id}); assert.equal(r.ok,false); assert.equal(r.error.code,'FORBIDDEN_SESSION_OWNER'); });
test('E3-T15 Monitor cannot conduct human_user session',async()=>{ const api=makeMockApi(); register(api); const owner=toolFor(api,'echo_owner_session',ownerCtx('A')); const s=await call(owner,createParams()); const mon=toolFor(api,'echo_monitor_session',monitorCtx('A')); const r=await call(mon,{action:'start',session_id:s.session_id}); assert.equal(r.ok,false); assert.equal(r.error.code,'WRONG_CONDUCTOR'); });
test('E3-T16 Owner cannot substitute for AI Monitor conductor decision',async()=>{ const api=makeMockApi(); register(api); const owner=toolFor(api,'echo_owner_session',ownerCtx('A')); const s=await call(owner,createParams({conductor_mode:'ai_monitor'})); const r=await call(owner,{action:'start',session_id:s.session_id}); assert.equal(r.ok,false); assert.equal(r.error.code,'WRONG_CONDUCTOR'); });
test('E3-T17 no_code prompt contains approved start and no code placeholder/remnant',()=>{ const p=resolveProtocol('rv-lite-extended','1.1.0'); const session={protocol_id:p.id,protocol_version:p.version,current_step_id:'rv-lite-extended.steps1-2',language:'pl'}; const text=renderViewerPrompt({session,tasking:{tasking_mode:'no_code',neutral_code:null}}); assert.match(text,/Cel został wybrany\. Rozpocznij sesję/u); assert.equal(/SESSION_CODE|kod celu|otrzymasz kod/iu.test(text),false); });
test('E3-T18 uncontrolled provider request on bound Viewer session is blocked',async()=>{ const api=makeMockApi(); const def=register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); const key=`agent:echo-viewer:subagent:echo-${s.session_id}`; const hook=api._hooks.get('before_model_request')[0].handler; await assert.rejects(()=>hook({payload:{}},{agentId:'echo-viewer',sessionKey:key,runId:'rogue',modelProviderId:'openai',modelId:'x'}),/no active logical attempt/); });
test('E3-T19 missing OpenClaw model hook coverage fails closed into RECOVERING',async()=>{ const api=makeMockApi({skipModelHooks:true}); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); const r=await call(t,{action:'run_next',session_id:s.session_id}); assert.equal(r.status,'RECOVERING'); assert.equal(r.reason,'MISSING_PHYSICAL_TRANSPORT_PROOF'); });
test('E3-T20 host invocation assertion is exercised across run launch and terminal commit',async()=>{ const c={value:0}; const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx('A',{assertCount:c})); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); assert.ok(c.value>=4); });
test('E3-T21 Viewer session key contains ECHO session id but no target metadata',async()=>{ const api=makeMockApi(); register(api); const t=toolFor(api,'echo_owner_session',ownerCtx()); const s=await call(t,createParams()); await call(t,{action:'start',session_id:s.session_id}); await call(t,{action:'run_next',session_id:s.session_id}); const key=api._runCalls[0].sessionKey; assert.ok(key.includes(s.session_id)); assert.equal(/long|location|activity|telepathic|target_/iu.test(key),false); });
test('E3-T22 manifest requests conversation read and both tool contracts',()=>{ const m=JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json',import.meta.url))); assert.deepEqual(m.contracts.conversationAccess,['read']); assert.deepEqual(new Set(m.contracts.tools),new Set(['echo_owner_session','echo_monitor_session'])); });
test('E3-T23 OpenClaw config example explicitly enables final model-request gate',()=>{ const text=fs.readFileSync(new URL('../docs/openclaw/openclaw.config.example.json5',import.meta.url),'utf8'); assert.match(text,/allowModelRequest:\s*true/u); assert.match(text,/allowConversationAccess:\s*true/u); assert.match(text,/allowPromptModification:\s*true/u); });
test('E3-T24 integration store persists generation and active binding across reopen',async()=>{ const dir=tmp(); const core=path.join(dir,'core.sqlite'), integ=path.join(dir,'int.sqlite'); const api=makeMockApi({dataDir:dir}); const a=new EchoOpenClawAdapter({api,coreDbPath:core,integrationDbPath:integ}); const ctx=a.ownerContext(ownerCtx('A')); const s=a.prepareSession(ctx,createParams()); const b=a.store.getBinding(s.session_id); a.store.setGeneration(s.session_id,{hostSessionId:'h',lifecycleRevision:7}); a.close(); const a2=new EchoOpenClawAdapter({api,coreDbPath:core,integrationDbPath:integ}); const b2=a2.store.getBinding(s.session_id); assert.equal(b2.host_session_id,'h'); assert.equal(b2.lifecycle_revision,7); a2.close(); });

test('E3-T25 a second provider request after a COMPLETED transport fails closed',async()=>{
  const api=makeMockApi({doubleSuccessFirstRun:true});
  register(api);
  const t=toolFor(api,'echo_owner_session',ownerCtx());
  const s=await call(t,createParams());
  await call(t,{action:'start',session_id:s.session_id});
  const r=await call(t,{action:'run_next',session_id:s.session_id});
  assert.equal(r.ok,false);
  assert.equal(r.error.code,'PHYSICAL_TRANSPORT_ALREADY_COMPLETED');
  assert.equal(api.providerSends,1);
});

test('E3-T26 active logical attempt and run id persist across integration-store reopen',()=>{
  const dir=tmp(); const core=path.join(dir,'core.sqlite'), integ=path.join(dir,'int.sqlite');
  const api=makeMockApi({dataDir:dir});
  const a=new EchoOpenClawAdapter({api,coreDbPath:core,integrationDbPath:integ});
  const ctx=a.ownerContext(ownerCtx('A'));
  const s=a.prepareSession(ctx,createParams());
  a.store.setActiveAttempt(s.session_id,{attemptId:'attempt-persist',stepInstanceId:'step-persist'});
  a.store.setRunId(s.session_id,'run-persist');
  a.close();
  const a2=new EchoOpenClawAdapter({api,coreDbPath:core,integrationDbPath:integ});
  const b=a2.store.getBinding(s.session_id);
  assert.equal(b.current_attempt_id,'attempt-persist');
  assert.equal(b.current_step_instance_id,'step-persist');
  assert.equal(b.current_run_id,'run-persist');
  a2.close();
});

test('E3-T27 ECHO-3 package pins the audited OpenClaw compatibility range',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
  assert.equal(pkg.peerDependencies.openclaw,'>=2026.11.7 <2026.12.0');
  assert.equal(pkg.openclaw.compat.minGatewayVersion,'2026.11.7');
  assert.equal(pkg.openclaw.build.openclawVersion,'2026.11.7');
});

test('E3-T28 owner-authority tool is unavailable inside the AI Monitor agent even for an owner-originated turn',()=>{
  const api=makeMockApi(); register(api);
  const monitorTurnFromOwner={...ownerCtx('A'),agentId:'echo-monitor',sessionKey:'agent:echo-monitor:A'};
  assert.equal(toolFor(api,'echo_owner_session',monitorTurnFromOwner),null);
  assert.ok(toolFor(api,'echo_monitor_session',monitorCtx('A')));
});


test('E3-FIX-A1 Monitor cannot run_next or collect a human_user session after access check', async()=>{
  const api=makeMockApi({pendingRuns:true}); register(api);
  const owner=toolFor(api,'echo_owner_session',ownerCtx('A'));
  const mon=toolFor(api,'echo_monitor_session',monitorCtx('A'));
  const s=await call(owner,createParams()); await call(owner,{action:'start',session_id:s.session_id});
  const m1=await call(mon,{action:'run_next',session_id:s.session_id}); assert.equal(m1.ok,false); assert.equal(m1.error.code,'WRONG_CONDUCTOR');
  const r=await call(owner,{action:'run_next',session_id:s.session_id}); assert.equal(r.status,'RUNNING');
  const m2=await call(mon,{action:'collect',session_id:s.session_id}); assert.equal(m2.ok,false); assert.equal(m2.error.code,'WRONG_CONDUCTOR');
});

test('E3-FIX-A2 unknown model callId never completes another physical transport', async()=>{
  const api=makeMockApi({mismatchedEndCallId:true}); register(api);
  const owner=toolFor(api,'echo_owner_session',ownerCtx('A'));
  const s=await call(owner,createParams()); await call(owner,{action:'start',session_id:s.session_id});
  const r=await call(owner,{action:'run_next',session_id:s.session_id});
  assert.equal(r.status,'RECOVERING');
  assert.equal(r.session.state,'RECOVERING');
});

test('E3-FIX-A3 T10 support verifier rejects appended novel information',()=>{
  assert.equal(strictT10SupportVerifier('The subject is calm and happy but holds a weapon.','The subject is calm and happy.'),'UNSUPPORTED');
  assert.equal(strictT10SupportVerifier('The subject is calm and happy.','The subject is calm and happy.'),'SUPPORTED');
});

test('E3-FIX-A4 recovery Resume rotates Viewer session and replays accepted blind outputs', async()=>{
  const api=makeMockApi(); register(api);
  const owner=toolFor(api,'echo_owner_session',ownerCtx('A'));
  const s=await call(owner,createParams()); await call(owner,{action:'start',session_id:s.session_id});
  await call(owner,{action:'run_next',session_id:s.session_id});
  const oldKey=api._runCalls[0].sessionKey; const g=api._generations.get(oldKey);
  api._generations.set(oldKey,{sessionId:'replacement',lifecycleRevision:g.lifecycleRevision+1});
  const lost=await call(owner,{action:'run_next',session_id:s.session_id}); assert.equal(lost.status,'RECOVERING');
  const resumed=await call(owner,{action:'resume',session_id:s.session_id}); assert.equal(resumed.state,'BLIND_RUNNING');
  const sends=api.providerSends;
  const next=await call(owner,{action:'run_next',session_id:s.session_id}); assert.equal(next.status,'ACCEPTED'); assert.equal(api.providerSends,sends+1);
  const newCall=api._runCalls.at(-1); assert.notEqual(newCall.sessionKey,oldKey); assert.match(newCall.sessionKey,/recovery-1/u); assert.match(newCall.message,/RECOVERY CONTEXT/u); assert.match(newCall.message,/READY/u);
});

test('E3-FIX-A5 Telepathy T9 questions and adjunct probes are exposed only through trusted neutrality verification', async()=>{
  const api=makeMockApi(); register(api); const owner=toolFor(api,'echo_owner_session',ownerCtx('A'));
  const s=await call(owner,createParams({protocol_id:'telepathy',protocol_version:'1.1'})); await call(owner,{action:'start',session_id:s.session_id});
  // Reach T2 checkpoint, freeze a generic neutral adjunct, then continue.
  await call(owner,{action:'run_next',session_id:s.session_id}); await call(owner,{action:'run_next',session_id:s.session_id}); await call(owner,{action:'run_next',session_id:s.session_id});
  let st=await call(owner,{action:'status',session_id:s.session_id}); assert.equal(st.current_step_id,'telepathy.t2'); assert.equal(st.checkpoint_pending,true);
  const adj=await call(owner,{action:'freeze_adjunct',session_id:s.session_id,instruction:'Explore the subject surroundings and movement'}); assert.equal(adj.neutrality_status,'NEUTRAL');
  const blocked=await call(owner,{action:'freeze_adjunct',session_id:s.session_id,instruction:'Ask whether the subject is holding a weapon'}); assert.equal(blocked.ok,false); assert.equal(blocked.error.code,'ADJUNCT_NOT_NEUTRAL');
  await call(owner,{action:'continue',session_id:s.session_id}); await call(owner,{action:'run_next',session_id:s.session_id}); assert.match(api._runCalls.at(-1).message,/FROZEN NEUTRAL ADJUNCT PROBES/u);
  // Move to T8 checkpoint.
  for (;;) {
    st=await call(owner,{action:'status',session_id:s.session_id});
    if (st.current_step_id==='telepathy.t8' && st.checkpoint_pending) break;
    if (st.checkpoint_pending) await call(owner,{action:'continue',session_id:s.session_id}); else await call(owner,{action:'run_next',session_id:s.session_id});
  }
  const q=await call(owner,{action:'freeze_t9',session_id:s.session_id,questions:['What is the subject feeling','Describe the subject state']}); assert.equal(q.count,2);
  await call(owner,{action:'continue',session_id:s.session_id}); const t9=await call(owner,{action:'run_next',session_id:s.session_id}); assert.equal(t9.status,'ACCEPTED'); assert.match(api._runCalls.at(-1).message,/Frozen neutral tasking questions/u);
});

test('E3-FIX-A6 first-run data directory is created before either SQLite database and tilde is expanded',()=>{
  const leaf=`.echo-claw-e3-${Date.now()}-${Math.random().toString(16).slice(2)}`; const configured=`~/${leaf}`;
  const api=makeMockApi(); api.pluginConfig={...api.pluginConfig,dataDir:configured};
  const a=new EchoOpenClawAdapter({api,config:api.pluginConfig});
  const expected=path.join(os.homedir(),leaf); assert.equal(a.config.dataDir,expected); assert.equal(fs.existsSync(expected),true); assert.equal(a.core.db.path,path.join(expected,'session-core.sqlite')); a.close(); fs.rmSync(expected,{recursive:true,force:true});
});

test('E3-FIX-A8 integration store migrates schema v1 to v3 and preserves existing bindings',()=>{
  const dir=tmp(); const dbPath=path.join(dir,'openclaw-integration.sqlite');
  const legacy=new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE echo_openclaw_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO echo_openclaw_meta(key,value) VALUES ('schema_version','1');
    CREATE TABLE viewer_bindings (
      echo_session_id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, viewer_agent_id TEXT NOT NULL,
      viewer_session_key TEXT NOT NULL UNIQUE, core_viewer_session_id TEXT NOT NULL, host_session_id TEXT,
      lifecycle_revision INTEGER, current_attempt_id TEXT, current_run_id TEXT, current_step_instance_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO viewer_bindings VALUES ('s1','owner-A','echo-viewer','viewer-key','core-viewer',NULL,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    CREATE TABLE transport_links (
      transport_attempt_id TEXT PRIMARY KEY, echo_session_id TEXT NOT NULL, attempt_id TEXT NOT NULL, run_id TEXT,
      session_key TEXT NOT NULL, physical_ordinal INTEGER NOT NULL, call_id TEXT, status TEXT NOT NULL, provider_id TEXT NOT NULL,
      request_sha256 TEXT NOT NULL, upstream_request_id_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE runtime_event_dedup (event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,echo_session_id TEXT NOT NULL,recorded_at TEXT NOT NULL);
  `);
  legacy.close();
  const store=new EchoOpenClawStore(dbPath);
  const version=store.db.prepare("SELECT value FROM echo_openclaw_meta WHERE key='schema_version'").get();
  assert.equal(version.value,'3');
  assert.equal(store.getBinding('s1').owner_principal_id,'owner-A');
  const cols=store.db.prepare('PRAGMA table_info(viewer_recovery)').all().map((r)=>r.name);
  assert.ok(cols.includes('recovery_context_json'));
  assert.ok(cols.includes('resume_status'));
  assert.ok(cols.includes('resume_operation_id'));
  assert.ok(cols.includes('planned_session_key'));
  const eventCols=store.db.prepare('PRAGMA table_info(runtime_event_dedup)').all().map((r)=>r.name);
  assert.ok(eventCols.includes('status'));
  assert.ok(eventCols.includes('applied_at'));
  store.close(); fs.rmSync(dir,{recursive:true,force:true});
});

test('E3-FIX-B0 integration store migrates schema v2 to v3 with legacy runtime events left PENDING',()=>{
  const dir=tmp(); const dbPath=path.join(dir,'openclaw-integration.sqlite'); const legacy=new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE echo_openclaw_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO echo_openclaw_meta(key,value) VALUES ('schema_version','2');
    CREATE TABLE viewer_bindings (
      echo_session_id TEXT PRIMARY KEY, owner_principal_id TEXT NOT NULL, viewer_agent_id TEXT NOT NULL,
      viewer_session_key TEXT NOT NULL UNIQUE, core_viewer_session_id TEXT NOT NULL, host_session_id TEXT,
      lifecycle_revision INTEGER, current_attempt_id TEXT, current_run_id TEXT, current_step_instance_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE viewer_recovery (
      echo_session_id TEXT PRIMARY KEY, recovery_revision INTEGER NOT NULL DEFAULT 0, recovery_context_json TEXT,
      recovery_required INTEGER NOT NULL DEFAULT 0 CHECK (recovery_required IN (0,1)), updated_at TEXT NOT NULL
    );
    CREATE TABLE transport_links (
      transport_attempt_id TEXT PRIMARY KEY, echo_session_id TEXT NOT NULL, attempt_id TEXT NOT NULL, run_id TEXT,
      session_key TEXT NOT NULL, physical_ordinal INTEGER NOT NULL, call_id TEXT, status TEXT NOT NULL, provider_id TEXT NOT NULL,
      request_sha256 TEXT NOT NULL, upstream_request_id_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE runtime_event_dedup (event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,echo_session_id TEXT NOT NULL,recorded_at TEXT NOT NULL);
    INSERT INTO runtime_event_dedup VALUES ('evt-old','VIEWER_CONTEXT_LOST','s-old','2026-01-01T00:00:00.000Z');
  `); legacy.close();
  const store=new EchoOpenClawStore(dbPath); const version=store.db.prepare("SELECT value FROM echo_openclaw_meta WHERE key='schema_version'").get();
  assert.equal(version.value,'3'); const migrated=store.getRuntimeEvent('evt-old'); assert.equal(migrated.status,'PENDING'); assert.equal(migrated.applied_at,null);
  const recoveryCols=store.db.prepare('PRAGMA table_info(viewer_recovery)').all().map((r)=>r.name); assert.ok(recoveryCols.includes('resume_status')); assert.ok(recoveryCols.includes('planned_session_key'));
  store.close(); fs.rmSync(dir,{recursive:true,force:true});
});

test('E3-FIX-B1 PENDING Viewer context-loss event is safely completed after restart', async()=>{
  const dir=tmp(); const coreDb=path.join(dir,'core.sqlite'); const integrationDb=path.join(dir,'integration.sqlite');
  const api1=makeMockApi({dataDir:dir});
  const a1=new EchoOpenClawAdapter({api:api1,config:api1.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx1=a1.ownerContext(ownerCtx('A')); const s=a1.prepareSession(ctx1,createParams()); a1.core.startBlind(ctx1,s.session_id);
  const binding1=a1.store.getBinding(s.session_id); a1.store.setGeneration(s.session_id,{hostSessionId:'host-old',lifecycleRevision:1});
  api1._generations.set(binding1.viewer_session_key,{sessionId:'host-new',lifecycleRevision:2});
  const originalViewerContextLost=a1.core.viewerContextLost.bind(a1.core); let crashed=false;
  a1.core.viewerContextLost=(...args)=>{ if(!crashed){ crashed=true; throw new Error('simulated crash after durable event PENDING'); } return originalViewerContextLost(...args); };
  await assert.rejects(()=>a1.runNext(ctx1,s.session_id),/simulated crash/u);
  const eventId=`viewer-context-lost:${s.session_id}:host-old:1`; const pending=a1.store.getRuntimeEvent(eventId);
  assert.equal(pending.status,'PENDING'); assert.equal(a1.core.getSession(ctx1,s.session_id).state,'BLIND_RUNNING'); a1.close();

  const api2=makeMockApi({dataDir:dir}); const a2=new EchoOpenClawAdapter({api:api2,config:api2.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx2=a2.ownerContext(ownerCtx('A')); const binding2=a2.store.getBinding(s.session_id);
  api2._generations.set(binding2.viewer_session_key,{sessionId:'host-newer',lifecycleRevision:3});
  const result=await a2.runNext(ctx2,s.session_id); assert.equal(result.status,'RECOVERING');
  assert.equal(a2.store.getRuntimeEvent(eventId).status,'APPLIED'); assert.equal(a2.core.getSession(ctx2,s.session_id).state,'RECOVERING');
  assert.equal(a2.store.getRecovery(s.session_id).recovery_required,1);
  const auditB1=a2.core.auditTrail(a2.coreContext('A'),s.session_id); assert.equal(auditB1.filter((e)=>e.event_type==='VIEWER_CONTEXT_LOST'&&e.payload?.runtime_event_id===eventId).length,1);
  a2.close(); fs.rmSync(dir,{recursive:true,force:true});
});

test('E3-FIX-B2 Resume saga completes after crash between Session Core resume and Integration Store commit', async()=>{
  const dir=tmp(); const coreDb=path.join(dir,'core.sqlite'); const integrationDb=path.join(dir,'integration.sqlite');
  const api1=makeMockApi({dataDir:dir}); const a1=new EchoOpenClawAdapter({api:api1,config:api1.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx1=a1.ownerContext(ownerCtx('A')); const s=a1.prepareSession(ctx1,createParams()); a1.core.startBlind(ctx1,s.session_id);
  const binding=a1.store.getBinding(s.session_id); a1.store.setGeneration(s.session_id,{hostSessionId:'host-old',lifecycleRevision:1});
  api1._generations.set(binding.viewer_session_key,{sessionId:'host-new',lifecycleRevision:2});
  const detected=await a1.runNext(ctx1,s.session_id); assert.equal(detected.status,'RECOVERING');
  const originalMark=a1.store.markRecoveryCoreApplied.bind(a1.store); let crashed=false;
  a1.store.markRecoveryCoreApplied=(...args)=>{ if(!crashed){ crashed=true; throw new Error('simulated crash after core.resume'); } return originalMark(...args); };
  await assert.rejects(()=>a1.recoverViewerContext(ctx1,s.session_id),/simulated crash/u);
  assert.equal(a1.core.getSession(ctx1,s.session_id).state,'BLIND_RUNNING');
  const half=a1.store.getRecovery(s.session_id); assert.equal(half.resume_status,'PENDING'); assert.ok(half.planned_session_key); const planned=half.planned_session_key;
  await assert.rejects(()=>a1.perform(ctx1,'pause',{session_id:s.session_id}), (error)=>error?.code==='RECOVERY_RESUME_INCOMPLETE'); a1.close();

  const api2=makeMockApi({dataDir:dir}); const a2=new EchoOpenClawAdapter({api:api2,config:api2.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx2=a2.ownerContext(ownerCtx('A')); const resumed=await a2.perform(ctx2,'resume',{session_id:s.session_id});
  assert.equal(resumed.state,'BLIND_RUNNING'); const finalRecovery=a2.store.getRecovery(s.session_id);
  assert.equal(finalRecovery.resume_status,'COMPLETE'); assert.equal(finalRecovery.recovery_required,0); assert.equal(a2.store.getBinding(s.session_id).viewer_session_key,planned);
  const again=await a2.perform(ctx2,'resume',{session_id:s.session_id}); assert.equal(again.state,'BLIND_RUNNING');
  const auditB2=a2.core.auditTrail(a2.coreContext('A'),s.session_id); assert.equal(auditB2.filter((e)=>e.event_type==='SESSION_RESUMED').length,1);
  a2.close(); fs.rmSync(dir,{recursive:true,force:true});
});



test('E3-FIX-C1 pending Viewer context-loss after Core RECOVERING is reconciled before Resume and survives a second restart', async()=>{
  const dir=tmp(); const coreDb=path.join(dir,'core.sqlite'); const integrationDb=path.join(dir,'integration.sqlite');
  const api1=makeMockApi({dataDir:dir}); const a1=new EchoOpenClawAdapter({api:api1,config:api1.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx1=a1.ownerContext(ownerCtx('A')); const s=a1.prepareSession(ctx1,createParams()); a1.core.startBlind(ctx1,s.session_id);

  // Preserve one accepted blind result so reconciliation must not overwrite accepted work.
  const coreCtx1=a1.coreContext('A');
  const acceptedAttempt=a1.core.createAttempt(coreCtx1,s.session_id,{});
  const acceptedReceipt=a1.core.authorizePhysicalTransport(coreCtx1,acceptedAttempt.attempt_id,{provider_id:'test-provider',request_sha256:'a'.repeat(64)});
  a1.core.markTransportDispatched(coreCtx1,acceptedReceipt.transport_attempt_id);
  a1.core.completeTransport(coreCtx1,acceptedReceipt.transport_attempt_id,{provider_request_id:'c1-accepted'});
  a1.core.recordAttemptResponse(coreCtx1,acceptedAttempt.attempt_id,'READY',{transport_attempt_id:acceptedReceipt.transport_attempt_id});
  a1.core.acceptAttempt(coreCtx1,acceptedAttempt.attempt_id);
  const beforeCrash=a1.core.getSession(ctx1,s.session_id); const acceptedStep=beforeCrash.last_accepted_step_instance_id; assert.ok(acceptedStep);

  const binding1=a1.store.getBinding(s.session_id);
  a1.store.setGeneration(s.session_id,{hostSessionId:'host-c1-old',lifecycleRevision:1});
  api1._generations.set(binding1.viewer_session_key,{sessionId:'host-c1-replacement',lifecycleRevision:2});
  const currentGeneration={sessionId:'host-c1-old',lifecycleRevision:1};

  // Crash after Session Core has durably entered RECOVERING and recovered interrupted work,
  // but before Integration Store writes the recovery snapshot and marks the event APPLIED.
  const originalComplete=a1.store.completeViewerContextLossEvent.bind(a1.store); let crashed=false;
  a1.store.completeViewerContextLossEvent=(...args)=>{ if(!crashed){ crashed=true; throw new Error('simulated C1 crash after Core recovery before Integration Store apply'); } return originalComplete(...args); };
  await assert.rejects(()=>a1.runNext(ctx1,s.session_id),/simulated C1 crash/u);
  const eventId=`viewer-context-lost:${s.session_id}:${currentGeneration.sessionId}:${currentGeneration.lifecycleRevision}`;
  assert.equal(a1.core.getSession(ctx1,s.session_id).state,'RECOVERING');
  assert.equal(a1.store.getRuntimeEvent(eventId).status,'PENDING');
  assert.equal(a1.store.getRecovery(s.session_id),null);
  assert.equal(a1.core.getSession(ctx1,s.session_id).last_accepted_step_instance_id,acceptedStep);
  a1.close();

  // First restart: run_next must reconcile the orphaned event instead of throwing ILLEGAL_STATE.
  const api2=makeMockApi({dataDir:dir}); const a2=new EchoOpenClawAdapter({api:api2,config:api2.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx2=a2.ownerContext(ownerCtx('A'));
  const afterRestart=await a2.runNext(ctx2,s.session_id);
  assert.equal(afterRestart.status,'RECOVERING');
  assert.equal(a2.store.getRuntimeEvent(eventId).status,'APPLIED');
  const recovered=a2.store.getRecovery(s.session_id); assert.equal(recovered.recovery_required,1); assert.ok(recovered.recovery_context);
  assert.equal(a2.core.getSession(ctx2,s.session_id).last_accepted_step_instance_id,acceptedStep);
  const audit1=a2.core.auditTrail(a2.coreContext('A'),s.session_id);
  assert.equal(audit1.filter((e)=>e.event_type==='VIEWER_CONTEXT_LOST'&&e.payload?.runtime_event_id===eventId).length,1);
  assert.equal(audit1.filter((e)=>e.event_type==='INTERRUPTED_WORK_RECOVERED'&&String(e.payload?.reason??'').includes(`runtime_event_id=${eventId}`)).length,1);
  a2.close();

  // Second restart: Resume completes the existing workflow, without duplicating loss/recovery events.
  const api3=makeMockApi({dataDir:dir}); const a3=new EchoOpenClawAdapter({api:api3,config:api3.pluginConfig,coreDbPath:coreDb,integrationDbPath:integrationDb});
  const ctx3=a3.ownerContext(ownerCtx('A')); const resumed=await a3.perform(ctx3,'resume',{session_id:s.session_id});
  assert.equal(resumed.state,'BLIND_RUNNING');
  assert.equal(a3.store.getRuntimeEvent(eventId).status,'APPLIED');
  assert.equal(a3.store.getRecovery(s.session_id).resume_status,'COMPLETE');
  assert.equal(a3.core.getSession(ctx3,s.session_id).last_accepted_step_instance_id,acceptedStep);
  const audit2=a3.core.auditTrail(a3.coreContext('A'),s.session_id);
  assert.equal(audit2.filter((e)=>e.event_type==='VIEWER_CONTEXT_LOST'&&e.payload?.runtime_event_id===eventId).length,1);
  assert.equal(audit2.filter((e)=>e.event_type==='INTERRUPTED_WORK_RECOVERED'&&String(e.payload?.reason??'').includes(`runtime_event_id=${eventId}`)).length,1);
  assert.equal(audit2.filter((e)=>e.event_type==='SESSION_RESUMED').length,1);
  a3.close(); fs.rmSync(dir,{recursive:true,force:true});
});
test('E3-FIX-A7 Viewer prompt contains canonical methodology, not only ECHO markers',()=>{
  const cases=[
    [{protocol_id:'rcp',protocol_version:'1.5a',current_step_id:'rcp.phase1',language:'en'},/Purpose: Record the AI’s first contact/u],
    [{protocol_id:'rv-lite-core',protocol_version:'1.1.0',current_step_id:'rv-lite-core.prepare',language:'pl'},/Krok 0: Uziemienie i Cisza/u],
    [{protocol_id:'rv-lite-extended',protocol_version:'1.1.0',current_step_id:'rv-lite-extended.step3',language:'pl'},/obowiązkowo wykonaj Deepening Movement/u],
    [{protocol_id:'telepathy',protocol_version:'1.1',current_step_id:'telepathy.t4',language:'en'},/Deep Mind Probe/u],
  ];
  for(const [session,re] of cases){ const text=renderViewerPrompt({session,tasking:{tasking_mode:'neutral_code',neutral_code:'AB12'}}); assert.match(text,/CANONICAL METHODOLOGY/u); assert.match(text,re); }
});

test('E3-FIX-A7b RV Lite Prompt 4 excludes the Reveal boundary section in both PL and EN',()=>{
  for (const protocol_id of ['rv-lite-core', 'rv-lite-extended']) {
    for (const language of ['pl', 'en']) {
      const text = renderViewerPrompt({
        session: { protocol_id, protocol_version: '1.1.0', current_step_id: `${protocol_id}.step4`, language },
        tasking: { tasking_mode: 'no_code', neutral_code: null },
      });
      assert.match(text, /## PROMPT 4/u);
      assert.doesNotMatch(text, /^## (?:Granica Reveal|Reveal boundary)\b/mu);
      assert.doesNotMatch(text, /AI RV Harness/u);
    }
  }
});

async function driveFullSession({protocol_id,protocol_version,conductor_mode,tasking_mode}) {
  const api=makeMockApi(); register(api); const owner=toolFor(api,'echo_owner_session',ownerCtx('A')); const monitor=toolFor(api,'echo_monitor_session',monitorCtx('A'));
  const created=await call(owner,createParams({protocol_id,protocol_version,conductor_mode,tasking_mode})); const conductor=conductor_mode==='ai_monitor'?monitor:owner;
  let st=await call(conductor,{action:'start',session_id:created.session_id});
  let guard=0;
  while(st.state!=='BLIND_COMPLETE'){
    if(++guard>80) throw new Error(`session loop exceeded guard for ${protocol_id}/${conductor_mode}/${tasking_mode}: ${JSON.stringify(st)}`);
    st=await call(conductor,{action:'status',session_id:created.session_id});
    if(st.state==='BLIND_COMPLETE') break;
    if(st.checkpoint_pending){
      if(protocol_id==='telepathy' && st.current_step_id==='telepathy.t8' && st.telepathy_tasking_frozen_count===0){ const fr=await call(conductor,{action:'freeze_t9',session_id:created.session_id,questions:['What is the subject feeling']}); assert.equal(fr.count,1); }
      st=await call(conductor,{action:'continue',session_id:created.session_id});
    } else {
      const r=await call(conductor,{action:'run_next',session_id:created.session_id}); assert.equal(r.status,'ACCEPTED',JSON.stringify(r)); st=r.session;
    }
  }
  const reveal=await call(conductor,{action:'reveal',session_id:created.session_id}); assert.ok(reveal.reveal_operation_id);
  const post=await call(conductor,{action:'post_reveal',session_id:created.session_id}); assert.equal(post.session.state,'POST_REVEAL');
  const closed=await call(conductor,{action:'close',session_id:created.session_id}); assert.equal(closed.state,'CLOSED');
}

test('E3-FIX-E2E all four protocols complete under both conductors and both tasking modes', async(t)=>{
  const protocols=[['rcp','1.5a'],['rv-lite-core','1.1.0'],['rv-lite-extended','1.1.0'],['telepathy','1.1']];
  for(const [protocol_id,protocol_version] of protocols) for(const conductor_mode of ['human_user','ai_monitor']) for(const tasking_mode of ['neutral_code','no_code']) {
    await t.test(`${protocol_id} / ${conductor_mode} / ${tasking_mode}`,()=>driveFullSession({protocol_id,protocol_version,conductor_mode,tasking_mode}));
  }
});
