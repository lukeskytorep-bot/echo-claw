#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rollbackTransaction } from '../../installer/echo4-install.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fake=path.join(root,'tests','fixtures','fake-openclaw.mjs');
const d=fs.mkdtempSync(path.join(os.tmpdir(),'e4crash-test-'));
const stateFile=path.join(d,'state.json');
fs.writeFileSync(stateFile,JSON.stringify({version:'2026.11.7',config:{},installed:false,commands:[]}));
const wrapper=path.join(d,'wrapper.mjs');
fs.writeFileSync(wrapper,`#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(fake)},args,{stdio:'inherit',env:process.env});if(args[0]==='plugins'&&args[1]==='install'&&r.status===0)process.kill(process.ppid,'SIGKILL');process.exit(r.status??1);\n`,{mode:0o755});
const opts={command:wrapper,acceptCapabilities:true,nodeVersion:'24.22.1',monitorWorkspace:path.join(d,'m'),viewerWorkspace:path.join(d,'v'),dataDir:path.join(d,'data'),transactionRoot:path.join(d,'tx')};
const mod=path.join(root,'installer','echo4-install.mjs');
const child=spawnSync(process.execPath,['--input-type=module','-e',`import {install} from ${JSON.stringify(mod)};install(${JSON.stringify(opts)});`],{env:{...process.env,FAKE_OPENCLAW_STATE:stateFile},stdio:'ignore'});
const txRoot=path.join(d,'tx'); const names=fs.existsSync(txRoot)?fs.readdirSync(txRoot):[];
if(child.signal!=='SIGKILL'||names.length!==1){process.stdout.write(JSON.stringify({ok:false,signal:child.signal,names}));process.exit(1);}
const txDir=path.join(txRoot,names[0]); const record=JSON.parse(fs.readFileSync(path.join(txDir,'transaction.json'),'utf8'));
process.env.FAKE_OPENCLAW_STATE=stateFile;
const rollback=rollbackTransaction({command:fake,transactionDir:txDir});
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
const report={ok:record.phase==='PLUGIN_INSTALL_PENDING'&&record.installIntent?.status==='PENDING'&&rollback.ok===true&&state.installed===false,phase:record.phase,intent:record.installIntent?.status,rollback:rollback.status,installed:state.installed};
process.stdout.write(`${JSON.stringify(report)}\n`); if(!report.ok) process.exitCode=1;
