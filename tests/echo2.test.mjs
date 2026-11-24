import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  EchoSessionEngine, createExecutionAuthority, importBundledTargets, loadBundledTargetCatalog,
  sha256Text, EchoError, listProtocols,
} from '../src/index.mjs';

function contexts(extraPolicy = {}) {
  const authority = createExecutionAuthority({ monitorAgentIds: ['echo-monitor'], viewerAgentIds: ['echo-viewer', 'echo-viewer-2'], ...extraPolicy });
  return {
    authority,
    system: authority.fromHostFacts({ actorKind: 'system', agentId: 'echo-session-core', sessionId: 'host-system' }),
    monitor: authority.fromHostFacts({ actorKind: 'agent', agentId: 'echo-monitor', sessionId: 'host-monitor', requesterPrincipalId: 'user-A' }),
    monitorB: authority.fromHostFacts({ actorKind: 'agent', agentId: 'echo-monitor', sessionId: 'host-monitor-B', requesterPrincipalId: 'user-B' }),
    viewer: authority.fromHostFacts({ actorKind: 'agent', agentId: 'echo-viewer', sessionId: 'host-viewer', requesterPrincipalId: 'user-A' }),
    viewer2: authority.fromHostFacts({ actorKind: 'agent', agentId: 'echo-viewer-2', sessionId: 'host-viewer2', requesterPrincipalId: 'user-A' }),
    viewerB: authority.fromHostFacts({ actorKind: 'agent', agentId: 'echo-viewer', sessionId: 'host-viewer-B', requesterPrincipalId: 'user-B' }),
    owner: authority.fromHostFacts({ actorKind: 'owner', agentId: 'main', principalId: 'user-A', sessionId: 'host-owner' }),
    ownerB: authority.fromHostFacts({ actorKind: 'owner', agentId: 'main', principalId: 'user-B', sessionId: 'host-owner-B' }),
  };
}

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo2-'));
  return { dir, dbPath: path.join(dir, 'echo.sqlite') };
}

function newEngine(opts = {}) {
  const c = contexts();
  const e = new EchoSessionEngine({ ...opts, authority: c.authority });
  importBundledTargets(e, c.system);
  return { e, c };
}

function baseInput(overrides = {}) {
  return {
    mode: 'manual', viewer_agent_id: 'echo-viewer', protocol_id: 'rv-lite-core', protocol_version: '1.1.0', language: 'en',
    conductor_mode: 'ai_monitor', tasking_mode: 'neutral_code', human_blindness: 'BLIND', viewer_blindness: 'BLIND',
    target_exposure_class: 'public', ...overrides,
  };
}

function makeReady(e, c, overrides = {}, targetId = 'long-0001') {
  const s = e.createSession(c.monitor, baseInput(overrides));
  e.reserveTarget(c.system, s.session_id, { target_id: targetId });
  e.commitReservedTarget(c.monitor, s.session_id);
  e.bindViewer(c.monitor, s.session_id, `viewer-session-${s.session_id}`);
  e.startBlind(overrides.conductor_mode === 'human_user' ? c.owner : c.monitor, s.session_id);
  return e.getSession(c.system, s.session_id);
}

let requestCounter = 0;
function runAttempt(e, c, sessionId, text, options = {}) {
  const attempt = e.createAttempt(c.system, sessionId, options.retry_of ? { retry_of: options.retry_of } : {});
  const receipt = e.authorizePhysicalTransport(c.system, attempt.attempt_id, { provider_id: options.provider_id ?? 'test-provider', request_sha256: sha256Text(`request-${++requestCounter}`) });
  e.markTransportDispatched(c.system, receipt.transport_attempt_id);
  if (options.transportFail) {
    e.failTransport(c.system, receipt.transport_attempt_id, 'simulated failure');
    return { attempt, receipt };
  }
  e.completeTransport(c.system, receipt.transport_attempt_id, { provider_request_id: `provider-${requestCounter}` });
  const recorded = e.recordAttemptResponse(c.system, attempt.attempt_id, text, { ...(options.validation ?? {}), transport_attempt_id: receipt.transport_attempt_id });
  if (recorded.validation.ok && options.accept !== false) e.acceptAttempt(c.system, attempt.attempt_id);
  return { attempt: e.db.getAttempt(attempt.attempt_id), receipt: e.db.getTransport(receipt.transport_attempt_id), validation: recorded.validation };
}

function rv12() {
  const out = [];
  const fields = ['RVL:ECHO_DOT', 'RVL:PRIMITIVE_DESCRIPTOR', 'RVL:ADVANCED_DESCRIPTOR', 'RVL:CONTACT_CATEGORY', 'RVL:FORMING'];
  for (let n = 1; n <= 6; n++) {
    out.push(`[[ECHO:RVL:TOUCH:${n}]]`);
    for (const f of fields) out.push(`[[ECHO:${f}]] data-${n}-${f}`);
  }
  for (let n = 1; n <= 3; n++) out.push(`[[ECHO:RVL:VECTOR:${n}]] vector-${n}`);
  for (let n = 1; n <= 3; n++) out.push(`[[ECHO:RVL:SKETCH:${n}]] sketch-${n}`);
  return out.join('\n');
}
function rv3() { return '[[ECHO:RVL:STEP3]] deepening data\n[[ECHO:RVL:STEP3:EXHAUSTED]]'; }
function rv4() { return '[[ECHO:RVL:FUNCTIONAL_SKETCH:1]] final sketch'; }
function rcp1() {
  const out = []; const fields = ['ECHO_DOT', 'CONTACT_CATEGORY', 'PRIMITIVE_DESCRIPTOR', 'ADVANCED_DESCRIPTOR', 'FORMING'];
  for (let n = 1; n <= 6; n++) { out.push(`[[ECHO:RCP:TOUCH:${n}]]`); for (const f of fields) out.push(`[[ECHO:${f}]] rcp-${n}-${f}`); }
  return out.join('\n');
}
function rcp234(label = 'x') { return `[[ECHO:RCP:RAPID_CONTACT]] ${label}-contact\n[[ECHO:RCP:VECTOR_ORBIT]] ${label}-vector\n[[ECHO:RCP:FUNCTIONAL_SKETCH]] ${label}-sketch`; }
function rcp5() { return '[[ECHO:RCP:5.1]] motion\n[[ECHO:RCP:5.2:T1]] before\n[[ECHO:RCP:5.2:T2]] now\n[[ECHO:RCP:5.2:T3]] after\n[[ECHO:RCP:5.3]] anomaly'; }
function rcp6(newSignal) { return newSignal ? '[[ECHO:RCP:6:NEW_SIGNAL]]' : '[[ECHO:RCP:6:NO_NEW_SIGNAL]]'; }
function rv3Extended() { return [
  '[[ECHO:RVL:STEP3]] deepening data',
  '[[ECHO:RVL:STEP3:EXHAUSTED]]',
  '[[ECHO:RVL:DEEPEN:MAIN_ASPECT]] main aspect',
  '[[ECHO:RVL:DEEPEN:MAIN_ACTIVITY]] main activity',
  '[[ECHO:RVL:DEEPEN:CENTER]] center',
  '[[ECHO:RVL:DEEPEN:SURROUNDINGS]] surroundings',
  '[[ECHO:RVL:DEEPEN:MAP]] map',
].join('\n'); }
function tel1() {
  const out = []; const fields = ['TEL:ECHO_DOT', 'TEL:CONTACT_CATEGORY', 'TEL:PRIMITIVE_DESCRIPTOR', 'TEL:ADVANCED_DESCRIPTOR', 'TEL:FORMING'];
  for (let n = 1; n <= 3; n++) { out.push(`[[ECHO:TEL:T1:TOUCH:${n}]]`); for (const f of fields) out.push(`[[ECHO:${f}]] tel-${n}-${f}`); }
  return out.join('\n');
}
function tel2() { return '[[ECHO:TEL:T2:RAPID_CONTACT]] contact\n[[ECHO:TEL:T2:VECTOR_ORBIT]] vector\n[[ECHO:TEL:T2:FUNCTIONAL_SKETCH]] sketch'; }
function telRaw(n) { return `[[ECHO:TEL:T${n}:RAW]] raw-${n}`; }
function tel7() { return Array.from({ length: 6 }, (_, i) => `[[ECHO:TEL:T7:Q${i + 1}]] answer-${i + 1}`).join('\n'); }
function tel8() { return '[[ECHO:TEL:T8A]] awareness\n[[ECHO:TEL:T8B]] light-up'; }
function tel9(count) { return Array.from({ length: count }, (_, i) => `[[ECHO:TEL:T9:Q${i + 1}:RAW]] tasking-answer-${i + 1}`).join('\n'); }
function tel10() { return 'Stable contact remains present. [SRC:T1]\nA directional structure is retained. [SRC:T2]\nThe subject impression remains coherent. [SRC:T3]'; }

