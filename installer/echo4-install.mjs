#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ECHO4_PLUGIN_ID, ECHO4_OPENCLAW_MIN, ECHO4_OPENCLAW_MAX_EXCLUSIVE,
  parseVersion, supportedOpenClawVersion, supportedNodeVersion, expandHome,
  runOpenClaw, parseJsonOutput, readConfigPath, setConfigPath, unsetConfigPath,
  assertRuntimeRegistration, ensureDir, writeJson, stamp,
} from './host-ops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MONITOR_WORKSPACE = '~/.openclaw/workspace-echo-monitor';
const DEFAULT_VIEWER_WORKSPACE = '~/.openclaw/workspace-echo-viewer';
const DEFAULT_DATA_DIR = '~/.openclaw/echo-claw';
const CONFIG_PATHS = [
  'plugins.entries.echo-claw',
  'plugins.allow',
  'plugins.deny',
  'agents.entries.echo-monitor',
  'agents.entries.echo-viewer',
  'agents.entries.main.tools',
];

function argValue(args, flag, fallback = undefined) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback; }
function has(args, flag) { return args.includes(flag); }
function jsonPrint(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function stable(v) { return JSON.stringify(v); }
function sameValue(a, b) { return stable(a) === stable(b); }
function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fileSha256(file) { return fs.existsSync(file) ? sha256Buffer(fs.readFileSync(file)) : null; }

function pluginEntryFromList(value) {
  if (Array.isArray(value)) return value.find((x) => x?.id === ECHO4_PLUGIN_ID) ?? null;
  if (Array.isArray(value?.plugins)) return value.plugins.find((x) => x?.id === ECHO4_PLUGIN_ID) ?? null;
  return null;
}

function listPlugins(command) {
  const result = runOpenClaw(['plugins', 'list', '--json'], { command, allowFailure: true });
  if (result.status !== 0) {
    const e = new Error(`cannot read OpenClaw plugin inventory: ${result.stderr || result.stdout || result.error || `exit ${result.status}`}`);
    e.code = 'PLUGIN_LIST_FAILED'; e.result = result; throw e;
  }
  return { report: parseJsonOutput(result, 'plugin list'), result };
}

function installedPlugin(command) { return pluginEntryFromList(listPlugins(command).report); }

export function preflight({ command, requireGateway = false, nodeVersion = process.versions.node } = {}) {
  const result = { ok: true, node: { version: nodeVersion, supported: supportedNodeVersion(nodeVersion) }, openclaw: {}, checks: [] };
  if (!result.node.supported) {
    result.ok = false;
    result.checks.push({ id: 'node', ok: false, message: 'ECHO-4 validates Node 24.16+ on 24.x or Node 26.1+ on 26.x; other OpenClaw-accepted lines require a separate ECHO compatibility audit.' });
  } else result.checks.push({ id: 'node', ok: true });
  const vr = runOpenClaw(['--version'], { command, allowFailure: true });
  const version = parseVersion(`${vr.stdout}\n${vr.stderr}`);
  result.openclaw = { version, supported: supportedOpenClawVersion(version), raw: vr.stdout.trim() || vr.stderr.trim() };
  if (!result.openclaw.supported) {
    result.ok = false;
    result.checks.push({ id: 'openclaw-version', ok: false, message: `Expected >=${ECHO4_OPENCLAW_MIN} <${ECHO4_OPENCLAW_MAX_EXCLUSIVE}; got ${version ?? 'unavailable'}` });
  } else result.checks.push({ id: 'openclaw-version', ok: true });
  const cv = runOpenClaw(['config', 'validate', '--json'], { command, allowFailure: true });
  result.checks.push({ id: 'config-validate', ok: cv.status === 0, stdout: cv.stdout.trim(), stderr: cv.stderr.trim() });
  if (cv.status !== 0) result.ok = false;
  const pv = runOpenClaw(['plugins', 'validate', '--root', ROOT, '--entry', './dist/index.js', '--json'], { command, cwd: ROOT, allowFailure: true });
  result.checks.push({ id: 'plugin-validate', ok: pv.status === 0, stdout: pv.stdout.trim(), stderr: pv.stderr.trim() });
  if (pv.status !== 0) result.ok = false;
  if (requireGateway) {
    const gw = runOpenClaw(['gateway', 'status', '--deep', '--require-rpc'], { command, allowFailure: true });
    result.checks.push({ id: 'gateway-rpc', ok: gw.status === 0, stdout: gw.stdout.trim(), stderr: gw.stderr.trim() });
    if (gw.status !== 0) result.ok = false;
  }
  return result;
}

function normalizedWorkspace(p) { return path.resolve(expandHome(p)); }
function workspaceOverlap(a, b) {
  const aa = normalizedWorkspace(a), bb = normalizedWorkspace(b);
  if (aa === bb) return true;
  const relAB = path.relative(aa, bb), relBA = path.relative(bb, aa);
  return (!!relAB && !relAB.startsWith('..') && !path.isAbsolute(relAB)) || (!!relBA && !relBA.startsWith('..') && !path.isAbsolute(relBA));
}

export function buildPlan({ command, monitorWorkspace = DEFAULT_MONITOR_WORKSPACE, viewerWorkspace = DEFAULT_VIEWER_WORKSPACE, dataDir = DEFAULT_DATA_DIR } = {}) {
  const plugin = pluginEntryFromList(listPlugins(command).report);
  const read = (p) => readConfigPath(p, { command });
  const monitor = read('agents.entries.echo-monitor');
  const viewer = read('agents.entries.echo-viewer');
  const pluginConfig = read('plugins.entries.echo-claw');
  const conflicts = [];
  const expectedMonitor = expandHome(monitorWorkspace), expectedViewer = expandHome(viewerWorkspace);
  if (workspaceOverlap(expectedMonitor, expectedViewer)) conflicts.push({ path: 'agents.entries.echo-monitor/viewer.workspace', existing: [monitorWorkspace, viewerWorkspace], expected: 'distinct non-overlapping workspaces' });
  if (monitor.exists && monitor.value?.workspace && expandHome(monitor.value.workspace) !== expectedMonitor) conflicts.push({ path: 'agents.entries.echo-monitor.workspace', existing: monitor.value.workspace, expected: monitorWorkspace });
  if (monitor.exists && monitor.value?.skills !== undefined && stable(monitor.value.skills) !== stable([])) conflicts.push({ path: 'agents.entries.echo-monitor.skills', existing: monitor.value.skills, expected: [] });
  if (monitor.exists && monitor.value?.tools?.allow !== undefined && stable(monitor.value.tools.allow) !== stable(['echo_monitor_session'])) conflicts.push({ path: 'agents.entries.echo-monitor.tools.allow', existing: monitor.value.tools.allow, expected: ['echo_monitor_session'] });
  if (viewer.exists && viewer.value?.workspace && expandHome(viewer.value.workspace) !== expectedViewer) conflicts.push({ path: 'agents.entries.echo-viewer.workspace', existing: viewer.value.workspace, expected: viewerWorkspace });
  if (viewer.exists && viewer.value?.skills !== undefined && stable(viewer.value.skills) !== stable([])) conflicts.push({ path: 'agents.entries.echo-viewer.skills', existing: viewer.value.skills, expected: [] });
  if (viewer.exists && viewer.value?.tools?.deny !== undefined && !(Array.isArray(viewer.value.tools.deny) && viewer.value.tools.deny.includes('*'))) conflicts.push({ path: 'agents.entries.echo-viewer.tools.deny', existing: viewer.value.tools.deny, expected: ['*'] });
  if (pluginConfig.exists && pluginConfig.value?.config?.dataDir && expandHome(pluginConfig.value.config.dataDir) !== expandHome(dataDir)) conflicts.push({ path: 'plugins.entries.echo-claw.config.dataDir', existing: pluginConfig.value.config.dataDir, expected: dataDir });
  for (const [key, expected] of Object.entries({ ownerAgentId: 'main', monitorAgentId: 'echo-monitor', viewerAgentId: 'echo-viewer' })) {
    const existing = pluginConfig.value?.config?.[key];
    if (existing !== undefined && existing !== expected) conflicts.push({ path: `plugins.entries.echo-claw.config.${key}`, existing, expected });
  }
  for (const key of ['allowModelRequest', 'allowConversationAccess', 'allowPromptModification']) {
    const existing = pluginConfig.value?.hooks?.[key];
    if (existing !== undefined && existing !== true) conflicts.push({ path: `plugins.entries.echo-claw.hooks.${key}`, existing, expected: true });
  }
  return {
    ok: conflicts.length === 0,
    pluginInstalled: !!plugin,
    plugin,
    monitorExists: monitor.exists,
    viewerExists: viewer.exists,
    pluginConfigExists: pluginConfig.exists,
    conflicts,
    desired: { dataDir, monitorWorkspace, viewerWorkspace, ownerAgentId: 'main', monitorAgentId: 'echo-monitor', viewerAgentId: 'echo-viewer' },
  };
}

function snapshotConfig(command) {
  const out = {};
  for (const p of CONFIG_PATHS) out[p] = readConfigPath(p, { command });
  return out;
}

function configStateComparable(item) { return item?.exists ? { exists: true, value: item.value } : { exists: false }; }
function verifyConfigSnapshot(snapshot, command) {
  const errors = [];
  for (const [p, expected] of Object.entries(snapshot ?? {})) {
    try {
      const actual = readConfigPath(p, { command });
      if (!sameValue(configStateComparable(actual), configStateComparable(expected))) errors.push({ phase: 'config-verify', path: p, expected: configStateComparable(expected), actual: configStateComparable(actual) });
    } catch (error) { errors.push({ phase: 'config-verify', path: p, error: String(error.message ?? error) }); }
  }
  return errors;
}

function restoreConfig(snapshot, command) {
  const errors = [];
  for (const [p, item] of Object.entries(snapshot ?? {})) {
    try {
      if (item.exists) setConfigPath(p, item.value, { command });
      else unsetConfigPath(p, { command });
    } catch (error) { errors.push({ phase: 'config-restore', path: p, error: String(error.message ?? error), result: error.result ?? null }); }
  }
  errors.push(...verifyConfigSnapshot(snapshot, command));
  return errors;
}

function backupFolderFor(txDir, role, destDir) {
  const id = crypto.createHash('sha256').update(path.resolve(destDir)).digest('hex').slice(0, 16);
  return path.join(txDir, 'workspace-backup', role, id);
}

function planWorkspace(srcDir, destDir, txDir, role, force = false) {
  const changes = [];
  for (const name of ['AGENTS.md', 'SOUL.md']) {
    const source = path.join(srcDir, name), dest = path.join(destDir, name);
    const content = fs.readFileSync(source);
    const installedSha256 = sha256Buffer(content);
    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest);
      if (Buffer.compare(existing, content) === 0) { changes.push({ role, file: dest, source, action: 'unchanged', installedSha256 }); continue; }
      if (!force) { const e = new Error(`workspace conflict: ${dest}`); e.code = 'WORKSPACE_CONFLICT'; throw e; }
      const backup = path.join(backupFolderFor(txDir, role, destDir), name); ensureDir(path.dirname(backup)); fs.copyFileSync(dest, backup);
      changes.push({ role, file: dest, source, action: 'overwritten', backup, originalSha256: sha256Buffer(existing), installedSha256 });
    } else changes.push({ role, file: dest, source, action: 'created', installedSha256 });
  }
  return changes;
}
function applyWorkspacePlan(changes = []) {
  for (const c of changes) if (c.action !== 'unchanged') { ensureDir(path.dirname(c.file)); fs.copyFileSync(c.source, c.file); }
}
function verifyWorkspaceInstalled(changes = []) {
  const conflicts = [];
  for (const c of changes) {
    if (c.action === 'unchanged') continue;
    const current = fileSha256(c.file);
    const safe = c.action === 'created'
      ? (current === c.installedSha256 || current === null)
      : c.action === 'overwritten'
        ? (current === c.installedSha256 || current === c.originalSha256)
        : true;
    if (!safe) conflicts.push({ phase: 'workspace-user-change', role: c.role, file: c.file, expectedInstalledSha256: c.installedSha256, originalSha256: c.originalSha256 ?? null, currentSha256: current });
  }
  return conflicts;
}
function restoreWorkspace(changes = [], { forceUserChanges = false } = {}) {
  const errors = [];
  if (!forceUserChanges) {
    const conflicts = verifyWorkspaceInstalled(changes);
    if (conflicts.length) return { errors, conflicts };
  }
  for (const c of [...changes].reverse()) {
    try {
      const current = fileSha256(c.file);
      if (c.action === 'created') {
        if (forceUserChanges || current === c.installedSha256) fs.rmSync(c.file, { force: true });
      }
      if (c.action === 'overwritten' && c.backup) {
        if (forceUserChanges || current === c.installedSha256) fs.copyFileSync(c.backup, c.file);
      }
      if (c.action === 'created' && fs.existsSync(c.file)) errors.push({ phase: 'workspace-verify', file: c.file, error: 'created file still exists after rollback' });
      if (c.action === 'overwritten' && c.originalSha256 && fileSha256(c.file) !== c.originalSha256) errors.push({ phase: 'workspace-verify', file: c.file, error: 'restored file hash mismatch' });
    } catch (error) { errors.push({ phase: 'workspace-restore', file: c.file, error: String(error.message ?? error) }); }
  }
  return { errors, conflicts: [] };
}

