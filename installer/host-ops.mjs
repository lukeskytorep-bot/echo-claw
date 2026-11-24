import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ECHO4_OPENCLAW_MIN = '2026.11.7';
export const ECHO4_OPENCLAW_MAX_EXCLUSIVE = '2026.12.0';
export const ECHO4_PLUGIN_ID = 'echo-claw';

export function parseVersion(text) {
  const m = String(text ?? '').match(/(\d{4}\.\d{1,2}\.\d+(?:-[0-9A-Za-z.-]+)?)/u);
  return m?.[1] ?? null;
}

function numeric(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/u);
  if (!m) return null;
  return m.slice(1, 4).map(Number);
}
export function compareVersions(a, b) {
  const aa = numeric(a), bb = numeric(b);
  if (!aa || !bb) throw new Error(`cannot compare versions: ${a} vs ${b}`);
  for (let i = 0; i < 3; i += 1) if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
  return 0;
}
export function supportedOpenClawVersion(v) {
  if (!v || String(v).includes('-')) return false;
  return compareVersions(v, ECHO4_OPENCLAW_MIN) >= 0 && compareVersions(v, ECHO4_OPENCLAW_MAX_EXCLUSIVE) < 0;
}

export function supportedNodeVersion(v = process.versions.node) {
  const n = numeric(v);
  if (!n) return false;
  const [major, minor] = n;
  return (major === 24 && minor >= 16) || (major === 26 && minor >= 1);
}

export function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

export function runOpenClaw(args, { command = process.env.ECHO_OPENCLAW_BIN || 'openclaw', cwd, env, timeoutMs = 120_000, allowFailure = false } = {}) {
  const r = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const result = {
    command,
    args: [...args],
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error ? String(r.error.message ?? r.error) : null,
  };
  if (!allowFailure && (r.error || r.status !== 0)) {
    const err = new Error(`OpenClaw command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout || result.error}`);
    err.code = 'OPENCLAW_COMMAND_FAILED';
    err.result = result;
    throw err;
  }
  return result;
}

export function parseJsonOutput(result, label = 'OpenClaw JSON') {
  try { return JSON.parse(result.stdout); }
  catch (error) {
    const e = new Error(`${label} was not valid JSON: ${error.message}`);
    e.code = 'INVALID_OPENCLAW_JSON';
    e.result = result;
    throw e;
  }
}

function looksLikeMissingConfig(result) {
  const text = `${result?.stdout ?? ''}
${result?.stderr ?? ''}`.trim();
  return result?.status === 1 && /(?:\b(?:path|key|config|configuration)\b[^\n]{0,120}\bnot\s+found\b|\bnot\s+found\b[^\n]{0,80}\b(?:path|key|config|configuration)\b)/iu.test(text);
}

export function readConfigPath(configPath, opts = {}) {
  const r = runOpenClaw(['config', 'get', configPath, '--json'], { ...opts, allowFailure: true });
  if (r.status === 0) return { exists: true, value: parseJsonOutput(r, `config ${configPath}`), result: r };
  if (looksLikeMissingConfig(r)) return { exists: false, value: undefined, result: r, confirmedMissing: true };
  const e = new Error(`cannot determine OpenClaw config state for ${configPath}: ${r.stderr || r.stdout || r.error || `exit ${r.status}`}`);
  e.code = 'CONFIG_READ_FAILED';
  e.configPath = configPath;
  e.result = r;
  throw e;
}

export function setConfigPath(configPath, value, opts = {}) {
  return runOpenClaw(['config', 'set', configPath, JSON.stringify(value), '--strict-json'], opts);
}
export function unsetConfigPath(configPath, opts = {}) {
  return runOpenClaw(['config', 'unset', configPath], opts);
}

function registrationNames(items, candidates) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    if (typeof item === 'string') { out.push(item); continue; }
    if (!item || typeof item !== 'object') continue;
    for (const key of candidates) {
      if (typeof item[key] === 'string') { out.push(item[key]); break; }
    }
  }
  return out;
}