function completeRvCore(e, c, sessionId, conductor = c.monitor) {
  runAttempt(e, c, sessionId, 'ready');
  runAttempt(e, c, sessionId, rv12()); e.continueCheckpoint(conductor, sessionId);
  runAttempt(e, c, sessionId, rv3()); e.continueCheckpoint(conductor, sessionId);
  runAttempt(e, c, sessionId, rv4()); e.continueCheckpoint(conductor, sessionId);
  return e.getSession(c.system, sessionId);
}

function startRcp(e, c, targetId = 'long-0002') {
  return makeReady(e, c, { protocol_id: 'rcp', protocol_version: '1.5a' }, targetId);
}
function reachRcpPhase6(e, c, sessionId, cycleLabel = 'c') {
  const s = e.getSession(c.system, sessionId);
  if (s.current_step_id === 'rcp.prepare') runAttempt(e, c, sessionId, 'ready');
  if (e.getSession(c.system, sessionId).current_step_id === 'rcp.phase1') runAttempt(e, c, sessionId, rcp1());
  for (const [step, text] of [['rcp.phase2', rcp234(`${cycleLabel}2`)], ['rcp.phase3', rcp234(`${cycleLabel}3`)], ['rcp.phase4', rcp234(`${cycleLabel}4`)], ['rcp.phase5', rcp5()]]) {
    assert.equal(e.getSession(c.system, sessionId).current_step_id, step);
    runAttempt(e, c, sessionId, text); e.continueCheckpoint(c.monitor, sessionId);
  }
  assert.equal(e.getSession(c.system, sessionId).current_step_id, 'rcp.phase6');
}

function expectCode(fn, code) {
  assert.throws(fn, (err) => err instanceof EchoError && err.code === code);
}

test('E2-T01 bundled target catalog is 126 and bytes match catalog hashes', () => {
  const catalog = loadBundledTargetCatalog();
  assert.equal(catalog.count, 126); assert.equal(catalog.targets.length, 126);
  const { e, c } = newEngine();
  assert.equal(e.db.listTargets().length, 126);
  e.close();
});

test('E2-T02 approved protocol pins resolve exactly', () => {
  const p = listProtocols();
  assert.deepEqual(p.map((x) => `${x.id}@${x.version}`).sort(), ['rcp@1.5a','rv-lite-core@1.1.0','rv-lite-extended@1.1.0','telepathy@1.1'].sort());
});

test('E2-T03 unknown protocol/version fails closed before session creation', () => {
  const { e, c } = newEngine();
  expectCode(() => e.createSession(c.monitor, baseInput({ protocol_id: 'fake' })), 'UNKNOWN_PROTOCOL');
  expectCode(() => e.createSession(c.monitor, baseInput({ protocol_version: '9.9' })), 'UNKNOWN_PROTOCOL_VERSION');
  e.close();
});

test('E2-T04 trusted caller identity is capability-bound to the engine authority, not model-authored', () => {
  const c = contexts();
  const e = new EchoSessionEngine({ authority: c.authority });
  const other = createExecutionAuthority({ monitorAgentIds: ['echo-monitor'] });
  const forgedFromOtherAuthority = other.fromHostFacts({ actorKind: 'agent', agentId: 'echo-monitor', sessionId: 'forged' });
  expectCode(() => e.createSession(forgedFromOtherAuthority, baseInput()), 'UNTRUSTED_CONTEXT');
  expectCode(() => e.createSession({ role: 'ai_monitor', agentId: 'echo-monitor' }, baseInput()), 'UNTRUSTED_CONTEXT');
  expectCode(() => new EchoSessionEngine(), 'AUTHORITY_REQUIRED');
  assert.equal(c.monitor.role, 'ai_monitor');
  e.close();
});

test('E2-T05 no-code exposes no substitute code; neutral-code is independent and stable', () => {
  const { e, c } = newEngine();
  const no = e.createSession(c.monitor, baseInput({ tasking_mode: 'no_code' }));
  assert.deepEqual(e.getBlindTasking(c.viewer, no.session_id), { tasking_mode: 'no_code', neutral_code: null });
  const yes = e.createSession(c.monitor, baseInput({ tasking_mode: 'neutral_code' }));
  const code = e.getBlindTasking(c.viewer, yes.session_id).neutral_code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
  e.reserveTarget(c.system, yes.session_id, { target_id: 'long-0003' });
  assert.equal(e.getBlindTasking(c.viewer, yes.session_id).neutral_code, code);
  e.close();
});

test('E2-T06 target commit is immutable through legal API', () => {
  const { e, c } = newEngine(); const s = e.createSession(c.monitor, baseInput());
  e.reserveTarget(c.system, s.session_id, { target_id: 'long-0001' }); e.commitReservedTarget(c.monitor, s.session_id);
  expectCode(() => e.reserveTarget(c.system, s.session_id, { target_id: 'long-0002' }), 'ILLEGAL_STATE');
  assert.equal(e.getSession(c.system, s.session_id).target_id, 'long-0001'); e.close();
});

test('E2-T07 Viewer and Monitor cannot read full target before Reveal', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c);
  expectCode(() => e.getTargetFeedback(c.monitor, s.session_id), 'TARGET_SEALED');
  expectCode(() => e.getTargetFeedback(c.viewer, s.session_id), 'TARGET_SEALED');
  e.close();
});

test('E2-T08 human conductor cannot be silently replaced by AI Monitor', () => {
  const { e, c } = newEngine();
  const s = e.createSession(c.monitor, baseInput({ conductor_mode: 'human_user' }));
  e.reserveTarget(c.system, s.session_id, { target_id: 'long-0001' }); e.commitReservedTarget(c.monitor, s.session_id); e.bindViewer(c.monitor, s.session_id, 'v');
  expectCode(() => e.startBlind(c.monitor, s.session_id), 'WRONG_CONDUCTOR');
  assert.equal(e.startBlind(c.owner, s.session_id).state, 'BLIND_RUNNING'); e.close();
});

test('E2-T09 logical step acceptance advances atomically when no checkpoint exists', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c);
  runAttempt(e, c, s.session_id, 'ready');
  const after = e.getSession(c.system, s.session_id);
  assert.equal(after.last_accepted_step_id, 'rv-lite-core.prepare');
  assert.equal(after.current_step_id, 'rv-lite-core.steps1-2');
  assert.equal(after.checkpoint_pending, false); e.close();
});

test('E2-T10 checkpoint cannot be bypassed by creating next attempt', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); runAttempt(e, c, s.session_id, 'ready'); runAttempt(e, c, s.session_id, rv12());
  expectCode(() => e.createAttempt(c.system, s.session_id), 'CHECKPOINT_PENDING');
  assert.equal(e.getSession(c.system, s.session_id).current_step_id, 'rv-lite-core.steps1-2'); e.close();
});

test('E2-T11 physical transport receipt is persisted before dispatch', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const a = e.createAttempt(c.system, s.session_id);
  const r = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('r') });
  assert.equal(r.status, 'AUTHORIZED'); assert.equal(e.db.transportsForAttempt(a.attempt_id).length, 1);
  e.markTransportDispatched(c.system, r.transport_attempt_id); assert.equal(e.db.getTransport(r.transport_attempt_id).status, 'DISPATCHED'); e.close();
});

test('E2-T12 failed receipt persistence blocks physical dispatch authorization', () => {
  const c = contexts(); const e = new EchoSessionEngine({ authority: c.authority, faultInjector(name) { if (name === 'beforeTransportReceiptPersist') throw new Error('disk failure'); } }); importBundledTargets(e, c.system);
  const s = makeReady(e, c); const a = e.createAttempt(c.system, s.session_id);
  assert.throws(() => e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('r') }), /disk failure/u);
  assert.equal(e.db.transportsForAttempt(a.attempt_id).length, 0); e.close();
});