function addOwnerTool(command) {
  const allow = readConfigPath('agents.entries.main.tools.allow', { command });
  if (allow.exists && Array.isArray(allow.value)) {
    if (!allow.value.includes('echo_owner_session')) setConfigPath('agents.entries.main.tools.allow', [...allow.value, 'echo_owner_session'], { command });
    return { path: 'agents.entries.main.tools.allow', mode: 'allow' };
  }
  const also = readConfigPath('agents.entries.main.tools.alsoAllow', { command });
  const next = Array.isArray(also.value) ? [...also.value] : [];
  if (!next.includes('echo_owner_session')) next.push('echo_owner_session');
  setConfigPath('agents.entries.main.tools.alsoAllow', next, { command });
  return { path: 'agents.entries.main.tools.alsoAllow', mode: 'alsoAllow' };
}

function pluginMatchesIntent(plugin, tx) {
  if (!plugin || plugin.id !== ECHO4_PLUGIN_ID) return false;
  const text = stable(plugin).toLowerCase();
  if (tx.source === 'git') return text.includes('git') || (tx.gitRef && text.includes(String(tx.gitRef).toLowerCase()));
  return text.includes('local') || text.includes('link') || text.includes(ROOT.toLowerCase());
}

function detectConfigPostInstallChanges(tx, command) {
  if (!tx.configAfter) return [];
  const conflicts = [];
  for (const [p, expected] of Object.entries(tx.configAfter)) {
    try {
      const actual = readConfigPath(p, { command });
      if (!sameValue(configStateComparable(actual), configStateComparable(expected))) conflicts.push({ phase: 'config-user-change', path: p, expected: configStateComparable(expected), actual: configStateComparable(actual) });
    } catch (error) { conflicts.push({ phase: 'config-user-change', path: p, error: String(error.message ?? error) }); }
  }
  return conflicts;
}