function hasFatalRuntimeDiagnostic(report) {
  if (['failed','error','blocked','disabled','configured-unavailable'].includes(String(report?.status ?? '').toLowerCase())) return true;
  if (['failed','error','blocked','disabled','configured-unavailable'].includes(String(report?.loadStatus ?? report?.load_status ?? '').toLowerCase())) return true;
  const diagnostics = Array.isArray(report?.diagnostics) ? report.diagnostics : [];
  return diagnostics.some((d) => {
    if (typeof d === 'string') return /(^|\b)(error|failed|blocked|missing dependency)(\b|:)/iu.test(d);
    const severity = String(d?.severity ?? d?.level ?? d?.status ?? '').toLowerCase();
    return ['error','fatal','failed','blocked'].includes(severity);
  });
}

export function assertRuntimeRegistration(report, { requireGatewayRuntime = false } = {}) {
  const requiredTools = ['echo_owner_session', 'echo_monitor_session'];
  const requiredHooks = ['before_model_request', 'model_call_started', 'model_call_ended'];
  if (!report || typeof report !== 'object') {
    const e = new Error('runtime inspection did not return an object');
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE';
    e.report = report;
    throw e;
  }

  // OpenClaw 2026.11.x keeps the cold registry status under `plugin.status`,
  // reports the CLI runtime import separately as top-level `imported`, labels
  // runtime registrations with `inspectionScope: "cli"`, and (when reachable)
  // reports the active Gateway independently under `gatewayRuntime`.
  const plugin = report.plugin;
  if (!plugin || typeof plugin !== 'object' || plugin.id !== ECHO4_PLUGIN_ID) {
    const e = new Error('runtime inspection did not identify the echo-claw plugin');
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE'; e.report = report; throw e;
  }
  const registryStatus = String(plugin.status ?? '').toLowerCase();
  if (!['enabled', 'loaded'].includes(registryStatus)) {
    const e = new Error(`runtime inspection reports unusable plugin registry status: ${plugin.status ?? 'missing'}`);
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE'; e.report = report; throw e;
  }
  const imported = report.imported === true;
  if (!imported || report.inspectionScope !== 'cli' || hasFatalRuntimeDiagnostic(report)) {
    const e = new Error('runtime inspection did not report a healthy CLI runtime import for echo-claw');
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE'; e.report = report; throw e;
  }

  const tools = new Set(Array.isArray(plugin.toolNames) ? plugin.toolNames.filter((x) => typeof x === 'string') : []);
  const typedHooks = Array.isArray(report.typedHooks) ? report.typedHooks : [];
  const hooks = new Set(registrationNames(typedHooks, ['name','hookName','id','hook','event']));
  const missing = [
    ...requiredTools.filter((name) => !tools.has(name)),
    ...requiredHooks.filter((name) => !hooks.has(name)),
  ];
  if (missing.length) {
    const e = new Error(`runtime inspection missing required registrations: ${missing.join(', ')}`);
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE';
    e.missing = missing;
    e.report = report;
    throw e;
  }

  const gateway = report.gatewayRuntime;
  const gatewayLoaded = gateway != null && String(gateway.status ?? '').toLowerCase() === 'loaded';
  if (gateway != null && !gatewayLoaded) {
    const e = new Error(`Gateway runtime reports echo-claw as ${gateway.status ?? 'unknown'}, not loaded`);
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE'; e.report = report; throw e;
  }
  if (requireGatewayRuntime && !gatewayLoaded) {
    const e = new Error('active Gateway runtime did not confirm echo-claw as loaded');
    e.code = 'RUNTIME_REGISTRATION_INCOMPLETE'; e.report = report; throw e;
  }

  return {
    ok: true,
    required: [...requiredTools, ...requiredHooks],
    tools: [...tools],
    hooks: [...hooks],
    cliImported: true,
    gatewayRuntime: gatewayLoaded ? 'loaded' : 'unavailable',
  };
}

export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    try {
      const dirfd = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); }
    } catch {}
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    if (fs.existsSync(tmp)) try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}
export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function stamp() { return new Date().toISOString().replace(/[:.]/gu, '-'); }