test('E2-T13 multiple physical provider retries remain under one logical attempt', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const a = e.createAttempt(c.system, s.session_id);
  const r1 = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('r1') }); e.markTransportDispatched(c.system, r1.transport_attempt_id); e.failTransport(c.system, r1.transport_attempt_id, 'timeout');
  const r2 = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('r2') }); e.markTransportDispatched(c.system, r2.transport_attempt_id); e.completeTransport(c.system, r2.transport_attempt_id);
  e.recordAttemptResponse(c.system, a.attempt_id, 'ready', { transport_attempt_id: r2.transport_attempt_id }); e.acceptAttempt(c.system, a.attempt_id);
  const rows = e.db.transportsForAttempt(a.attempt_id); assert.deepEqual(rows.map((x) => x.physical_ordinal), [1,2]); assert.equal(e.db.getAttempt(a.attempt_id).status, 'ACCEPTED'); e.close();
});

test('E2-T14 interrupted/failed logical attempt does not complete a step', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const a = e.createAttempt(c.system, s.session_id); e.failAttempt(c.system, a.attempt_id, 'interrupted');
  assert.equal(e.getSession(c.system, s.session_id).current_step_id, 'rv-lite-core.prepare'); assert.equal(e.getSession(c.system, s.session_id).last_accepted_step_id, null); e.close();
});

test('E2-T15 invalid response is REJECTED and retry can be accepted only once for the same step instance', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c);
  const originalStepInstance = e.getSession(c.system, s.session_id).current_step_instance_id;
  const first = runAttempt(e, c, s.session_id, '', { accept: false }); assert.equal(first.validation.ok, false); assert.equal(e.db.getAttempt(first.attempt.attempt_id).status, 'REJECTED');
  const second = runAttempt(e, c, s.session_id, 'ready', { retry_of: first.attempt.attempt_id }); assert.equal(e.db.getAttempt(second.attempt.attempt_id).status, 'ACCEPTED');
  const attempts = e.db.attemptsForStep(s.session_id, originalStepInstance);
  assert.equal(attempts.filter((x) => x.status === 'ACCEPTED').length, 1);
  assert.equal(e.getSession(c.system, s.session_id).current_step_id, 'rv-lite-core.steps1-2');
  e.close();
});

test('E2-T16 complete RV Lite Core reaches BLIND_COMPLETE only after final checkpoint', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const final = completeRvCore(e, c, s.session_id);
  assert.equal(final.state, 'BLIND_COMPLETE'); assert.equal(final.current_step_id, 'rv-lite-core.blind_complete'); assert.ok(final.blind_completed_at); e.close();
});

test('E2-T17 Reveal before formal BLIND_COMPLETE is denied', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c);
  expectCode(() => e.authorizeReveal(c.monitor, s.session_id, 'r1'), 'REVEAL_NOT_ALLOWED'); e.close();
});

test('E2-T18 unresolved physical/logical attempt blocks Reveal authorization', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id);
  const now = new Date().toISOString();
  e.db.insertAttempt({
    attempt_id: 'fault-injected-open-attempt', session_id: s.session_id, step_id: 'rv-lite-core.step4', step_instance_id: 'fault-injected-step',
    viewer_session_id: e.getSession(c.system, s.session_id).viewer_session_id, status: 'CREATED', retry_of: null, logical_ordinal: 1,
    request_started_at: now, response_received_at: null, accepted_at: null, result_text: null, result_sha256: null, validation_json: null, provider_request_id: null,
  });
  expectCode(() => e.authorizeReveal(c.monitor, s.session_id, 'blocked'), 'OPEN_ATTEMPTS'); e.close();
});

test('E2-T19 Reveal is idempotent and returns exactly committed target', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id);
  const auth = e.authorizeReveal(c.monitor, s.session_id, 'key-1'); const one = e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'key-1'); const two = e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'key-1');
  assert.deepEqual(two, one); assert.equal(one.target_id, 'long-0001'); assert.equal(one.target_sha256, s.target_sha256); assert.equal(e.getSession(c.system, s.session_id).state, 'REVEALED'); e.close();
});

test('E2-T20 crash after durable Reveal commit recovers same Reveal without second disclosure state', () => {
  const { dbPath } = tempDb(); const c = contexts(); let crashOnce = true;
  let e = new EchoSessionEngine({ authority: c.authority, dbPath, faultInjector(name) { if (name === 'afterRevealPersistBeforeReturn' && crashOnce) { crashOnce = false; throw new Error('crash after commit'); } } }); importBundledTargets(e, c.system);
  const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'crash-key');
  assert.throws(() => e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'crash-key'), /crash after commit/u); e.close();
  e = new EchoSessionEngine({ authority: c.authority, dbPath }); const recovered = e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'crash-key');
  assert.equal(recovered.target_id, 'long-0001'); assert.equal(e.getSession(c.system, s.session_id).state, 'REVEALED'); assert.equal(e.db.rawDbForAuditTests().prepare('SELECT COUNT(*) AS n FROM reveals WHERE session_id=?').get(s.session_id).n, 1); e.close();
});

test('E2-T21 Reveal persistence failure exposes nothing and leaves authorization retryable', () => {
  const c = contexts(); const e = new EchoSessionEngine({ authority: c.authority, faultInjector(name) { if (name === 'beforeRevealPersist') throw new Error('write failure'); } }); importBundledTargets(e, c.system);
  const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'f');
  assert.throws(() => e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'f'), /write failure/u); assert.equal(e.getSession(c.system, s.session_id).state, 'REVEAL_AUTHORIZED'); assert.equal(e.db.getRevealBySession(s.session_id), null); e.close();
});

test('E2-T22 after Reveal bound Viewer receives durable feedback', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'v'); const reveal = e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'v');
  assert.deepEqual(e.getTargetFeedback(c.viewer, s.session_id), reveal); e.close();
});

test('E2-T23 revealed target becomes KNOWN_TO_VIEWER and is excluded from future blind session', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'x'); e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'x');
  assert.equal(e.db.getExposure('long-0001', 'echo-viewer').eligibility, 'KNOWN_TO_VIEWER');
  const next = e.createSession(c.monitor, baseInput()); expectCode(() => e.reserveTarget(c.system, next.session_id, { target_id: 'long-0001' }), 'NO_ELIGIBLE_TARGET'); e.close();
});

test('E2-T24 known-target training may deliberately reuse a revealed target', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'x'); e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'x');
  const next = e.createSession(c.monitor, baseInput({ viewer_blindness: 'KNOWN_TARGET_TRAINING' })); e.reserveTarget(c.system, next.session_id, { target_id: 'long-0001' }); assert.equal(e.getSession(c.system, next.session_id).target_id, 'long-0001'); e.close();
});

test('E2-T25 same target remains eligible for a different Viewer without recorded exposure', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'x'); e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'x');
  const next = e.createSession(c.monitor, baseInput({ viewer_agent_id: 'echo-viewer-2' })); e.reserveTarget(c.system, next.session_id, { target_id: 'long-0001' }); assert.equal(e.getSession(c.system, next.session_id).target_id, 'long-0001'); e.close();
});

test('E2-T26 pause/resume keeps accepted progress and current step', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); runAttempt(e, c, s.session_id, 'ready'); const before = e.getSession(c.system, s.session_id);
  e.pause(c.monitor, s.session_id, 'user stop'); const resumed = e.resume(c.monitor, s.session_id);
  assert.equal(resumed.current_step_id, before.current_step_id); assert.equal(resumed.last_accepted_step_id, before.last_accepted_step_id); e.close();
});

test('E2-T27 viewer context loss enters RECOVERING only from trusted runtime evidence and Resume never changes target commit', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const before = e.getSession(c.system, s.session_id);
  const runtimeEvent = c.authority.fromRuntimeEvent({
    actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST', eventId: 'evt-t27', echoSessionId: s.session_id,
    viewerAgentId: s.viewer_agent_id, viewerSessionId: s.viewer_session_id, requesterPrincipalId: 'user-A',
  });
  assert.equal(e.viewerContextLost(runtimeEvent, s.session_id).state, 'RECOVERING'); const conductorView = e.resume(c.monitor, s.session_id);
  assert.equal(conductorView.target_id, null);
  const after = e.getSession(c.system, s.session_id); assert.equal(after.target_id, before.target_id); assert.equal(after.target_sha256, before.target_sha256); e.close();
});

test('E2-T28 Cancel is terminal for Resume', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); e.cancel(c.monitor, s.session_id, 'stop'); expectCode(() => e.resume(c.monitor, s.session_id), 'ILLEGAL_STATE'); e.close();
});