function reconcileInstallOwnership(tx, command) {
  let plugin;
  try { plugin = installedPlugin(command); } catch (error) { return { installed: null, owned: false, error }; }
  if (!plugin) return { installed: false, owned: false, plugin: null };
  if (tx.installedByTransaction || tx.installIntent?.status === 'APPLIED') return { installed: true, owned: true, plugin };
  if (tx.installIntent?.status === 'PENDING' && !tx.pluginWasInstalled && pluginMatchesIntent(plugin, tx)) return { installed: true, owned: true, plugin, reconciledFromPending: true };
  return { installed: true, owned: false, plugin };
}

function rollbackCore({ tx, command, forceUserChanges = false, transactionDir, automatic = false }) {
  const result = { ok: true, status: 'ROLLBACK_IN_PROGRESS', transactionDir, automatic, startedAt: new Date().toISOString(), conflicts: [], errors: [] };
  if (!forceUserChanges && tx.configAfter) {
    result.conflicts.push(...detectConfigPostInstallChanges(tx, command));
    result.conflicts.push(...verifyWorkspaceInstalled(tx.workspaceChanges ?? []));
    if (result.conflicts.length) {
      result.ok = false; result.status = 'ROLLBACK_BLOCKED_USER_CHANGES'; result.completedAt = new Date().toISOString();
      writeJson(path.join(transactionDir, automatic ? 'rollback.json' : 'manual-rollback.json'), result);
      return result;
    }
  }

  const ownership = reconcileInstallOwnership(tx, command);
  if (ownership.error) result.errors.push({ phase: 'plugin-reconcile', error: String(ownership.error.message ?? ownership.error) });
  if (ownership.installed && !ownership.owned) result.errors.push({ phase: 'plugin-reconcile', error: 'echo-claw is installed but cannot be proven to belong to this transaction' });
  if (ownership.owned) {
    const u = runOpenClaw(['plugins', 'uninstall', ECHO4_PLUGIN_ID, '--force'], { command, allowFailure: true });
    if (u.status !== 0) result.errors.push({ phase: 'plugin-uninstall', stdout: u.stdout, stderr: u.stderr, error: u.error });
  }

  try { result.errors.push(...restoreConfig(tx.configBefore ?? {}, command)); }
  catch (e) { result.errors.push({ phase: 'config', error: String(e.message ?? e) }); }
  try {
    const wr = restoreWorkspace(tx.workspaceChanges ?? [], { forceUserChanges: forceUserChanges || automatic });
    result.errors.push(...wr.errors); result.conflicts.push(...wr.conflicts);
  } catch (e) { result.errors.push({ phase: 'workspace', error: String(e.message ?? e) }); }

  try {
    const pluginNow = installedPlugin(command);
    if (ownership.owned && pluginNow) result.errors.push({ phase: 'plugin-verify', error: 'echo-claw remains installed after rollback' });
  } catch (error) { result.errors.push({ phase: 'plugin-verify', error: String(error.message ?? error) }); }

  result.ok = result.errors.length === 0 && result.conflicts.length === 0;
  result.status = result.ok ? 'ROLLED_BACK' : (result.conflicts.length ? 'ROLLBACK_BLOCKED_USER_CHANGES' : 'ROLLBACK_INCOMPLETE');
  result.completedAt = new Date().toISOString();
  writeJson(path.join(transactionDir, automatic ? 'rollback.json' : 'manual-rollback.json'), result);
  return result;
}

