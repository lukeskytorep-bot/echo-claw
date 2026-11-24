#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const statePath = process.env.FAKE_OPENCLAW_STATE;
if (!statePath) { console.error('FAKE_OPENCLAW_STATE required'); process.exit(90); }
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { version: '2026.11.7', config: {}, installed: false, commands: [] };
const args = process.argv.slice(2);
const key = args.join(' ');
state.commands ??= []; state.commands.push(args);
const failOn = process.env.FAKE_FAIL_ON;
function save(){ fs.mkdirSync(path.dirname(statePath),{recursive:true}); fs.writeFileSync(statePath,JSON.stringify(state,null,2)); }
function done(code=0){ save(); process.exit(code); }
function out(v){ process.stdout.write(typeof v==='string'?`${v}\n`:`${JSON.stringify(v)}\n`); }
function outJson(v){ process.stdout.write(`${JSON.stringify(v)}\n`); }
function getPath(obj,p){ let cur=obj; for(const part of p.split('.')){ if(!cur || typeof cur!=='object' || !(part in cur)) return {exists:false}; cur=cur[part]; } return {exists:true,value:cur}; }
function setPath(obj,p,v){ const parts=p.split('.'); let cur=obj; for(const part of parts.slice(0,-1)){ cur[part] ??= {}; cur=cur[part]; } cur[parts.at(-1)]=v; }
function unsetPath(obj,p){ const parts=p.split('.'); let cur=obj; for(const part of parts.slice(0,-1)){ if(!cur?.[part]) return; cur=cur[part]; } delete cur[parts.at(-1)]; }
if (failOn && key.startsWith(failOn)) { console.error(`forced failure: ${key}`); done(42); }
if (args[0]==='--version'){ out(state.version ?? '2026.11.7'); done(); }
if (args[0]==='config' && args[1]==='validate'){ out({ok:true}); done(); }
if (args[0]==='config' && args[1]==='get'){
  const r=getPath(state.config,args[2]); if(!r.exists){ console.error('path not found'); done(1); } outJson(r.value); done();
}
if (args[0]==='config' && args[1]==='set'){
  let value; try{ value=JSON.parse(args[3]); }catch{ value=args[3]; } setPath(state.config,args[2],value); out({ok:true}); done();
}
if (args[0]==='config' && args[1]==='unset'){ unsetPath(state.config,args[2]); out({ok:true}); done(); }
if (args[0]==='backup' && args[1]==='create'){ out({ok:true,archive:'/tmp/fake-openclaw-config-backup.tar.gz',verified:true}); done(); }
if (args[0]==='plugins' && args[1]==='validate'){ out({ok:true}); done(); }
if (args[0]==='plugins' && args[1]==='list'){ out({plugins:state.installed?[{id:'echo-claw',enabled:true,source:state.source??'local'}]:[]}); done(); }
if (args[0]==='plugins' && args[1]==='install'){ if(!args.includes('--accept-capabilities')){ console.error('capability consent required'); done(3); } state.installed=true; state.source=args.includes('--link')?'local-link':'git'; setPath(state.config,'plugins.entries.echo-claw.enabled',true); out({ok:true,id:'echo-claw'}); done(); }
if (args[0]==='plugins' && args[1]==='uninstall'){ state.installed=false; unsetPath(state.config,'plugins.entries.echo-claw'); out({ok:true}); done(); }
if (args[0]==='plugins' && args[1]==='reload'){ if(!state.installed){ console.error('not installed'); done(1); } out({ok:true}); done(); }
if (args[0]==='plugins' && args[1]==='inspect'){
  if(!state.installed){ console.error('not installed'); done(1); }
  out({plugin:{id:'echo-claw',status:'enabled',toolNames:['echo_owner_session','echo_monitor_session']},inspectionScope:'cli',imported:true,typedHooks:[{name:'before_model_request'},{name:'model_call_started'},{name:'model_call_ended'},{name:'gateway_stop'}],gatewayRuntime:state.gateway===false?null:{status:'loaded'},diagnostics:[]}); done();
}
if (args[0]==='gateway' && args[1]==='status'){ if(state.gateway===false){ console.error('gateway unavailable'); done(1); } out('Gateway OK RPC ready'); done(); }
console.error(`unsupported fake command: ${key}`); done(2);