test('E2-T29 RCP Phase 6 NEW_SIGNAL opens independent cycle and preserves parent step instance', () => {
  const { e, c } = newEngine(); const s = startRcp(e, c); reachRcpPhase6(e, c, s.session_id, 'base'); runAttempt(e, c, s.session_id, rcp6(true)); e.continueCheckpoint(c.monitor, s.session_id);
  const after = e.getSession(c.system, s.session_id); assert.equal(after.cycle_index, 1); assert.equal(after.current_step_id, 'rcp.phase2'); assert.equal(after.current_step_instance_id, 'rcp.phase2~c1'); assert.equal(after.parent_step_instance_id, 'rcp.phase6~c0'); e.close();
});

test('E2-T30 RCP extension limit pauses for explicit decision instead of auto-Reveal', () => {
  const { e, c } = newEngine(); const s = startRcp(e, c);
  for (let cycle = 0; cycle <= 3; cycle++) {
    reachRcpPhase6(e, c, s.session_id, `c${cycle}`); runAttempt(e, c, s.session_id, rcp6(true)); e.continueCheckpoint(c.monitor, s.session_id);
    if (cycle < 3) assert.equal(e.getSession(c.system, s.session_id).cycle_index, cycle + 1);
  }
  const paused = e.getSession(c.system, s.session_id); assert.equal(paused.state, 'PAUSED_REQUIRES_DECISION'); assert.equal(paused.revealed_at, null); expectCode(() => e.authorizeReveal(c.monitor, s.session_id, 'no'), 'REVEAL_NOT_ALLOWED'); e.close();
});

test('E2-T31 RCP extension-limit conductor may finish blind explicitly, with reason recorded', () => {
  const { e, c } = newEngine(); const s = startRcp(e, c);
  // Directly set max to 0 for this boundary test; production default remains protocol-pinned at 3.
  e.db.updateSession(s.session_id, { max_extension_cycles: 0 });
  reachRcpPhase6(e, c, s.session_id, 'limit'); runAttempt(e, c, s.session_id, rcp6(true)); e.continueCheckpoint(c.monitor, s.session_id);
  const done = e.resolveExtensionLimit(c.monitor, s.session_id, 'finish_blind'); assert.equal(done.state, 'BLIND_COMPLETE'); assert.equal(done.blind_completion_reason, 'conductor_stop_after_extension_limit'); e.close();
});

test('E2-T32 adjunct neutrality is verified, never declared by model/caller params', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); runAttempt(e, c, s.session_id, 'ready'); runAttempt(e, c, s.session_id, rv12());
  const ok = e.freezeAdjunct(c.monitor, s.session_id, 'Move closer to the dominant aspect.', { neutralityVerifier: () => 'NEUTRAL' }); assert.equal(ok.neutrality_status, 'NEUTRAL');
  expectCode(() => e.freezeAdjunct(c.monitor, s.session_id, 'Look for the waterfall.', { neutralityVerifier: () => 'TARGET_AWARE' }), 'ADJUNCT_NOT_NEUTRAL'); e.close();
});

test('E2-T33 audit trail is hash chained and tampering is detectable', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); runAttempt(e, c, s.session_id, 'ready'); assert.equal(e.verifyAuditTrail(c.monitor, s.session_id).ok, true);
  const db = e.db.rawDbForAuditTests(); const row = db.prepare('SELECT event_id FROM audit_events WHERE session_id=? ORDER BY event_id LIMIT 1').get(s.session_id); db.prepare('UPDATE audit_events SET payload_json=? WHERE event_id=?').run('{"tampered":true}', row.event_id);
  assert.equal(e.verifyAuditTrail(c.monitor, s.session_id).ok, false); e.close();
});

test('E2-T34 durable restart restores current step, accepted result and target commit', () => {
  const { dbPath } = tempDb(); const c = contexts(); let e = new EchoSessionEngine({ authority: c.authority, dbPath }); importBundledTargets(e, c.system); const s = makeReady(e, c); runAttempt(e, c, s.session_id, 'ready'); const before = e.getSession(c.system, s.session_id); e.close();
  e = new EchoSessionEngine({ authority: c.authority, dbPath }); const after = e.getSession(c.system, s.session_id); assert.equal(after.current_step_id, before.current_step_id); assert.equal(after.last_accepted_step_id, before.last_accepted_step_id); assert.equal(after.target_sha256, before.target_sha256); assert.equal(e.verifyAuditTrail(c.monitor, s.session_id).ok, true); e.close();
});

test('E2-T35 target revision collision with different bytes fails closed', () => {
  const { e, c } = newEngine(); const t = e.db.getTarget('long-0001','source-v1'); expectCode(() => e.importTarget(c.system, { ...t, content: t.content + '\nchanged', sha256: sha256Text(t.content + '\nchanged') }), 'TARGET_REVISION_COLLISION'); e.close();
});

test('E2-T36 post-Reveal lifecycle closes only through REVEALED -> POST_REVEAL -> CLOSED', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'l'); e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'l');
  expectCode(() => e.closeSession(c.monitor, s.session_id), 'ILLEGAL_STATE'); assert.equal(e.enterPostReveal(c.viewer, s.session_id).state, 'POST_REVEAL'); assert.equal(e.closeSession(c.monitor, s.session_id).state, 'CLOSED'); e.close();
});

test('E2-T37 pre-Reveal session views redact target identity from Monitor, Viewer and blind human owner', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c);
  for (const ctx of [c.monitor, c.viewer, c.owner]) {
    const view = e.getSession(ctx, s.session_id);
    assert.equal(view.target_id, null); assert.equal(view.target_revision, null); assert.equal(view.target_sha256, null); assert.equal(view.target_commit_present, true);
  }
  assert.equal(e.getSession(c.system, s.session_id).target_id, 'long-0001'); e.close();
});

test('E2-T38 blind AI Monitor cannot choose a specific target and reservation response never discloses selected identity', () => {
  const { e, c } = newEngine(); const s = e.createSession(c.monitor, baseInput());
  expectCode(() => e.reserveTarget(c.monitor, s.session_id, { target_id: 'long-0001' }), 'TARGET_SELECTION_NOT_ALLOWED');
  const result = e.reserveTarget(c.monitor, s.session_id);
  assert.deepEqual(result, { session_id: s.session_id, reserved: true });
  assert.equal(e.getSession(c.monitor, s.session_id).target_id, null); assert.ok(e.getSession(c.system, s.session_id).target_id); e.close();
});

test('E2-T39 full audit payload is sealed from conductors pre-Reveal but audit integrity may still be checked', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c);
  expectCode(() => e.auditTrail(c.monitor, s.session_id), 'AUDIT_SEALED');
  expectCode(() => e.auditTrail(c.owner, s.session_id), 'AUDIT_SEALED');
  assert.ok(e.auditTrail(c.system, s.session_id).length > 0); assert.equal(e.verifyAuditTrail(c.monitor, s.session_id).ok, true); e.close();
});

test('E2-T40 Reveal authorization is idempotent, target-redacted for conductor and rejects a second key', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id);
  const auth = e.authorizeReveal(c.monitor, s.session_id, 'same-key');
  assert.equal(auth.target_id, undefined); assert.equal(auth.target_revision, undefined); assert.equal(auth.target_sha256, undefined);
  assert.equal(e.authorizeReveal(c.monitor, s.session_id, 'same-key').authorization_id, auth.authorization_id);
  expectCode(() => e.authorizeReveal(c.monitor, s.session_id, 'different-key'), 'REVEAL_ALREADY_AUTHORIZED'); e.close();
});

test('E2-T41 restart recovery marks dispatched physical outcome UNKNOWN, preserves logical attempt and resumes same step', () => {
  const { dbPath } = tempDb(); const c = contexts(); let e = new EchoSessionEngine({ authority: c.authority, dbPath }); importBundledTargets(e, c.system);
  const s = makeReady(e, c); const a = e.createAttempt(c.system, s.session_id); const r = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('recovery-request') }); e.markTransportDispatched(c.system, r.transport_attempt_id); e.close();
  e = new EchoSessionEngine({ authority: c.authority, dbPath }); const recovered = e.recoverInterruptedWork(c.system, s.session_id, 'process restart');
  assert.equal(recovered.state, 'RECOVERING'); assert.equal(e.db.getTransport(r.transport_attempt_id).status, 'UNKNOWN'); assert.equal(e.db.getAttempt(a.attempt_id).status, 'DISPATCHED');
  const resumed = e.resume(c.monitor, s.session_id); assert.equal(resumed.current_step_instance_id, a.step_instance_id);
  expectCode(() => e.createAttempt(c.system, s.session_id), 'OPEN_LOGICAL_ATTEMPT');
  const retryTransport = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('recovery-retry') }); assert.equal(retryTransport.physical_ordinal, 2); e.close();
});

