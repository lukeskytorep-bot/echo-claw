#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runOpenClaw, readConfigPath, expandHome, ensureDir, stamp } from './host-ops.mjs';

function has(flag){ return process.argv.includes(flag); }
function value(flag, fallback=null){ const i=process.argv.indexOf(flag); return i>=0?process.argv[i+1]:fallback; }
function rows(db, sql, ...params){ return db.prepare(sql).all(...params); }
function single(db, sql, ...params){ return db.prepare(sql).get(...params); }
function tableColumns(db, table){ return new Set(rows(db,`PRAGMA table_info('${table.replaceAll("'","''")}')`).map(x=>x.name)); }
function hasColumns(db, table, required){ const cols=tableColumns(db,table); return required.every(x=>cols.has(x)); }

const REQUIRED_COLUMNS={
  sessions:['session_id','state','mode','protocol_id','protocol_version','conductor_mode','tasking_mode','created_at','updated_at'],
  attempts:['attempt_id','session_id','status','response_transport_attempt_id','step_id','step_instance_id','accepted_at'],
  transport_receipts:['transport_attempt_id','attempt_id','status','authorized_at','completed_at'],
  step_results:['session_id','step_instance_id','step_id','attempt_id','transport_attempt_id','accepted_at'],
  reveals:['session_id','revealed_at'],
};
const RV_LITE_CORE_RESULT_STEPS=['rv-lite-core.prepare','rv-lite-core.steps1-2','rv-lite-core.step3','rv-lite-core.step4'];

export function verifySessionEvidence(db,{sessionId,full=false,startedAt=null,expectedProtocolId='rv-lite-core',expectedProtocolVersion='1.1.0',expectedConductorMode='human_user',expectedTaskingMode='no_code'}={}){
  const assertions={};
  for(const [table,columns] of Object.entries(REQUIRED_COLUMNS)){
    assertions[`schema:${table}`]=hasColumns(db,table,columns);
    if(!assertions[`schema:${table}`]) return {ok:false,sessionId,assertions,errors:[`schema missing required columns for ${table}`]};
  }
  const session=single(db,'SELECT session_id,state,mode,protocol_id,protocol_version,conductor_mode,tasking_mode,created_at,updated_at FROM sessions WHERE session_id=?',sessionId);
  if(!session) return {ok:false,sessionId,assertions,errors:['session not found']};
  assertions.protocol=session.protocol_id===expectedProtocolId && session.protocol_version===expectedProtocolVersion;
  assertions.conductor=session.conductor_mode===expectedConductorMode;
  assertions.tasking=session.tasking_mode===expectedTaskingMode;
  assertions.mode=session.mode==='manual';
  assertions.createdDuringSmoke=!startedAt || (Number.isFinite(Date.parse(session.created_at)) && Date.parse(session.created_at)>=Date.parse(startedAt));

  const accepted=rows(db,"SELECT attempt_id,step_id,step_instance_id,response_transport_attempt_id,accepted_at FROM attempts WHERE session_id=? AND status='ACCEPTED' ORDER BY accepted_at,attempt_id",sessionId);
  const linked=rows(db,`SELECT sr.step_instance_id,sr.step_id,sr.attempt_id,sr.transport_attempt_id,sr.accepted_at,
      a.status AS attempt_status,a.response_transport_attempt_id,
      tr.status AS transport_status,tr.attempt_id AS transport_attempt_owner,tr.authorized_at,tr.completed_at
    FROM step_results sr
    JOIN attempts a ON a.attempt_id=sr.attempt_id AND a.session_id=sr.session_id
    JOIN transport_receipts tr ON tr.transport_attempt_id=sr.transport_attempt_id AND tr.attempt_id=a.attempt_id
    WHERE sr.session_id=? ORDER BY sr.accepted_at,sr.step_instance_id`,sessionId);
  const validLinks=linked.filter(x=>x.attempt_status==='ACCEPTED' && x.transport_status==='COMPLETED' && x.transport_attempt_owner===x.attempt_id && x.response_transport_attempt_id===x.transport_attempt_id);
  assertions.atLeastOneAccepted=accepted.length>=1;
  assertions.allAcceptedHaveExactlyOneBoundResult=accepted.length===linked.length && new Set(linked.map(x=>x.attempt_id)).size===accepted.length;
  assertions.allBoundResultsHaveCompletedMatchingTransport=validLinks.length===linked.length;
  assertions.transportChronology=linked.every((x)=>{
    const authorized=Date.parse(x.authorized_at??''); const completed=Date.parse(x.completed_at??''); const acceptedAt=Date.parse(x.accepted_at??'');
    return Number.isFinite(authorized)&&Number.isFinite(completed)&&Number.isFinite(acceptedAt)&&authorized<=completed&&completed<=acceptedAt;
  });

  const acceptedIds=new Set(accepted.map(x=>x.attempt_id));
  assertions.noForeignAcceptedBinding=linked.every(x=>acceptedIds.has(x.attempt_id));
  const actualSteps=linked.map(x=>x.step_id);
  const expectedSteps=full?RV_LITE_CORE_RESULT_STEPS:[RV_LITE_CORE_RESULT_STEPS[0]];
  assertions.exactExpectedAcceptedSteps=actualSteps.length===expectedSteps.length&&actualSteps.every((x,i)=>x===expectedSteps[i]);
  const reveals=rows(db,'SELECT revealed_at FROM reveals WHERE session_id=? ORDER BY revealed_at',sessionId);
  assertions.revealCount=full?reveals.length===1:reveals.length===0;
  assertions.finalState=full?session.state==='CLOSED':session.state==='BLIND_RUNNING';
  if(full){
    assertions.allRequiredRvLiteCoreSteps=actualSteps.length===RV_LITE_CORE_RESULT_STEPS.length&&actualSteps.every((x,i)=>x===RV_LITE_CORE_RESULT_STEPS[i]);
    const revealAt=Date.parse(reveals[0]?.revealed_at??'');
    assertions.revealAfterBlindResults=Number.isFinite(revealAt) && linked.every(x=>Number.isFinite(Date.parse(x.accepted_at)) && Date.parse(x.accepted_at)<=revealAt);
  } else {
    assertions.allRequiredRvLiteCoreSteps=true;
    assertions.revealAfterBlindResults=true;
  }
  return {ok:Object.values(assertions).every(Boolean),sessionId,session,acceptedCount:accepted.length,boundResultCount:linked.length,linkedResults:linked,assertions,errors:[]};
}