export function install({ command, source = 'local-link', gitRef = null, forceConflicts = false, acceptCapabilities = false, transactionRoot = null, dataDir = DEFAULT_DATA_DIR, monitorWorkspace = DEFAULT_MONITOR_WORKSPACE, viewerWorkspace = DEFAULT_VIEWER_WORKSPACE, nodeVersion = process.versions.node } = {}) {
  if (!['local-link', 'git'].includes(source)) { const e = new Error(`unsupported install source: ${source}`); e.code = 'UNSUPPORTED_INSTALL_SOURCE'; throw e; }
  if (source === 'git' && !gitRef) { const e = new Error('git installation requires an explicit --git-ref (prefer a commit SHA)'); e.code = 'GIT_REF_REQUIRED'; throw e; }
  if (!acceptCapabilities) { const e = new Error('ECHO-CLAW declares plugin capabilities. Review openclaw.plugin.json and rerun with --accept-capabilities.'); e.code = 'CAPABILITY_CONSENT_REQUIRED'; e.details = { contracts: JSON.parse(fs.readFileSync(path.join(ROOT, 'openclaw.plugin.json'), 'utf8')).contracts ?? {} }; throw e; }
  if (workspaceOverlap(monitorWorkspace, viewerWorkspace)) { const e = new Error('Monitor and Viewer workspaces must be distinct and non-overlapping'); e.code = 'WORKSPACE_OVERLAP'; throw e; }
  const pf = preflight({ command, requireGateway: false, nodeVersion });
  if (!pf.ok) { const e = new Error('ECHO-4 preflight failed'); e.code = 'PREFLIGHT_FAILED'; e.details = pf; throw e; }
  const plan = buildPlan({ command, dataDir, monitorWorkspace, viewerWorkspace });
  if (plan.conflicts.length && !forceConflicts) { const e = new Error('ECHO-4 install conflicts detected'); e.code = 'INSTALL_CONFLICT'; e.details = plan; throw e; }
  if (plan.pluginInstalled) { const e = new Error('echo-claw is already installed; ECHO-4 installer refuses to replace an existing tracked plugin automatically'); e.code = 'PLUGIN_ALREADY_INSTALLED'; e.details = plan; throw e; }

  const txBase = expandHome(transactionRoot ?? '~/.openclaw/echo-claw-install-transactions');
  const txDir = path.join(txBase, stamp()); ensureDir(txDir);
  const txFile = path.join(txDir, 'transaction.json');
  const tx = { version: 2, startedAt: new Date().toISOString(), root: ROOT, source, gitRef, plan, configBefore: snapshotConfig(command), configAfter: null, workspaceChanges: [], pluginWasInstalled: false, installedByTransaction: false, installIntent: null, status: 'IN_PROGRESS', phase: 'SNAPSHOT_COMPLETE', commands: [] };
  writeJson(txFile, tx);
  try {
    const backup = runOpenClaw(['backup', 'create', '--only-config', '--verify', '--json'], { command });
    fs.writeFileSync(path.join(txDir, 'openclaw-config-backup-output.json'), backup.stdout || '{}', 'utf8');

    const installArgs = source === 'git'
      ? ['plugins', 'install', `git:github.com/lukeskytorep-bot/echo-claw${gitRef ? `@${gitRef}` : ''}`, '--force', '--accept-capabilities']
      : ['plugins', 'install', '--link', ROOT, '--force', '--accept-capabilities'];
    tx.installIntent = { status: 'PENDING', command: installArgs, source, gitRef, recordedAt: new Date().toISOString() };
    tx.phase = 'PLUGIN_INSTALL_PENDING'; writeJson(txFile, tx);
    runOpenClaw(installArgs, { command });
    tx.installedByTransaction = true; tx.installIntent.status = 'APPLIED'; tx.installIntent.appliedAt = new Date().toISOString(); tx.phase = 'PLUGIN_INSTALLED'; writeJson(txFile, tx);

    setConfigPath('plugins.entries.echo-claw.config.dataDir', dataDir, { command });
    setConfigPath('plugins.entries.echo-claw.config.ownerAgentId', 'main', { command });
    setConfigPath('plugins.entries.echo-claw.config.monitorAgentId', 'echo-monitor', { command });
    setConfigPath('plugins.entries.echo-claw.config.viewerAgentId', 'echo-viewer', { command });
    setConfigPath('plugins.entries.echo-claw.hooks.allowModelRequest', true, { command });
    setConfigPath('plugins.entries.echo-claw.hooks.allowConversationAccess', true, { command });
    setConfigPath('plugins.entries.echo-claw.hooks.allowPromptModification', true, { command });

    const monitorDest = expandHome(monitorWorkspace), viewerDest = expandHome(viewerWorkspace);
    if (workspaceOverlap(monitorDest, viewerDest)) { const e = new Error('Monitor and Viewer workspaces must be distinct and non-overlapping'); e.code = 'WORKSPACE_OVERLAP'; throw e; }
    const monitorPlan = planWorkspace(path.join(ROOT, 'agents', 'monitor'), monitorDest, txDir, 'monitor', forceConflicts);
    const viewerPlan = planWorkspace(path.join(ROOT, 'agents', 'viewer'), viewerDest, txDir, 'viewer', forceConflicts);
    tx.workspaceChanges.push(...monitorPlan, ...viewerPlan); tx.phase = 'WORKSPACE_PLANNED'; writeJson(txFile, tx);
    applyWorkspacePlan(monitorPlan); applyWorkspacePlan(viewerPlan); tx.phase = 'WORKSPACE_APPLIED'; writeJson(txFile, tx);
    setConfigPath('agents.entries.echo-monitor.workspace', monitorWorkspace, { command });
    setConfigPath('agents.entries.echo-monitor.skills', [], { command });
    setConfigPath('agents.entries.echo-monitor.tools.allow', ['echo_monitor_session'], { command });
    setConfigPath('agents.entries.echo-viewer.workspace', viewerWorkspace, { command });
    setConfigPath('agents.entries.echo-viewer.skills', [], { command });
    setConfigPath('agents.entries.echo-viewer.tools.deny', ['*'], { command });
    tx.ownerToolPolicy = addOwnerTool(command); tx.phase = 'CONFIG_APPLIED'; tx.configAfter = snapshotConfig(command); writeJson(txFile, tx);

    runOpenClaw(['config', 'validate', '--json'], { command });
    const gateway = runOpenClaw(['gateway', 'status', '--deep', '--require-rpc'], { command, allowFailure: true });
    tx.gatewayReachable = gateway.status === 0;
    if (tx.gatewayReachable) {
      const reload = runOpenClaw(['plugins', 'reload', ECHO4_PLUGIN_ID, '--wait', '--json'], { command, allowFailure: true });
      if (reload.status !== 0) { const e = new Error(`OpenClaw Gateway plugin reload failed: ${reload.stderr || reload.stdout}`); e.code = 'PLUGIN_RELOAD_FAILED'; e.result = reload; throw e; }
      tx.gatewayReload = parseJsonOutput(reload, 'plugin reload');
    }
    const inspect = parseJsonOutput(runOpenClaw(['plugins', 'inspect', ECHO4_PLUGIN_ID, '--runtime', '--json'], { command }), 'runtime inspect');
    assertRuntimeRegistration(inspect);
    tx.configAfter = snapshotConfig(command);
    tx.pluginAfter = installedPlugin(command);
    tx.completedAt = new Date().toISOString(); tx.status = 'COMPLETE'; tx.phase = 'COMPLETE';
    writeJson(txFile, tx);
    return { ok: true, transactionDir: txDir, gatewayReachable: tx.gatewayReachable, runtimeInspection: inspect, plan };
  } catch (error) {
    const rollback = rollbackCore({ tx, command, forceUserChanges: false, transactionDir: txDir, automatic: true });
    tx.status = rollback.status; tx.failure = { code: error.code ?? 'ERROR', message: String(error.message ?? error) }; tx.rollbackStatus = rollback.status;
    writeJson(txFile, tx);
    error.transactionDir = txDir; error.rollback = rollback; throw error;
  }
}