test('E2-T42 recovery treats persisted pre-dispatch authorization as UNKNOWN when external dispatch cannot be proven absent', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const a = e.createAttempt(c.system, s.session_id); const r = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('never-dispatched') });
  e.recoverInterruptedWork(c.system, s.session_id, 'restart'); assert.equal(e.db.getTransport(r.transport_attempt_id).status, 'UNKNOWN'); assert.equal(e.db.getAttempt(a.attempt_id).status, 'CREATED'); e.close();
});

test('E2-T43 Viewer cannot inspect a session bound to a different Viewer identity', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c, { viewer_agent_id: 'echo-viewer-2' });
  expectCode(() => e.getSession(c.viewer, s.session_id), 'FORBIDDEN'); assert.equal(e.getSession(c.viewer2, s.session_id).target_id, null); e.close();
});

test('E2-T44 Reveal is the first point where target identity becomes visible to Monitor and bound Viewer', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id);
  assert.equal(e.getSession(c.monitor, s.session_id).target_id, null); const auth = e.authorizeReveal(c.monitor, s.session_id, 'visibility'); assert.equal(e.getSession(c.monitor, s.session_id).target_id, null);
  e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'visibility'); assert.equal(e.getSession(c.monitor, s.session_id).target_id, 'long-0001'); assert.equal(e.getSession(c.viewer, s.session_id).target_id, 'long-0001'); e.close();
});

test('E2-T45 RV Lite Extended executes its distinct Step 3 deepening and reaches BLIND_COMPLETE', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c, { protocol_id: 'rv-lite-extended', protocol_version: '1.1.0' }, 'long-0004');
  runAttempt(e, c, s.session_id, 'ready'); runAttempt(e, c, s.session_id, rv12()); e.continueCheckpoint(c.monitor, s.session_id);
  assert.equal(e.getSession(c.system, s.session_id).current_step_id, 'rv-lite-extended.step3');
  runAttempt(e, c, s.session_id, rv3Extended()); e.continueCheckpoint(c.monitor, s.session_id); runAttempt(e, c, s.session_id, rv4()); e.continueCheckpoint(c.monitor, s.session_id);
  assert.equal(e.getSession(c.system, s.session_id).state, 'BLIND_COMPLETE'); e.close();
});

test('E2-T46 Telepathy T0-T10 runs end-to-end with durable neutral T9 tasking and reaches BLIND_COMPLETE', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c, { protocol_id: 'telepathy', protocol_version: '1.1' }, 'telepathy-01');
  runAttempt(e, c, s.session_id, 'reset complete'); runAttempt(e, c, s.session_id, tel1()); runAttempt(e, c, s.session_id, tel2()); e.continueCheckpoint(c.monitor, s.session_id);
  for (const n of [3,4,5]) runAttempt(e, c, s.session_id, telRaw(n));
  runAttempt(e, c, s.session_id, telRaw(6)); e.continueCheckpoint(c.monitor, s.session_id); runAttempt(e, c, s.session_id, tel7()); runAttempt(e, c, s.session_id, tel8());
  const frozen = e.freezeTelepathyTaskingQuestions(c.monitor, s.session_id, ['Describe the strongest remaining impression.', 'Is there any additional neutral signal?'], { neutralityVerifier: () => 'NEUTRAL' });
  assert.equal(frozen.count, 2); e.continueCheckpoint(c.monitor, s.session_id);
  assert.equal(e.getTelepathyTaskingQuestions(c.viewer, s.session_id).length, 2);
  runAttempt(e, c, s.session_id, tel9(2)); e.continueCheckpoint(c.monitor, s.session_id);
  runAttempt(e, c, s.session_id, tel10(), { validation: { supportVerifier: () => 'SUPPORTED' } }); e.continueCheckpoint(c.monitor, s.session_id);
  assert.equal(e.getSession(c.system, s.session_id).state, 'BLIND_COMPLETE'); e.close();
});

test('E2-T47 Telepathy cannot enter T9 until at least one neutral tasking question is durably frozen', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c, { protocol_id: 'telepathy', protocol_version: '1.1' }, 'telepathy-02');
  runAttempt(e, c, s.session_id, 'reset'); runAttempt(e, c, s.session_id, tel1()); runAttempt(e, c, s.session_id, tel2()); e.continueCheckpoint(c.monitor, s.session_id);
  for (const n of [3,4,5]) runAttempt(e, c, s.session_id, telRaw(n)); runAttempt(e, c, s.session_id, telRaw(6)); e.continueCheckpoint(c.monitor, s.session_id); runAttempt(e, c, s.session_id, tel7()); runAttempt(e, c, s.session_id, tel8());
  expectCode(() => e.continueCheckpoint(c.monitor, s.session_id), 'TELEPATHY_TASKING_REQUIRED');
  const still = e.getSession(c.system, s.session_id); assert.equal(still.current_step_id, 'telepathy.t8'); assert.equal(still.checkpoint_pending, true); e.close();
});

test('E2-T48 Telepathy T9 validation uses durable frozen question count, not caller-supplied runtime count', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c, { protocol_id: 'telepathy', protocol_version: '1.1' }, 'telepathy-03');
  runAttempt(e, c, s.session_id, 'reset'); runAttempt(e, c, s.session_id, tel1()); runAttempt(e, c, s.session_id, tel2()); e.continueCheckpoint(c.monitor, s.session_id);
  for (const n of [3,4,5]) runAttempt(e, c, s.session_id, telRaw(n)); runAttempt(e, c, s.session_id, telRaw(6)); e.continueCheckpoint(c.monitor, s.session_id); runAttempt(e, c, s.session_id, tel7()); runAttempt(e, c, s.session_id, tel8());
  e.freezeTelepathyTaskingQuestions(c.monitor, s.session_id, ['Question one?', 'Question two?'], { neutralityVerifier: () => 'NEUTRAL' }); e.continueCheckpoint(c.monitor, s.session_id);
  const result = runAttempt(e, c, s.session_id, tel9(1), { accept: false, validation: { runtime: { taskingQuestionCount: 1 } } });
  assert.equal(result.validation.ok, false); assert.match(result.validation.errors.join(' '), /marker sequence mismatch/u); e.close();
});

test('E2-T49 Telepathy tasking neutrality is fail-closed and the frozen set is immutable', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c, { protocol_id: 'telepathy', protocol_version: '1.1' }, 'telepathy-04');
  // Fault-inject the legal T8 checkpoint directly to isolate the tasking contract from earlier phases.
  e.db.updateSession(s.session_id, { current_step_id: 'telepathy.t8', current_step_instance_id: 'telepathy.t8~c0', checkpoint_pending: 1, pending_transition_event: 'CONTINUE' });
  expectCode(() => e.freezeTelepathyTaskingQuestions(c.monitor, s.session_id, ['Name the hidden target.'], { neutralityVerifier: () => 'TARGET_AWARE' }), 'TASKING_NOT_NEUTRAL');
  e.freezeTelepathyTaskingQuestions(c.monitor, s.session_id, ['Describe any remaining neutral impression.'], { neutralityVerifier: () => 'NEUTRAL' });
  expectCode(() => e.freezeTelepathyTaskingQuestions(c.monitor, s.session_id, ['Another question?'], { neutralityVerifier: () => 'NEUTRAL' }), 'TASKING_ALREADY_FROZEN'); e.close();
});

test('E2-T50 RCP Phase 6 NO_NEW_SIGNAL closes blind phase without opening another cycle', () => {
  const { e, c } = newEngine(); const s = startRcp(e, c, 'long-0005'); reachRcpPhase6(e, c, s.session_id, 'final'); runAttempt(e, c, s.session_id, rcp6(false)); e.continueCheckpoint(c.monitor, s.session_id);
  const done = e.getSession(c.system, s.session_id); assert.equal(done.state, 'BLIND_COMPLETE'); assert.equal(done.cycle_index, 0); assert.equal(done.current_step_id, 'rcp.blind_complete'); e.close();
});

test('E2-T51 full audit becomes available to Monitor only after Reveal', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); expectCode(() => e.auditTrail(c.monitor, s.session_id), 'AUDIT_SEALED');
  const auth = e.authorizeReveal(c.monitor, s.session_id, 'audit-visible'); e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'audit-visible');
  assert.ok(e.auditTrail(c.monitor, s.session_id).some((x) => x.event_type === 'REVEAL_COMMITTED')); e.close();
});

