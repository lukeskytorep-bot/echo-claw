#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ECHO4_PLUGIN_ID, parseVersion, supportedOpenClawVersion, supportedNodeVersion,
  runOpenClaw, parseJsonOutput, readConfigPath, assertRuntimeRegistration,
} from './host-ops.mjs';

function check(id, ok, details = {}) { return { id, ok: !!ok, ...details }; }
function main() {
  const command = process.env.ECHO_OPENCLAW_BIN || 'openclaw';
  const out = { ok: true, checkedAt: new Date().toISOString(), checks: [] };

  out.checks.push(check('node-runtime', supportedNodeVersion(), { version: process.versions.node }));
  const v = runOpenClaw(['--version'], { command, allowFailure: true });
  const version = parseVersion(`${v.stdout}\n${v.stderr}`);
  out.checks.push(check('openclaw-version', supportedOpenClawVersion(version), { version, raw: v.stdout.trim() || v.stderr.trim() }));

  const cv = runOpenClaw(['config', 'validate', '--json'], { command, allowFailure: true });
  out.checks.push(check('config-validate', cv.status === 0, { stdout: cv.stdout.trim(), stderr: cv.stderr.trim() }));

  const gw = runOpenClaw(['gateway', 'status', '--deep', '--require-rpc'], { command, allowFailure: true });
  out.checks.push(check('gateway-rpc', gw.status === 0, { stdout: gw.stdout.trim(), stderr: gw.stderr.trim() }));

  const reloadResult = runOpenClaw(['plugins', 'reload', ECHO4_PLUGIN_ID, '--wait', '--json'], { command, allowFailure: true });
  out.checks.push(check('gateway-plugin-reload', reloadResult.status === 0, { stdout: reloadResult.stdout.trim(), stderr: reloadResult.stderr.trim() }));

  const inspectResult = runOpenClaw(['plugins', 'inspect', ECHO4_PLUGIN_ID, '--runtime', '--json'], { command, allowFailure: true });
  let inspect = null; let runtimeOk = false; let runtimeError = null;
  if (inspectResult.status === 0) {
    try { inspect = parseJsonOutput(inspectResult, 'runtime inspect'); assertRuntimeRegistration(inspect, { requireGatewayRuntime: true }); runtimeOk = true; }
    catch (error) { runtimeError = String(error.message ?? error); }
  }
  out.checks.push(check('runtime-registration', runtimeOk, { error: runtimeError, stderr: inspectResult.stderr.trim() }));

  const expected = {
    'plugins.entries.echo-claw.hooks.allowModelRequest': true,
    'plugins.entries.echo-claw.hooks.allowConversationAccess': true,
    'plugins.entries.echo-claw.hooks.allowPromptModification': true,
    'plugins.entries.echo-claw.config.ownerAgentId': 'main',
    'plugins.entries.echo-claw.config.monitorAgentId': 'echo-monitor',
    'plugins.entries.echo-claw.config.viewerAgentId': 'echo-viewer',
  };
  for (const [p, value] of Object.entries(expected)) {
    const got = readConfigPath(p, { command });
    out.checks.push(check(`config:${p}`, got.exists && JSON.stringify(got.value) === JSON.stringify(value), { expected: value, actual: got.value, exists: got.exists }));
  }

  const ownerAllow = readConfigPath('agents.entries.main.tools.allow', { command });
  const ownerAlsoAllow = readConfigPath('agents.entries.main.tools.alsoAllow', { command });
  const ownerToolPresent = (Array.isArray(ownerAllow.value) && ownerAllow.value.includes('echo_owner_session')) || (Array.isArray(ownerAlsoAllow.value) && ownerAlsoAllow.value.includes('echo_owner_session'));
  out.checks.push(check('owner-tool-policy', ownerToolPresent, { allow: ownerAllow.value, alsoAllow: ownerAlsoAllow.value }));

  const monitorTools = readConfigPath('agents.entries.echo-monitor.tools.allow', { command });
  out.checks.push(check('monitor-tool-policy', monitorTools.exists && Array.isArray(monitorTools.value) && monitorTools.value.length === 1 && monitorTools.value[0] === 'echo_monitor_session', { actual: monitorTools.value }));
  const viewerDeny = readConfigPath('agents.entries.echo-viewer.tools.deny', { command });
  out.checks.push(check('viewer-tool-policy', viewerDeny.exists && Array.isArray(viewerDeny.value) && viewerDeny.value.includes('*'), { actual: viewerDeny.value }));

  out.ok = out.checks.every((x) => x.ok);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (!out.ok) process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