export function rollbackTransaction({ command, transactionDir, forceUserChanges = false } = {}) {
  if (!transactionDir) throw new Error('transactionDir required');
  const file = path.join(transactionDir, 'transaction.json');
  if (!fs.existsSync(file)) throw new Error(`transaction not found: ${file}`);
  const tx = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = rollbackCore({ tx, command, forceUserChanges, transactionDir, automatic: false });
  tx.lastRollbackStatus = result.status; tx.lastRollbackAt = result.completedAt;
  if (result.ok) { tx.status = 'ROLLED_BACK'; tx.rollbackStatus = result.status; tx.rolledBackAt = result.completedAt; }
  writeJson(file, tx);
  return result;
}

function usage() {
  return `ECHO-4 installer\n\nCommands:\n  preflight [--require-gateway] [--json]\n  plan [--json]\n  install [--source local-link|git] [--git-ref <ref>] --accept-capabilities [--force-conflicts] [--json]\n  rollback --transaction <dir> [--force-user-changes] [--json]\n\nEnvironment:\n  ECHO_OPENCLAW_BIN  override OpenClaw executable (used by tests too)\n`;
}

async function main() {
  const args = process.argv.slice(2), action = args[0]; const command = process.env.ECHO_OPENCLAW_BIN || 'openclaw';
  if (!action || has(args, '--help')) { process.stdout.write(usage()); return; }
  let result;
  if (action === 'preflight') result = preflight({ command, requireGateway: has(args, '--require-gateway') });
  else if (action === 'plan') result = buildPlan({ command });
  else if (action === 'install') result = install({ command, source: argValue(args, '--source', 'local-link'), gitRef: argValue(args, '--git-ref', null), forceConflicts: has(args, '--force-conflicts'), acceptCapabilities: has(args, '--accept-capabilities') });
  else if (action === 'rollback') result = rollbackTransaction({ command, transactionDir: argValue(args, '--transaction'), forceUserChanges: has(args, '--force-user-changes') });
  else throw new Error(`unknown action ${action}`);
  if (has(args, '--json')) jsonPrint(result); else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result?.ok === false) process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error?.stack ?? error); if (error.transactionDir) console.error(`ECHO transaction: ${error.transactionDir}`); process.exitCode = 1; });