test('E2-T52 Reveal execution rejects an idempotency key that does not match its authorization', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); completeRvCore(e, c, s.session_id); const auth = e.authorizeReveal(c.monitor, s.session_id, 'authorized-key');
  expectCode(() => e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'wrong-key'), 'INVALID_REVEAL_AUTHORIZATION'); e.close();
});


test('E2-T53 duplicate target import with identical bytes is idempotent and does not duplicate library rows', () => {
  const { e, c } = newEngine(); const before = e.db.listTargets().length; const target = e.db.getTarget('long-0001', 'source-v1');
  const result = e.importTarget(c.system, target); assert.equal(result.imported, false); assert.equal(e.db.listTargets().length, before); e.close();
});

test('E2-T54 human USER_KNOWN target selection remains explicitly marked and Monitor stays target-redacted before Reveal', () => {
  const { e, c } = newEngine(); const s = e.createSession(c.owner, baseInput({ conductor_mode: 'human_user', human_blindness: 'USER_KNOWN' }));
  e.reserveTarget(c.owner, s.session_id, { target_id: 'long-0006' }); e.commitReservedTarget(c.owner, s.session_id); e.bindViewer(c.owner, s.session_id, 'viewer-user-known');
  const monitorView = e.getSession(c.monitor, s.session_id); assert.equal(monitorView.human_blindness, 'USER_KNOWN'); assert.equal(monitorView.target_id, null);
  const raw = e.getSession(c.system, s.session_id); assert.equal(raw.target_id, 'long-0006'); assert.equal(raw.human_blindness, 'USER_KNOWN'); e.close();
});

test('E2-T55 private unpublished target pool is supported while target identity remains sealed from Monitor and Viewer', () => {
  const { e, c } = newEngine(); const content = '# Private target\nConfidential feedback material.'; const sha = sha256Text(content);
  e.importTarget(c.owner, { target_id: 'private-test-001', revision: 'private-v1', sha256: sha, kind: 'private-research', exposure_class: 'private', source_path: null, title: 'Private target', has_ascii_feedback: false, content });
  const s = e.createSession(c.monitor, baseInput({ target_exposure_class: 'private' })); e.reserveTarget(c.system, s.session_id, { target_id: 'private-test-001' }); e.commitReservedTarget(c.monitor, s.session_id); e.bindViewer(c.monitor, s.session_id, 'private-viewer');
  assert.equal(e.getSession(c.monitor, s.session_id).target_id, null); assert.equal(e.getSession(c.viewer, s.session_id).target_id, null); assert.equal(e.getSession(c.system, s.session_id).target_id, 'private-test-001'); e.close();
});

test('E2-T56 committed target identity is protected by a database trigger, not only by public API checks', () => {
  const { e, c } = newEngine(); const s = makeReady(e, c); const db = e.db.rawDbForAuditTests();
  assert.throws(() => db.prepare('UPDATE sessions SET target_id=? WHERE session_id=?').run('long-0002', s.session_id), /target commit identity is immutable/u);
  assert.equal(e.getSession(c.system, s.session_id).target_id, 'long-0001'); e.close();
});

test('E2-T57 execution overlay and language are pinned in durable session state and invalid language fails closed', () => {
  const { e, c } = newEngine(); const s = e.createSession(c.monitor, baseInput({ language: 'pl' }));
  const raw = e.getSession(c.system, s.session_id); assert.equal(raw.language, 'pl'); assert.equal(raw.execution_overlay_id, 'echo-tasking-v1'); assert.match(raw.execution_overlay_sha256, /^[a-f0-9]{64}$/u);
  expectCode(() => e.createSession(c.monitor, baseInput({ language: 'de' })), 'INVALID_LANGUAGE'); e.close();
});

test('E2-T58 Reveal authorization and Reveal result are idempotent across two database connections', () => {
  const { dbPath } = tempDb(); const c = contexts(); let e1 = new EchoSessionEngine({ authority: c.authority, dbPath }); importBundledTargets(e1, c.system); const s = makeReady(e1, c); completeRvCore(e1, c, s.session_id);
  const e2 = new EchoSessionEngine({ authority: c.authority, dbPath }); const a1 = e1.authorizeReveal(c.monitor, s.session_id, 'cross-connection'); const a2 = e2.authorizeReveal(c.monitor, s.session_id, 'cross-connection'); assert.equal(a2.authorization_id, a1.authorization_id);
  const r1 = e1.executeReveal(c.monitor, s.session_id, a1.authorization_id, 'cross-connection'); const r2 = e2.executeReveal(c.monitor, s.session_id, a2.authorization_id, 'cross-connection'); assert.deepEqual(r2, r1);
  e1.close(); e2.close();
});

test('E2-T59 Viewer cannot read revealed feedback from a session bound to another Viewer', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c, { viewer_agent_id: 'echo-viewer-2' }, 'long-0007');
  completeRvCore(e, c, s.session_id);
  const auth = e.authorizeReveal(c.monitor, s.session_id, 'viewer-feedback-isolation');
  e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'viewer-feedback-isolation');
  expectCode(() => e.getTargetFeedback(c.viewer, s.session_id), 'FORBIDDEN');
  assert.equal(e.getTargetFeedback(c.viewer2, s.session_id).target_id, 'long-0007');
  e.close();
});

test('E2-T60 exact execution-overlay pin is durable and target commit timestamp is database-immutable', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c, { language: 'pl' }, 'long-0008');
  const raw = e.getSession(c.system, s.session_id);
  assert.equal(raw.execution_overlay_sha256, '261e835bb76704ff6f4e966616284b3e1bd51e905cfb7207015d046f48e9bb3d');
  assert.ok(raw.target_committed_at);
  const db = e.db.rawDbForAuditTests();
  assert.throws(
    () => db.prepare('UPDATE sessions SET target_committed_at=? WHERE session_id=?').run('2099-01-01T00:00:00.000Z', s.session_id),
    /target commit timestamp is immutable/u,
  );
  assert.equal(e.getSession(c.system, s.session_id).target_committed_at, raw.target_committed_at);
  e.close();
});


test('E2-T61 runtime protocol pins match the exact packaged ECHO-1 manifest bytes', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'runtime', 'protocols.json'), 'utf8'));
  const files = {
    rcp: 'rcp_v1.5a.yaml',
    'rv-lite-core': 'rv_lite_core_v1.1.0.yaml',
    'rv-lite-extended': 'rv_lite_extended_v1.1.0.yaml',
    telepathy: 'telepathy_v1.1.yaml',
  };
  for (const [id, file] of Object.entries(files)) {
    const bytes = fs.readFileSync(path.join(root, 'protocol-pack', file));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(runtime.protocols[id].manifest_sha256, sha, `${id} runtime pin drifted from packaged manifest bytes`);
  }
});

test('E2-T62 the same blind Viewer cannot have the same target active in two concurrent sessions', () => {
  const { e, c } = newEngine();
  const s1 = e.createSession(c.monitor, baseInput());
  const s2 = e.createSession(c.monitor, baseInput());
  e.reserveTarget(c.system, s1.session_id, { target_id: 'long-0009' });
  expectCode(() => e.reserveTarget(c.system, s2.session_id, { target_id: 'long-0009' }), 'NO_ELIGIBLE_TARGET');
  e.cancel(c.monitor, s1.session_id, 'free target after cancelled session');
  assert.equal(e.reserveTarget(c.system, s2.session_id, { target_id: 'long-0009' }).reserved, true);
  e.close();
});

test('E2-T63 session creation rejects a Viewer identity not mapped by the bound authority', () => {
  const { e, c } = newEngine();
  expectCode(() => e.createSession(c.monitor, baseInput({ viewer_agent_id: 'viewer-invented-by-model' })), 'UNKNOWN_VIEWER_AGENT');
  assert.equal(e.createSession(c.monitor, baseInput({ viewer_agent_id: 'echo-viewer-2' })).viewer_agent_id, 'echo-viewer-2');
  e.close();
});