function main(){
  if (!has('--confirm-provider-call')) { console.error('Refusing live model/provider traffic without --confirm-provider-call'); process.exit(2); }
  const command=process.env.ECHO_OPENCLAW_BIN||'openclaw';
  const full=has('--full-session');
  const config=readConfigPath('plugins.entries.echo-claw.config.dataDir',{command});
  const dataDir=expandHome(value('--data-dir', config.exists?config.value:'~/.openclaw/echo-claw'));
  const dbPath=path.join(dataDir,'session-core.sqlite');
  if(!fs.existsSync(dbPath)){ console.error(`ECHO Session Core database not found: ${dbPath}`); process.exit(3); }
  const db=new DatabaseSync(dbPath,{readOnly:true});
  let beforeIds;
  try { beforeIds=new Set(rows(db,'SELECT session_id FROM sessions').map(x=>x.session_id)); }
  catch(error){ db.close(); console.error(`ECHO Session Core schema unavailable: ${error.message}`); process.exit(4); }
  const startedAt=new Date().toISOString();
  db.close();

  const prompt=full
    ? `ECHO-4 LIVE FULL SESSION TEST. Use only the echo_owner_session tool. Create exactly one ECHO session with protocol_id rv-lite-core, protocol_version 1.1.0, conductor_mode human_user, tasking_mode no_code, mode manual, language pl, human_blindness BLIND, viewer_blindness BLIND, target_exposure_class public. Start it. Conduct the session legally: call run_next, honor every checkpoint with continue, retry only when the tool explicitly requires it, continue until BLIND_COMPLETE, then reveal, post_reveal, and close. Do not create another session. At the end return the session_id and final state.`
    : `ECHO-4 LIVE PROVIDER SMOKE TEST. Use only the echo_owner_session tool. Create exactly one ECHO session with protocol_id rv-lite-core, protocol_version 1.1.0, conductor_mode human_user, tasking_mode no_code, mode manual, language pl, human_blindness BLIND, viewer_blindness BLIND, target_exposure_class public. Start it and execute exactly one run_next. Do not reveal and do not create another session. At the end return the session_id and run_next status.`;

  const smokeSessionKey=`echo4-${full?'full':'smoke'}-${stamp()}`;
  const result=runOpenClaw(['agent','--agent','main','--session-key',smokeSessionKey,'--message',prompt,'--json','--timeout',full?'1200':'600'],{command,timeoutMs:full?1_300_000:700_000,allowFailure:true});
  const db2=new DatabaseSync(dbPath,{readOnly:true});
  let newSessions=[]; let evidence=[]; let verifierError=null;
  try{
    newSessions=rows(db2,'SELECT session_id FROM sessions ORDER BY created_at').filter(x=>!beforeIds.has(x.session_id));
    if(newSessions.length===1) evidence=[verifySessionEvidence(db2,{sessionId:newSessions[0].session_id,full,startedAt})];
  }catch(error){ verifierError=String(error.message??error); }
  db2.close();
  const exactlyOne=newSessions.length===1;
  const proof=evidence[0]?.ok===true;
  const report={ok:result.status===0&&exactlyOne&&proof&&!verifierError,mode:full?'full-session':'one-step',startedAt,agentSessionKey:smokeSessionKey,openclawExit:result.status,stdout:result.stdout,stderr:result.stderr,newSessionIds:newSessions.map(x=>x.session_id),evidence,verifierError,assertions:{exactlyOneNewSession:exactlyOne,strictSessionEvidence:proof}};
  const outDir=expandHome(value('--output-dir','~/.openclaw/echo-claw/evidence')); ensureDir(outDir); const out=path.join(outDir,`echo4-live-${full?'full':'smoke'}-${stamp()}.json`); fs.writeFileSync(out,`${JSON.stringify(report,null,2)}\n`);
  process.stdout.write(`${JSON.stringify({...report,evidenceFile:out},null,2)}\n`);
  if(!report.ok) process.exitCode=1;
}

if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)) main();