test('E2-T64 an accepted model response is provenance-bound to one completed physical transport', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c);
  const a = e.createAttempt(c.system, s.session_id);
  const r = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('provenance-request') });
  e.markTransportDispatched(c.system, r.transport_attempt_id);
  e.completeTransport(c.system, r.transport_attempt_id, { provider_request_id: 'provider-provenance-1' });
  expectCode(() => e.recordAttemptResponse(c.system, a.attempt_id, 'ready'), 'RESPONSE_TRANSPORT_REQUIRED');
  expectCode(() => e.recordAttemptResponse(c.system, a.attempt_id, 'ready', { transport_attempt_id: 'not-this-transport' }), 'RESPONSE_TRANSPORT_MISMATCH');
  e.recordAttemptResponse(c.system, a.attempt_id, 'ready', { transport_attempt_id: r.transport_attempt_id });
  e.acceptAttempt(c.system, a.attempt_id);
  const accepted = e.db.getAttempt(a.attempt_id);
  const step = e.db.getStepResult(s.session_id, a.step_instance_id);
  assert.equal(accepted.response_transport_attempt_id, r.transport_attempt_id);
  assert.equal(step.transport_attempt_id, r.transport_attempt_id);
  assert.equal(accepted.provider_request_id, 'provider-provenance-1');
  e.close();
});

test('E2-T65 only one physical transport may be in flight and a completed call cannot be silently retried under the same logical attempt', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c);
  const a = e.createAttempt(c.system, s.session_id);
  const r1 = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('single-flight-1') });
  expectCode(() => e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('single-flight-2') }), 'PHYSICAL_TRANSPORT_IN_FLIGHT');
  e.markTransportDispatched(c.system, r1.transport_attempt_id);
  expectCode(() => e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('single-flight-3') }), 'PHYSICAL_TRANSPORT_IN_FLIGHT');
  e.failTransport(c.system, r1.transport_attempt_id, 'retryable transport failure');
  const r2 = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('single-flight-4') });
  e.markTransportDispatched(c.system, r2.transport_attempt_id);
  e.completeTransport(c.system, r2.transport_attempt_id);
  expectCode(() => e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('single-flight-5') }), 'PHYSICAL_TRANSPORT_ALREADY_COMPLETED');
  e.close();
});

test('E2-T66 Pause blocks both new physical authorization and dispatch of a receipt that has not yet left the host', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c);
  const a = e.createAttempt(c.system, s.session_id);
  e.pause(c.monitor, s.session_id, 'operator stop before dispatch');
  expectCode(() => e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('paused-authorize') }), 'TRANSPORT_SESSION_NOT_RUNNING');
  e.resume(c.monitor, s.session_id);
  const r = e.authorizePhysicalTransport(c.system, a.attempt_id, { provider_id: 'p', request_sha256: sha256Text('paused-dispatch') });
  e.pause(c.monitor, s.session_id, 'operator stop after receipt');
  expectCode(() => e.markTransportDispatched(c.system, r.transport_attempt_id), 'TRANSPORT_SESSION_NOT_RUNNING');
  e.resume(c.monitor, s.session_id);
  assert.equal(e.markTransportDispatched(c.system, r.transport_attempt_id).status, 'DISPATCHED');
  e.close();
});

test('E2-T67 human BLIND session cannot manually select a concrete target_id', () => {
  const { e, c } = newEngine();
  const s = e.createSession(c.owner, baseInput({ conductor_mode: 'human_user', human_blindness: 'BLIND' }));
  expectCode(() => e.reserveTarget(c.owner, s.session_id, { target_id: 'long-0010' }), 'HUMAN_TARGET_SELECTION_REQUIRES_KNOWN');
  assert.equal(e.reserveTarget(c.owner, s.session_id).reserved, true);
  e.close();
});

test('E2-T68 Reveal execution rechecks the session conductor even with a valid authorization', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c);
  completeRvCore(e, c, s.session_id);
  const auth = e.authorizeReveal(c.monitor, s.session_id, 'conductor-bound-reveal');
  expectCode(() => e.executeReveal(c.owner, s.session_id, auth.authorization_id, 'conductor-bound-reveal'), 'WRONG_CONDUCTOR');
  const reveal = e.executeReveal(c.monitor, s.session_id, auth.authorization_id, 'conductor-bound-reveal');
  assert.equal(reveal.target_id, 'long-0001');
  e.close();
});

test('E2-T69 neutrality verifier receives authoritative durable blind context, never caller-supplied target context', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c, {}, 'long-0010');
  runAttempt(e, c, s.session_id, 'ready');
  runAttempt(e, c, s.session_id, rv12());
  let seen = null;
  const verifier = (_instruction, context) => { seen = context; return 'NEUTRAL'; };
  e.freezeAdjunct(c.monitor, s.session_id, 'Describe the dominant remaining aspect.', {
    neutralityVerifier: verifier,
    blindContext: { target_id: 'long-0010', title: 'should be ignored' },
  });
  assert.ok(seen);
  assert.equal(Object.hasOwn(seen, 'target_id'), false);
  assert.equal(Object.hasOwn(seen, 'title'), false);
  assert.equal(seen.session_id, s.session_id);
  assert.equal(seen.current_step_id, 'rv-lite-core.steps1-2');
  assert.ok(seen.accepted_results.length >= 2);
  assert.equal(seen.accepted_results.some((x) => x.step_id === 'rv-lite-core.steps1-2'), true);
  e.close();
});


test('E2-T70 session owner principal prevents another human user from reading, cancelling, resuming or revealing the session', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c, { conductor_mode: 'human_user' }, 'long-0011');
  assert.equal(e.getSession(c.system, s.session_id).owner_principal_id, 'user-A');
  expectCode(() => e.getSession(c.ownerB, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  expectCode(() => e.cancel(c.ownerB, s.session_id, 'cross-owner cancel'), 'FORBIDDEN_SESSION_OWNER');
  e.pause(c.owner, s.session_id, 'owner A pause');
  expectCode(() => e.resume(c.ownerB, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  e.resume(c.owner, s.session_id);
  completeRvCore(e, c, s.session_id, c.owner);
  const auth = e.authorizeReveal(c.owner, s.session_id, 'owner-isolation');
  expectCode(() => e.authorizeReveal(c.ownerB, s.session_id, 'owner-isolation-B'), 'FORBIDDEN_SESSION_OWNER');
  expectCode(() => e.executeReveal(c.ownerB, s.session_id, auth.authorization_id, 'owner-isolation'), 'FORBIDDEN_SESSION_OWNER');
  const reveal = e.executeReveal(c.owner, s.session_id, auth.authorization_id, 'owner-isolation');
  assert.equal(reveal.target_id, 'long-0011');
  expectCode(() => e.getTargetFeedback(c.ownerB, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  e.close();
});

test('E2-T71 VIEWER_CONTEXT_LOST requires a trusted host runtime event bound to the exact session and Viewer session', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c, { conductor_mode: 'human_user' }, 'long-0012');
  expectCode(() => e.viewerContextLost(c.monitor, s.session_id), 'RUNTIME_EVENT_REQUIRED');
  expectCode(() => e.viewerContextLost(c.owner, s.session_id), 'RUNTIME_EVENT_REQUIRED');
  const wrongPrincipal = c.authority.fromRuntimeEvent({
    actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST', eventId: 'evt-wrong-owner', echoSessionId: s.session_id,
    viewerAgentId: s.viewer_agent_id, viewerSessionId: s.viewer_session_id, requesterPrincipalId: 'user-B',
  });
  expectCode(() => e.viewerContextLost(wrongPrincipal, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  const wrongViewerSession = c.authority.fromRuntimeEvent({
    actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST', eventId: 'evt-wrong-viewer-session', echoSessionId: s.session_id,
    viewerAgentId: s.viewer_agent_id, viewerSessionId: 'not-the-bound-viewer-session', requesterPrincipalId: 'user-A',
  });
  expectCode(() => e.viewerContextLost(wrongViewerSession, s.session_id), 'RUNTIME_VIEWER_SESSION_MISMATCH');
  const runtimeEvent = c.authority.fromRuntimeEvent({
    actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST', eventId: 'evt-valid-context-loss', echoSessionId: s.session_id,
    viewerAgentId: s.viewer_agent_id, viewerSessionId: s.viewer_session_id, requesterPrincipalId: 'user-A',
  });
  const after = e.viewerContextLost(runtimeEvent, s.session_id, 'host reports Viewer context missing');
  assert.equal(after.state, 'RECOVERING');
  const audit = e.auditTrail(c.system, s.session_id);
  const event = audit.find((x) => x.event_type === 'VIEWER_CONTEXT_LOST');
  assert.equal(event.payload.runtime_event_id, 'evt-valid-context-loss');
  assert.equal(event.payload.viewer_session_id, s.viewer_session_id);
  e.close();
});

test('E2-T72 same Monitor and Viewer agent IDs cannot cross owner-principal boundaries', () => {
  const { e, c } = newEngine();
  const s = makeReady(e, c, {}, 'long-0013');
  assert.equal(e.getSession(c.monitor, s.session_id).session_id, s.session_id);
  expectCode(() => e.getSession(c.monitorB, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  expectCode(() => e.cancel(c.monitorB, s.session_id, 'cross-owner monitor cancel'), 'FORBIDDEN_SESSION_OWNER');
  expectCode(() => e.getSession(c.viewerB, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  assert.equal(e.getSession(c.viewer, s.session_id).session_id, s.session_id);
  e.close();
});

test('E2-T73 owner binding is durable across restart and remains redacted from non-internal session views', () => {
  const { dbPath } = tempDb();
  const c = contexts();
  let e = new EchoSessionEngine({ authority: c.authority, dbPath });
  importBundledTargets(e, c.system);
  const s = e.createSession(c.monitor, baseInput());
  assert.equal(e.getSession(c.system, s.session_id).owner_principal_id, 'user-A');
  assert.equal(Object.hasOwn(e.getSession(c.monitor, s.session_id), 'owner_principal_id'), false);
  assert.equal(Object.hasOwn(e.getSession(c.owner, s.session_id), 'owner_principal_id'), false);
  e.close();
  e = new EchoSessionEngine({ authority: c.authority, dbPath });
  assert.equal(e.getSession(c.system, s.session_id).owner_principal_id, 'user-A');
  expectCode(() => e.getSession(c.ownerB, s.session_id), 'FORBIDDEN_SESSION_OWNER');
  e.close();
});

test('E2-T74 owner contexts require a trusted principalId and runtime events require host evidence fields', () => {
  const authority = createExecutionAuthority({ monitorAgentIds: ['echo-monitor'], viewerAgentIds: ['echo-viewer'] });
  expectCode(() => authority.fromHostFacts({ actorKind: 'owner', agentId: 'main', sessionId: 'host-owner' }), 'OWNER_PRINCIPAL_REQUIRED');
  expectCode(() => authority.fromRuntimeEvent({ actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST' }), 'RUNTIME_EVENT_ID_REQUIRED');
  const c = contexts();
  const e = new EchoSessionEngine({ authority: c.authority });
  const monitorWithoutRequester = c.authority.fromHostFacts({ actorKind: 'agent', agentId: 'echo-monitor', sessionId: 'host-monitor-no-owner' });
  expectCode(() => e.createSession(monitorWithoutRequester, baseInput({ conductor_mode: 'human_user' })), 'HUMAN_OWNER_CONTEXT_REQUIRED');
  e.close();
});


test('E2-T75 owner principal is protected by SQLite immutability and schema is version 4', () => {
  const { e, c } = newEngine();
  const s = e.createSession(c.monitor, baseInput());
  const db = e.db.rawDbForAuditTests();
  const version = db.prepare("SELECT value FROM echo_meta WHERE key='schema_version'").get();
  assert.equal(version.value, '4');
  const columns = db.prepare("PRAGMA table_info('sessions')").all().map((x) => x.name);
  assert.ok(columns.includes('owner_principal_id'));
  assert.throws(
    () => db.prepare('UPDATE sessions SET owner_principal_id=? WHERE session_id=?').run('user-B', s.session_id),
    /session owner principal is immutable/u,
  );
  assert.equal(e.getSession(c.system, s.session_id).owner_principal_id, 'user-A');
  e.close();
});

test('E2-T76 unbound legacy sessions fail closed for ordinary actors and new sessions require an explicit owner principal', () => {
  const { e, c } = newEngine();

  // New sessions cannot create another ownerless record. Internal/system callers
  // must carry an explicit requester principal (for example a system owner).
  expectCode(() => e.createSession(c.system, baseInput()), 'SESSION_OWNER_CONTEXT_REQUIRED');
  const systemOwned = c.authority.fromHostFacts({
    actorKind: 'system', agentId: 'echo-session-core', sessionId: 'host-system-owned', requesterPrincipalId: 'system:echo-automation',
  });
  const ownedAutomation = e.createSession(systemOwned, baseInput({ mode: 'automation' }));
  assert.equal(e.getSession(c.system, ownedAutomation.session_id).owner_principal_id, 'system:echo-automation');
  assert.equal(e.getSession(c.system, ownedAutomation.session_id).owner_binding_status, 'BOUND');

  function forceLegacyUnbound(sessionId) {
    const db = e.db.rawDbForAuditTests();
    db.exec('DROP TRIGGER IF EXISTS trg_session_owner_immutable;');
    db.prepare('UPDATE sessions SET owner_principal_id=NULL WHERE session_id=?').run(sessionId);
    db.exec(`
      CREATE TRIGGER trg_session_owner_immutable
      BEFORE UPDATE OF owner_principal_id ON sessions
      WHEN NEW.owner_principal_id IS NOT OLD.owner_principal_id
      BEGIN
        SELECT RAISE(ABORT, 'session owner principal is immutable');
      END;
    `);
    assert.equal(e.getSession(c.system, sessionId).owner_principal_id, null);
    assert.equal(e.getSession(c.system, sessionId).owner_binding_status, 'UNBOUND_LEGACY');
  }

  // Read + cancel: neither the original Monitor nor another user's Monitor/Human/Viewer
  // may use knowledge of the session ID as a substitute for an owner binding.
  const readCancel = e.createSession(c.monitor, baseInput());
  forceLegacyUnbound(readCancel.session_id);
  for (const ctx of [c.monitor, c.monitorB, c.owner, c.ownerB, c.viewer, c.viewerB]) {
    expectCode(() => e.getSession(ctx, readCancel.session_id), 'UNBOUND_LEGACY_SESSION');
  }
  expectCode(() => e.cancel(c.monitor, readCancel.session_id, 'legacy cancel by original monitor'), 'UNBOUND_LEGACY_SESSION');
  expectCode(() => e.cancel(c.monitorB, readCancel.session_id, 'legacy cancel by other monitor'), 'UNBOUND_LEGACY_SESSION');

  // Resume: prepare a legitimate paused session while it is still bound, then emulate
  // a v3->v4 legacy record whose owner cannot be proven.
  const paused = makeReady(e, c, {}, 'long-0014');
  e.pause(c.monitor, paused.session_id, 'pause before legacy migration simulation');
  forceLegacyUnbound(paused.session_id);
  expectCode(() => e.resume(c.monitor, paused.session_id), 'UNBOUND_LEGACY_SESSION');
  expectCode(() => e.resume(c.monitorB, paused.session_id), 'UNBOUND_LEGACY_SESSION');
  expectCode(() => e.resume(c.owner, paused.session_id), 'UNBOUND_LEGACY_SESSION');

  // Reveal: even a previously valid authorization does not turn an ownerless record
  // into a public/global session.
  const revealable = makeReady(e, c, {}, 'long-0015');
  completeRvCore(e, c, revealable.session_id);
  const auth = e.authorizeReveal(c.monitor, revealable.session_id, 'legacy-owner-test');
  forceLegacyUnbound(revealable.session_id);
  expectCode(() => e.authorizeReveal(c.monitor, revealable.session_id, 'legacy-owner-retry'), 'UNBOUND_LEGACY_SESSION');
  expectCode(() => e.authorizeReveal(c.monitorB, revealable.session_id, 'legacy-owner-other'), 'UNBOUND_LEGACY_SESSION');
  expectCode(() => e.executeReveal(c.monitor, revealable.session_id, auth.authorization_id, 'legacy-owner-test'), 'UNBOUND_LEGACY_SESSION');
  expectCode(() => e.executeReveal(c.monitorB, revealable.session_id, auth.authorization_id, 'legacy-owner-test'), 'UNBOUND_LEGACY_SESSION');

  // A trusted runtime event is also not enough when no owner binding exists.
  const runtimeEvent = c.authority.fromRuntimeEvent({
    actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST', eventId: 'evt-unbound-legacy', echoSessionId: paused.session_id,
    viewerAgentId: paused.viewer_agent_id, viewerSessionId: paused.viewer_session_id, requesterPrincipalId: 'user-A',
  });
  expectCode(() => e.viewerContextLost(runtimeEvent, paused.session_id), 'UNBOUND_LEGACY_SESSION');

  e.close();
});
