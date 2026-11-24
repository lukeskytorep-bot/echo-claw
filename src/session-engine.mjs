import crypto from 'node:crypto';
import { EchoDatabase } from './database.mjs';
import { ecjSha256, neutralCode, nowIso, sha256Text, uuid } from './canonical.mjs';
import { EchoError, invariant } from './errors.mjs';
import { defaultCompletionEvent, resolveProtocol, stepById, stepInstanceId, transitionFor } from './protocol-runtime.mjs';
import { validateResponse } from './response-validator.mjs';
import { EXECUTION_OVERLAY, normalizeLanguage } from './execution-profile.mjs';

const ACTIVE_BLIND_STATES = new Set(['VIEWER_READY', 'BLIND_RUNNING', 'PAUSED', 'RECOVERING', 'PAUSED_REQUIRES_DECISION']);
const REVEALED_STATES = new Set(['REVEALED', 'POST_REVEAL', 'CLOSED']);

export class EchoSessionEngine {
  constructor({ authority, dbPath = ':memory:', clock = () => new Date(), faultInjector = null, randomIndex = null } = {}) {
    if (!authority || typeof authority.assert !== 'function' || typeof authority.requireRole !== 'function' || typeof authority.requireConductor !== 'function' || typeof authority.requireViewerAgentId !== 'function' || typeof authority.requireRuntimeEvent !== 'function') {
      throw new EchoError('AUTHORITY_REQUIRED', 'EchoSessionEngine requires a bound execution authority');
    }
    this.authority = authority;
    this.db = new EchoDatabase(dbPath);
    this.clock = clock;
    this.faultInjector = faultInjector;
    this.randomIndex = randomIndex ?? ((length) => crypto.randomInt(length));
  }

  close() { this.db.close(); }
  now() { return nowIso(this.clock); }
  #fault(name, data = {}) { if (this.faultInjector) this.faultInjector(name, data); }

  #getSessionRaw(sessionId) {
    const session = this.db.getSession(sessionId);
    if (!session) throw new EchoError('SESSION_NOT_FOUND', `session ${sessionId} not found`);
    return session;
  }

  #assertSessionAccess(ctx, session) {
    this.authority.assert(ctx);
    if (['session_core', 'admin'].includes(ctx.role)) return;

    // A null owner is a legacy/migration condition, never a wildcard.  No ordinary
    // actor may infer ownership from agent IDs, conductor mode or knowledge of the
    // session ID.  Recovery/rebinding requires a separate trusted administrative
    // policy; ECHO-2 intentionally does not guess an owner.
    if (!session.owner_principal_id) {
      throw new EchoError('UNBOUND_LEGACY_SESSION', 'session has no trusted owner binding and is unavailable to ordinary actors');
    }

    if (ctx.role === 'human_user') {
      if (ctx.principalId !== session.owner_principal_id) {
        throw new EchoError('FORBIDDEN_SESSION_OWNER', 'human caller is not the owner of this session');
      }
      return;
    }
    if (ctx.role === 'ai_monitor') {
      if (ctx.requesterPrincipalId !== session.owner_principal_id) {
        throw new EchoError('FORBIDDEN_SESSION_OWNER', 'Monitor requester principal does not own this session');
      }
      return;
    }
    if (ctx.role === 'echo_viewer') {
      if (session.viewer_agent_id !== ctx.agentId) throw new EchoError('FORBIDDEN', 'viewer is not bound to this session');
      if (ctx.requesterPrincipalId !== session.owner_principal_id) {
        throw new EchoError('FORBIDDEN_SESSION_OWNER', 'Viewer requester principal does not own this session');
      }
      return;
    }
    if (ctx.role === 'runtime_event') {
      if (ctx.requesterPrincipalId !== session.owner_principal_id) {
        throw new EchoError('FORBIDDEN_SESSION_OWNER', 'runtime event principal does not own this session');
      }
      return;
    }
    throw new EchoError('FORBIDDEN', `role ${ctx.role} cannot access session state`);
  }

  #sessionView(ctx, session) {
    const questions = JSON.parse(session.telepathy_tasking_questions_json ?? '[]');
    const maySeeInternal = ['session_core', 'admin'].includes(ctx.role);
    const maySeeTargetIdentity = maySeeInternal || REVEALED_STATES.has(session.state);
    if (maySeeInternal) return {
      ...session,
      owner_binding_status: session.owner_principal_id ? 'BOUND' : 'UNBOUND_LEGACY',
      target_commit_present: Boolean(session.target_committed_at),
      telepathy_tasking_frozen_count: questions.length,
    };
    const { telepathy_tasking_questions_json, owner_principal_id, ...publicFields } = session;
    return {
      ...publicFields,
      target_id: maySeeTargetIdentity ? session.target_id : null,
      target_revision: maySeeTargetIdentity ? session.target_revision : null,
      target_sha256: maySeeTargetIdentity ? session.target_sha256 : null,
      target_commit_present: Boolean(session.target_committed_at),
      telepathy_tasking_frozen_count: questions.length,
    };
  }

  #authorizationView(ctx, authorization) {
    if (!authorization) return null;
    if (['session_core', 'admin'].includes(ctx.role)) return { ...authorization };
    const { target_id, target_revision, target_sha256, ...safe } = authorization;
    return safe;
  }

  #neutralityBlindContext(session) {
    const acceptedResults = this.db.listStepResults(session.session_id).map((row) => Object.freeze({
      step_id: row.step_id,
      step_instance_id: row.step_instance_id,
      cycle_index: row.cycle_index,
      result_text: row.result_text,
      result_sha256: row.result_sha256,
    }));
    return Object.freeze({
      session_id: session.session_id,
      protocol_id: session.protocol_id,
      protocol_version: session.protocol_version,
      tasking_mode: session.tasking_mode,
      neutral_code: session.tasking_mode === 'neutral_code' ? session.blind_cue : null,
      current_step_id: session.current_step_id,
      current_step_instance_id: session.current_step_instance_id,
      accepted_results: Object.freeze(acceptedResults),
    });
  }

  importTarget(ctx, target) {
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user']);
    invariant(target?.target_id && target?.revision && target?.sha256 && typeof target?.content === 'string', 'INVALID_TARGET', 'target identity, hash and content required');
    invariant(sha256Text(target.content) === target.sha256, 'TARGET_HASH_MISMATCH', `target ${target.target_id} content hash mismatch`);
    invariant(['public', 'private'].includes(target.exposure_class), 'INVALID_TARGET_EXPOSURE_CLASS', 'target exposure class must be public or private');
    const result = this.db.importTarget(target, this.now());
    return result;
  }

  createSession(ctx, input) {
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    const protocol = resolveProtocol(input.protocol_id, input.protocol_version);
    invariant(protocol.status.startsWith('approved'), 'PROTOCOL_NOT_APPROVED', 'protocol must be approved');
    invariant(protocol.compatibility.conductor_modes.includes(input.conductor_mode), 'INVALID_CONDUCTOR_MODE', 'conductor mode is not compatible');
    invariant(protocol.compatibility.tasking_modes.includes(input.tasking_mode), 'INVALID_TASKING_MODE', 'tasking mode is not compatible');
    invariant(['manual', 'training', 'automation'].includes(input.mode), 'INVALID_SESSION_MODE', 'invalid session mode');
    invariant(['BLIND', 'USER_KNOWN', 'PARTIALLY_KNOWN'].includes(input.human_blindness), 'INVALID_HUMAN_BLINDNESS', 'invalid human blindness');
    invariant(['BLIND', 'KNOWN_TARGET_TRAINING'].includes(input.viewer_blindness), 'INVALID_VIEWER_BLINDNESS', 'invalid viewer blindness');
    invariant(['public', 'private'].includes(input.target_exposure_class), 'INVALID_TARGET_EXPOSURE_CLASS', 'invalid target exposure class');
    const language = normalizeLanguage(input.language);
    const viewerAgentId = this.authority.requireViewerAgentId(input.viewer_agent_id ?? 'echo-viewer');
    const now = this.now(); const sessionId = input.session_id ?? uuid();
    const initial = protocol.execution.initial_step;
    const ownerPrincipalId = ctx.role === 'human_user' ? ctx.principalId : (ctx.requesterPrincipalId ?? null);
    if (input.conductor_mode === 'human_user') {
      invariant(ownerPrincipalId, 'HUMAN_OWNER_CONTEXT_REQUIRED', 'human_user conductor requires a trusted owner/requester principal from the host');
    }
    invariant(ownerPrincipalId, 'SESSION_OWNER_CONTEXT_REQUIRED', 'new sessions require a trusted owner/requester principal from the host; use an explicit system principal for global automation');
    const row = {
      session_id: sessionId,
      mode: input.mode,
      owner_principal_id: ownerPrincipalId,
      viewer_agent_id: viewerAgentId,
      viewer_session_id: null,
      protocol_id: protocol.id,
      protocol_version: protocol.version,
      protocol_sha256: protocol.manifest_sha256,
      execution_overlay_id: EXECUTION_OVERLAY.id,
      execution_overlay_sha256: EXECUTION_OVERLAY.sha256,
      language,
      conductor_mode: input.conductor_mode,
      tasking_mode: input.tasking_mode,
      human_blindness: input.human_blindness,
      monitor_blindness: 'BLIND',
      viewer_blindness: input.viewer_blindness,
      target_exposure_class: input.target_exposure_class,
      target_id: null, target_revision: null, target_sha256: null,
      blind_cue: input.tasking_mode === 'neutral_code' ? neutralCode() : null,
      telepathy_tasking_questions_json: '[]',
      target_committed_at: null,
      state: 'CREATED',
      current_step_id: initial,
      current_step_instance_id: stepInstanceId(initial, 0),
      last_accepted_step_id: null,
      last_accepted_step_instance_id: null,
      cycle_index: 0,
      max_extension_cycles: Number(protocol.execution.max_extension_cycles_default ?? 0),
      checkpoint_pending: 0,
      pending_transition_event: null,
      parent_step_instance_id: null,
      blind_completion_reason: null,
      pause_reason: null,
      failure_reason: null,
      created_at: now, updated_at: now,
      blind_completed_at: null, reveal_authorized_at: null, revealed_at: null, closed_at: null,
      version: 1,
    };
    this.db.transaction(() => {
      this.db.insertSession(row);
      this.db.appendAudit(sessionId, 'SESSION_CREATED', {
        protocol_id: row.protocol_id, protocol_version: row.protocol_version, protocol_sha256: row.protocol_sha256,
        execution_overlay_id: row.execution_overlay_id, execution_overlay_sha256: row.execution_overlay_sha256, language: row.language,
        conductor_mode: row.conductor_mode, tasking_mode: row.tasking_mode, human_blindness: row.human_blindness, owner_binding_present: Boolean(row.owner_principal_id),
        viewer_blindness: row.viewer_blindness, target_exposure_class: row.target_exposure_class,
      }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  getSession(ctx, sessionId) {
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    return this.#sessionView(ctx, session);
  }

  getBlindTasking(ctx, sessionId) {
    const s = this.getSession(ctx, sessionId);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor', 'echo_viewer']);
    return s.tasking_mode === 'neutral_code'
      ? { tasking_mode: 'neutral_code', neutral_code: s.blind_cue }
      : { tasking_mode: 'no_code', neutral_code: null };
  }

  reserveTarget(ctx, sessionId, { target_id = null } = {}) {
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    invariant(session.state === 'CREATED', 'ILLEGAL_STATE', 'target can only be reserved from CREATED');
    let candidates = this.db.listTargets({ exposureClass: session.target_exposure_class });
    if (target_id) {
      invariant(ctx.role !== 'ai_monitor', 'TARGET_SELECTION_NOT_ALLOWED', 'blind AI Monitor may not select a specific target identifier');
      if (ctx.role === 'human_user') {
        invariant(session.human_blindness !== 'BLIND', 'HUMAN_TARGET_SELECTION_REQUIRES_KNOWN', 'manual human target selection requires USER_KNOWN or PARTIALLY_KNOWN blindness');
      }
      candidates = candidates.filter((t) => t.target_id === target_id);
    }
    if (session.viewer_blindness === 'BLIND') {
      const activeTargetIds = new Set(this.db.activeTargetIdsForViewer(session.viewer_agent_id, sessionId));
      candidates = candidates.filter((t) => !activeTargetIds.has(t.target_id));
      candidates = candidates.filter((t) => this.db.getExposure(t.target_id, session.viewer_agent_id)?.eligibility !== 'KNOWN_TO_VIEWER');
    }
    invariant(candidates.length > 0, 'NO_ELIGIBLE_TARGET', 'no eligible target available');
    const index = Math.max(0, Math.min(candidates.length - 1, this.randomIndex(candidates.length)));
    const target = candidates[index]; const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, {
        target_id: target.target_id, target_revision: target.revision, target_sha256: target.sha256,
        state: 'TARGET_RESERVED', updated_at: now, version: session.version + 1,
      });
      this.db.upsertExposureUse(target.target_id, session.viewer_agent_id, sessionId, now);
      this.db.appendAudit(sessionId, 'TARGET_RESERVED', { target_id: target.target_id, target_revision: target.revision, target_sha256: target.sha256 }, ctx, now);
    });
    return { session_id: sessionId, reserved: true };
  }

  commitReservedTarget(ctx, sessionId) {
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    invariant(session.state === 'TARGET_RESERVED', 'ILLEGAL_STATE', 'target commit requires TARGET_RESERVED');
    const target = this.db.getTarget(session.target_id, session.target_revision);
    invariant(target && target.sha256 === session.target_sha256, 'TARGET_COMMIT_MISMATCH', 'reserved target no longer matches source');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'TARGET_COMMITTED', target_committed_at: now, updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'TARGET_COMMITTED', { target_id: session.target_id, target_revision: session.target_revision, target_sha256: session.target_sha256 }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  bindViewer(ctx, sessionId, viewerSessionId) {
    const session = this.getSession(ctx, sessionId);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'ai_monitor', 'human_user']);
    invariant(session.state === 'TARGET_COMMITTED', 'ILLEGAL_STATE', 'viewer binding requires TARGET_COMMITTED');
    invariant(typeof viewerSessionId === 'string' && viewerSessionId.trim(), 'INVALID_VIEWER_SESSION', 'viewer session id required');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { viewer_session_id: viewerSessionId, state: 'VIEWER_READY', updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'VIEWER_BOUND', { viewer_session_id: viewerSessionId }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  startBlind(ctx, sessionId) {
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    this.authority.requireConductor(ctx, session);
    invariant(session.state === 'VIEWER_READY', 'ILLEGAL_STATE', 'blind session can only start from VIEWER_READY');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'BLIND_RUNNING', updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'BLIND_STARTED', { current_step_id: session.current_step_id, current_step_instance_id: session.current_step_instance_id }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  createAttempt(ctx, sessionId, { retry_of = null } = {}) {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const session = this.getSession(ctx, sessionId);
    invariant(session.state === 'BLIND_RUNNING', 'ILLEGAL_STATE', 'attempt creation requires BLIND_RUNNING');
    invariant(!session.checkpoint_pending, 'CHECKPOINT_PENDING', 'cannot create next attempt before checkpoint resolution');
    const protocol = resolveProtocol(session.protocol_id, session.protocol_version);
    const step = stepById(protocol, session.current_step_id);
    invariant(step.expected_output.validator_id !== 'engine.blind-complete.v1', 'ENGINE_STEP', 'engine-only step does not accept model attempts');
    const attempts = this.db.attemptsForStep(sessionId, session.current_step_instance_id);
    invariant(!attempts.some((a) => a.status === 'ACCEPTED'), 'STEP_ALREADY_ACCEPTED', 'step already has an accepted attempt');
    invariant(!attempts.some((a) => ['CREATED','DISPATCHED','COMPLETED'].includes(a.status)), 'OPEN_LOGICAL_ATTEMPT', 'current step already has an unresolved logical attempt');
    const max = Number(step.retry.max_logical_attempts ?? 1);
    invariant(attempts.length < max, 'LOGICAL_ATTEMPT_LIMIT', 'logical attempt limit reached');
    if (retry_of) {
      const prior = attempts.find((a) => a.attempt_id === retry_of);
      invariant(prior, 'INVALID_RETRY', 'retry_of must belong to current step instance');
      invariant(['FAILED', 'REJECTED'].includes(prior.status), 'INVALID_RETRY', 'only failed or rejected attempts may be retried');
    }
    const now = this.now(); const attemptId = uuid();
    this.db.transaction(() => {
      this.db.insertAttempt({
        attempt_id: attemptId, session_id: sessionId, step_id: session.current_step_id, step_instance_id: session.current_step_instance_id,
        viewer_session_id: session.viewer_session_id, status: 'CREATED', retry_of, logical_ordinal: attempts.length + 1,
        request_started_at: now, response_received_at: null, accepted_at: null, result_text: null, result_sha256: null,
        validation_json: null, provider_request_id: null, response_transport_attempt_id: null,
      });
      this.db.appendAudit(sessionId, 'LOGICAL_ATTEMPT_CREATED', { attempt_id: attemptId, step_instance_id: session.current_step_instance_id, logical_ordinal: attempts.length + 1, retry_of }, ctx, now);
    });
    return this.db.getAttempt(attemptId);
  }

  authorizePhysicalTransport(ctx, attemptId, { provider_id, request_sha256 }) {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const attempt = this.db.getAttempt(attemptId);
    invariant(attempt, 'ATTEMPT_NOT_FOUND', 'attempt not found');
    invariant(['CREATED', 'DISPATCHED'].includes(attempt.status), 'ILLEGAL_ATTEMPT_STATE', 'attempt cannot dispatch physical transport');
    const session = this.db.getSession(attempt.session_id);
    invariant(session?.state === 'BLIND_RUNNING', 'TRANSPORT_SESSION_NOT_RUNNING', 'physical transport authorization requires BLIND_RUNNING');
    invariant(attempt.step_instance_id === session.current_step_instance_id && !session.checkpoint_pending, 'STALE_ATTEMPT', 'transport attempt is not for the active step');
    invariant(typeof provider_id === 'string' && provider_id.trim(), 'INVALID_PROVIDER', 'provider id required');
    invariant(/^[a-f0-9]{64}$/u.test(request_sha256), 'INVALID_REQUEST_HASH', 'request_sha256 required');
    const prior = this.db.transportsForAttempt(attemptId);
    invariant(!prior.some((r) => ['AUTHORIZED','DISPATCHED'].includes(r.status)), 'PHYSICAL_TRANSPORT_IN_FLIGHT', 'another physical transport is still in flight');
    invariant(!prior.some((r) => r.status === 'COMPLETED'), 'PHYSICAL_TRANSPORT_ALREADY_COMPLETED', 'completed physical transport must be resolved before another physical call');
    const now = this.now(); const transportId = uuid();
    this.#fault('beforeTransportReceiptPersist', { attemptId, physicalOrdinal: prior.length + 1 });
    this.db.transaction(() => {
      this.db.insertTransport({
        transport_attempt_id: transportId, attempt_id: attemptId, physical_ordinal: prior.length + 1, provider_id, request_sha256,
        status: 'AUTHORIZED', authorized_at: now, dispatched_at: null, completed_at: null, provider_request_id: null, error_text: null,
      });
      this.db.appendAudit(attempt.session_id, 'TRANSPORT_AUTHORIZED_PRE_DISPATCH', { transport_attempt_id: transportId, attempt_id: attemptId, physical_ordinal: prior.length + 1, provider_id, request_sha256 }, ctx, now);
    });
    return this.db.getTransport(transportId);
  }

  markTransportDispatched(ctx, transportAttemptId) {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const receipt = this.db.getTransport(transportAttemptId);
    invariant(receipt?.status === 'AUTHORIZED', 'TRANSPORT_NOT_AUTHORIZED', 'transport must have a persisted pre-dispatch receipt');
    const attempt = this.db.getAttempt(receipt.attempt_id);
    const session = this.db.getSession(attempt.session_id);
    invariant(session?.state === 'BLIND_RUNNING', 'TRANSPORT_SESSION_NOT_RUNNING', 'physical dispatch requires BLIND_RUNNING');
    invariant(attempt.step_instance_id === session.current_step_instance_id && !session.checkpoint_pending, 'STALE_ATTEMPT', 'transport attempt is not for the active step');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateTransport(transportAttemptId, { status: 'DISPATCHED', dispatched_at: now });
      if (attempt.status === 'CREATED') this.db.updateAttempt(attempt.attempt_id, { status: 'DISPATCHED' });
      this.db.appendAudit(attempt.session_id, 'TRANSPORT_DISPATCHED', { transport_attempt_id: transportAttemptId, attempt_id: attempt.attempt_id }, ctx, now);
    });
    return this.db.getTransport(transportAttemptId);
  }

  completeTransport(ctx, transportAttemptId, { provider_request_id = null } = {}) {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const receipt = this.db.getTransport(transportAttemptId);
    invariant(receipt?.status === 'DISPATCHED', 'ILLEGAL_TRANSPORT_STATE', 'transport must be DISPATCHED');
    const attempt = this.db.getAttempt(receipt.attempt_id); const now = this.now();
    this.db.transaction(() => {
      this.db.updateTransport(transportAttemptId, { status: 'COMPLETED', completed_at: now, provider_request_id });
      if (provider_request_id) this.db.updateAttempt(attempt.attempt_id, { provider_request_id });
      this.db.appendAudit(attempt.session_id, 'TRANSPORT_COMPLETED', { transport_attempt_id: transportAttemptId, provider_request_id }, ctx, now);
    });
    return this.db.getTransport(transportAttemptId);
  }

  failTransport(ctx, transportAttemptId, errorText = 'transport failed') {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const receipt = this.db.getTransport(transportAttemptId);
    invariant(receipt && ['AUTHORIZED', 'DISPATCHED'].includes(receipt.status), 'ILLEGAL_TRANSPORT_STATE', 'transport cannot fail from current state');
    const attempt = this.db.getAttempt(receipt.attempt_id); const now = this.now();
    this.db.transaction(() => {
      this.db.updateTransport(transportAttemptId, { status: 'FAILED', completed_at: now, error_text: String(errorText) });
      this.db.appendAudit(attempt.session_id, 'TRANSPORT_FAILED', { transport_attempt_id: transportAttemptId, error: String(errorText) }, ctx, now);
    });
  }

  failAttempt(ctx, attemptId, reason = 'logical attempt failed') {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const attempt = this.db.getAttempt(attemptId);
    invariant(attempt && !['ACCEPTED', 'SUPERSEDED'].includes(attempt.status), 'ILLEGAL_ATTEMPT_STATE', 'attempt cannot be failed');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateAttempt(attemptId, { status: 'FAILED', validation_json: JSON.stringify({ errors: [String(reason)] }) });
      this.db.appendAudit(attempt.session_id, 'LOGICAL_ATTEMPT_FAILED', { attempt_id: attemptId, reason: String(reason) }, ctx, now);
    });
  }

  recordAttemptResponse(ctx, attemptId, text, { transport_attempt_id, runtime = {}, supportVerifier = null } = {}) {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const attempt = this.db.getAttempt(attemptId);
    invariant(attempt && ['DISPATCHED', 'CREATED'].includes(attempt.status), 'ILLEGAL_ATTEMPT_STATE', 'attempt is not awaiting a response');
    invariant(typeof transport_attempt_id === 'string' && transport_attempt_id, 'RESPONSE_TRANSPORT_REQUIRED', 'response must identify the physical transport that produced it');
    const responseTransport = this.db.getTransport(transport_attempt_id);
    invariant(responseTransport && responseTransport.attempt_id === attemptId, 'RESPONSE_TRANSPORT_MISMATCH', 'response transport does not belong to this logical attempt');
    invariant(responseTransport.status === 'COMPLETED', 'NO_COMPLETED_TRANSPORT', 'response transport must be durably COMPLETED');
    const session = this.db.getSession(attempt.session_id);
    invariant(session.state === 'BLIND_RUNNING', 'ILLEGAL_STATE', 'session is not running blind');
    invariant(attempt.step_instance_id === session.current_step_instance_id, 'STALE_ATTEMPT', 'attempt is not for current step instance');
    const protocol = resolveProtocol(session.protocol_id, session.protocol_version); const step = stepById(protocol, attempt.step_id);
    let effectiveRuntime = { ...runtime };
    if (step.expected_output.validator_id === 'telepathy.t9.v1') {
      const questions = JSON.parse(session.telepathy_tasking_questions_json ?? '[]');
      effectiveRuntime = { ...effectiveRuntime, taskingQuestionCount: questions.length };
    }
    if (step.expected_output.validator_id === 'telepathy.t10.v1') {
      const results = this.db.listStepResults(session.session_id);
      const sourceTextByStep = Object.fromEntries(results.map((r) => [r.step_id.replace(/^telepathy\./u, '').toUpperCase(), r.result_text]));
      effectiveRuntime = { ...effectiveRuntime, availableSourceSteps: Object.keys(sourceTextByStep), sourceTextByStep };
    }
    const validation = validateResponse(step.expected_output.validator_id, text, effectiveRuntime, supportVerifier);
    const now = this.now(); const resultHash = sha256Text(text);
    this.db.transaction(() => {
      this.db.updateAttempt(attemptId, {
        status: validation.ok ? 'COMPLETED' : 'REJECTED', response_received_at: now,
        result_text: text, result_sha256: resultHash, validation_json: JSON.stringify(validation),
        response_transport_attempt_id: transport_attempt_id, provider_request_id: responseTransport.provider_request_id ?? attempt.provider_request_id,
      });
      this.db.appendAudit(session.session_id, validation.ok ? 'ATTEMPT_RESPONSE_VALID' : 'ATTEMPT_RESPONSE_REJECTED', {
        attempt_id: attemptId, step_instance_id: attempt.step_instance_id, result_sha256: resultHash, validator_id: step.expected_output.validator_id,
        errors: validation.errors, inferred_event: validation.inferredEvent, transport_attempt_id,
      }, ctx, now);
    });
    return { attempt: this.db.getAttempt(attemptId), validation };
  }

  acceptAttempt(ctx, attemptId) {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const attempt = this.db.getAttempt(attemptId);
    invariant(attempt?.status === 'COMPLETED', 'ATTEMPT_NOT_COMPLETED', 'only structurally valid completed attempts can be accepted');
    const session = this.db.getSession(attempt.session_id);
    invariant(session.state === 'BLIND_RUNNING', 'ILLEGAL_STATE', 'session is not running blind');
    invariant(attempt.step_instance_id === session.current_step_instance_id, 'STALE_ATTEMPT', 'attempt is not current');
    invariant(!this.db.getStepResult(session.session_id, attempt.step_instance_id), 'STEP_ALREADY_ACCEPTED', 'step result already accepted');
    const protocol = resolveProtocol(session.protocol_id, session.protocol_version); const step = stepById(protocol, attempt.step_id);
    const validation = JSON.parse(attempt.validation_json); const completionEvent = defaultCompletionEvent(step, validation);
    const now = this.now();
    this.db.transaction(() => {
      this.db.insertStepResult({
        session_id: session.session_id, step_instance_id: attempt.step_instance_id, step_id: attempt.step_id,
        cycle_index: session.cycle_index, attempt_id: attemptId, result_text: attempt.result_text, result_sha256: attempt.result_sha256,
        validator_id: step.expected_output.validator_id, validation_sha256: ecjSha256(validation),
        transport_attempt_id: attempt.response_transport_attempt_id, accepted_at: now,
      });
      this.db.updateAttempt(attemptId, { status: 'ACCEPTED', accepted_at: now });
      for (const other of this.db.attemptsForStep(session.session_id, attempt.step_instance_id)) {
        if (other.attempt_id !== attemptId && ['COMPLETED', 'CREATED', 'DISPATCHED'].includes(other.status)) this.db.updateAttempt(other.attempt_id, { status: 'SUPERSEDED' });
      }
      this.db.updateSession(session.session_id, {
        last_accepted_step_id: attempt.step_id, last_accepted_step_instance_id: attempt.step_instance_id,
        updated_at: now, version: session.version + 1,
      });
      this.db.appendAudit(session.session_id, 'STEP_ACCEPTED', { attempt_id: attemptId, step_id: attempt.step_id, step_instance_id: attempt.step_instance_id, completion_event: completionEvent, checkpoint_required: Boolean(step.checkpoint.required) }, ctx, now);
      const fresh = this.db.getSession(session.session_id);
      if (step.checkpoint.required) {
        this.db.updateSession(session.session_id, { checkpoint_pending: 1, pending_transition_event: completionEvent, updated_at: now, version: fresh.version + 1 });
      } else {
        this.#applyTransitionTx(ctx, fresh, protocol, step, completionEvent, now);
      }
    });
    return this.getSession(ctx, session.session_id);
  }

  continueCheckpoint(ctx, sessionId) {
    const session = this.#getSessionRaw(sessionId); this.#assertSessionAccess(ctx, session); this.authority.requireConductor(ctx, session);
    invariant(session.state === 'BLIND_RUNNING', 'ILLEGAL_STATE', 'checkpoint continuation requires BLIND_RUNNING');
    invariant(session.checkpoint_pending, 'NO_CHECKPOINT', 'no checkpoint is pending');
    const event = session.pending_transition_event;
    invariant(event, 'MISSING_TRANSITION_EVENT', 'checkpoint has no legal transition event');
    const protocol = resolveProtocol(session.protocol_id, session.protocol_version); const step = stepById(protocol, session.current_step_id);
    const now = this.now();
    this.db.transaction(() => {
      this.db.appendAudit(sessionId, 'CHECKPOINT_ACKNOWLEDGED', { step_instance_id: session.current_step_instance_id, event }, ctx, now);
      const fresh = this.db.getSession(sessionId);
      this.db.updateSession(sessionId, { checkpoint_pending: 0, pending_transition_event: null, updated_at: now, version: fresh.version + 1 });
      this.#applyTransitionTx(ctx, this.db.getSession(sessionId), protocol, step, event, now);
    });
    return this.getSession(ctx, sessionId);
  }

  #applyTransitionTx(ctx, session, protocol, step, event, now) {
    const transition = transitionFor(step, event);
    if (transition.action === 'goto') {
      if (transition.target_step === 'telepathy.t9') {
        const questions = JSON.parse(session.telepathy_tasking_questions_json ?? '[]');
        invariant(questions.length > 0, 'TELEPATHY_TASKING_REQUIRED', 'at least one frozen neutral T9 tasking question is required before entering T9');
      }
      if (transition.target_step === protocol.completion.blind_complete_step) {
        this.db.updateSession(session.session_id, {
          state: 'BLIND_COMPLETE', current_step_id: transition.target_step, current_step_instance_id: stepInstanceId(transition.target_step, session.cycle_index),
          blind_completed_at: now, blind_completion_reason: 'protocol_complete', updated_at: now, version: session.version + 1,
        });
        this.db.appendAudit(session.session_id, 'BLIND_COMPLETE', { via_step: step.step_id, cycle_index: session.cycle_index }, ctx, now);
      } else {
        this.db.updateSession(session.session_id, { current_step_id: transition.target_step, current_step_instance_id: stepInstanceId(transition.target_step, session.cycle_index), updated_at: now, version: session.version + 1 });
        this.db.appendAudit(session.session_id, 'STEP_ADVANCED', { from: step.step_id, to: transition.target_step, cycle_index: session.cycle_index }, ctx, now);
      }
    } else if (transition.action === 'open_cycle') {
      const nextCycle = session.cycle_index + 1;
      if (nextCycle > session.max_extension_cycles) {
        this.db.updateSession(session.session_id, { state: 'PAUSED_REQUIRES_DECISION', pause_reason: 'RCP_EXTENSION_LIMIT', updated_at: now, version: session.version + 1 });
        this.db.appendAudit(session.session_id, 'RCP_EXTENSION_LIMIT_REACHED', { cycle_index: session.cycle_index, max_extension_cycles: session.max_extension_cycles, parent_step_instance_id: session.current_step_instance_id }, ctx, now);
      } else {
        this.db.updateSession(session.session_id, {
          cycle_index: nextCycle, current_step_id: transition.cycle_start_step, current_step_instance_id: stepInstanceId(transition.cycle_start_step, nextCycle),
          parent_step_instance_id: session.current_step_instance_id, updated_at: now, version: session.version + 1,
        });
        this.db.appendAudit(session.session_id, 'RCP_EXTENSION_CYCLE_OPENED', { cycle_index: nextCycle, start_step: transition.cycle_start_step, parent_step_instance_id: session.current_step_instance_id }, ctx, now);
      }
    } else if (transition.action === 'finish') {
      throw new EchoError('UNEXPECTED_FINISH_TRANSITION', 'engine finish transition is not executed through model attempts');
    }
  }

  resolveExtensionLimit(ctx, sessionId, decision) {
    const session = this.#getSessionRaw(sessionId); this.#assertSessionAccess(ctx, session); this.authority.requireConductor(ctx, session);
    invariant(session.state === 'PAUSED_REQUIRES_DECISION' && session.pause_reason === 'RCP_EXTENSION_LIMIT', 'ILLEGAL_STATE', 'no extension-limit decision is pending');
    const protocol = resolveProtocol(session.protocol_id, session.protocol_version);
    invariant(protocol.id === 'rcp', 'NOT_RCP', 'extension-limit decision applies only to RCP');
    const now = this.now();
    if (decision === 'allow_one_more_cycle') {
      const next = session.cycle_index + 1;
      this.db.transaction(() => {
        this.db.updateSession(sessionId, {
          state: 'BLIND_RUNNING', pause_reason: null, max_extension_cycles: session.max_extension_cycles + 1,
          cycle_index: next, current_step_id: 'rcp.phase2', current_step_instance_id: stepInstanceId('rcp.phase2', next),
          parent_step_instance_id: session.current_step_instance_id, updated_at: now, version: session.version + 1,
        });
        this.db.appendAudit(sessionId, 'RCP_EXTENSION_LIMIT_OVERRIDE', { decision, cycle_index: next, new_max_extension_cycles: session.max_extension_cycles + 1 }, ctx, now);
      });
    } else if (decision === 'finish_blind') {
      this.db.transaction(() => {
        this.db.updateSession(sessionId, {
          state: 'BLIND_COMPLETE', pause_reason: null, current_step_id: protocol.completion.blind_complete_step,
          current_step_instance_id: stepInstanceId(protocol.completion.blind_complete_step, session.cycle_index), blind_completed_at: now,
          blind_completion_reason: 'conductor_stop_after_extension_limit', updated_at: now, version: session.version + 1,
        });
        this.db.appendAudit(sessionId, 'BLIND_COMPLETE', { reason: 'conductor_stop_after_extension_limit', cycle_index: session.cycle_index }, ctx, now);
      });
    } else if (decision === 'cancel') return this.cancel(ctx, sessionId, 'cancelled at RCP extension limit');
    else throw new EchoError('INVALID_DECISION', 'unsupported extension-limit decision');
    return this.getSession(ctx, sessionId);
  }

  pause(ctx, sessionId, reason = 'paused by conductor') {
    const session = this.#getSessionRaw(sessionId); this.#assertSessionAccess(ctx, session); this.authority.requireConductor(ctx, session);
    invariant(session.state === 'BLIND_RUNNING', 'ILLEGAL_STATE', 'only BLIND_RUNNING can be paused');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'PAUSED', pause_reason: String(reason), updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'SESSION_PAUSED', { reason: String(reason), last_accepted_step_instance_id: session.last_accepted_step_instance_id }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  resume(ctx, sessionId) {
    const session = this.#getSessionRaw(sessionId); this.#assertSessionAccess(ctx, session); this.authority.requireConductor(ctx, session);
    invariant(['PAUSED', 'RECOVERING'].includes(session.state), 'ILLEGAL_STATE', 'session is not resumable');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'BLIND_RUNNING', pause_reason: null, failure_reason: null, updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'SESSION_RESUMED', { current_step_instance_id: session.current_step_instance_id, last_accepted_step_instance_id: session.last_accepted_step_instance_id }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  recoverInterruptedWork(ctx, sessionId, reason = 'runtime interrupted during blind work') {
    this.authority.requireRole(ctx, ['session_core', 'admin']);
    const session = this.#getSessionRaw(sessionId);
    invariant(['BLIND_RUNNING', 'RECOVERING'].includes(session.state), 'ILLEGAL_STATE', 'interrupted-work recovery requires BLIND_RUNNING or RECOVERING');
    const openAttempts = this.db.openAttemptsForSession(sessionId);
    const now = this.now();
    let authorizedUnknown = 0; let dispatchedUnknown = 0;
    this.db.transaction(() => {
      for (const attempt of openAttempts) {
        for (const receipt of this.db.openTransportsForAttempt(attempt.attempt_id)) {
          if (receipt.status === 'AUTHORIZED') {
            this.db.updateTransport(receipt.transport_attempt_id, { status: 'UNKNOWN', completed_at: now, error_text: 'recovery: physical dispatch cannot be proven absent after interruption' });
            authorizedUnknown += 1;
          } else if (receipt.status === 'DISPATCHED') {
            this.db.updateTransport(receipt.transport_attempt_id, { status: 'UNKNOWN', completed_at: now, error_text: 'recovery: dispatch outcome unknown after interruption' });
            dispatchedUnknown += 1;
          }
        }
      }
      const fresh = this.#getSessionRaw(sessionId);
      this.db.updateSession(sessionId, { state: 'RECOVERING', failure_reason: String(reason), updated_at: now, version: fresh.version + 1 });
      this.db.appendAudit(sessionId, 'INTERRUPTED_WORK_RECOVERED', {
        reason: String(reason), open_logical_attempts: openAttempts.length, authorized_marked_unknown: authorizedUnknown, dispatched_marked_unknown: dispatchedUnknown,
        current_step_instance_id: session.current_step_instance_id, last_accepted_step_instance_id: session.last_accepted_step_instance_id,
      }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  viewerContextLost(ctx, sessionId, reason = 'viewer context lost') {
    this.authority.requireRuntimeEvent(ctx, 'VIEWER_CONTEXT_LOST');
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    invariant(ctx.echoSessionId === sessionId, 'RUNTIME_SESSION_MISMATCH', 'runtime event is bound to a different ECHO session');
    invariant(ctx.viewerAgentId === session.viewer_agent_id, 'RUNTIME_VIEWER_MISMATCH', 'runtime event is bound to a different Viewer agent');
    invariant(ctx.viewerSessionId === session.viewer_session_id, 'RUNTIME_VIEWER_SESSION_MISMATCH', 'runtime event is bound to a different Viewer session');
    invariant(ACTIVE_BLIND_STATES.has(session.state), 'ILLEGAL_STATE', 'viewer context loss is only meaningful during an active blind session');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'RECOVERING', failure_reason: String(reason), updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'VIEWER_CONTEXT_LOST', {
        reason: String(reason), runtime_event_id: ctx.eventId, viewer_agent_id: ctx.viewerAgentId,
        viewer_session_id: ctx.viewerSessionId, last_accepted_step_instance_id: session.last_accepted_step_instance_id,
      }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  cancel(ctx, sessionId, reason = 'cancelled by conductor') {
    const session = this.#getSessionRaw(sessionId); this.#assertSessionAccess(ctx, session); this.authority.requireConductor(ctx, session);
    invariant(!['CANCELLED', 'CLOSED', 'REVEALED', 'POST_REVEAL'].includes(session.state), 'ILLEGAL_STATE', 'session cannot be cancelled from current state');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'CANCELLED', failure_reason: String(reason), closed_at: now, updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'SESSION_CANCELLED', { reason: String(reason) }, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  authorizeReveal(ctx, sessionId, idempotencyKey) {
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    this.authority.requireConductor(ctx, session);
    invariant(session.state === 'BLIND_COMPLETE' || session.state === 'REVEAL_AUTHORIZED', 'REVEAL_NOT_ALLOWED', 'blind phase is not formally complete');
    invariant(session.target_committed_at && session.target_id && session.target_revision && session.target_sha256, 'NO_TARGET_COMMIT', 'committed target required');
    invariant(typeof idempotencyKey === 'string' && idempotencyKey.trim(), 'INVALID_IDEMPOTENCY_KEY', 'idempotency key required');
    invariant(this.db.countOpenAttempts(sessionId) === 0, 'OPEN_ATTEMPTS', 'unresolved model attempts block Reveal');

    let authorization = null; const now = this.now();
    this.db.transaction(() => {
      const existingByKey = this.db.getRevealAuthorizationByKey(sessionId, idempotencyKey);
      if (existingByKey) { authorization = existingByKey; return; }
      const existingForSession = this.db.getRevealAuthorizationBySession(sessionId);
      invariant(!existingForSession, 'REVEAL_ALREADY_AUTHORIZED', 'session already has a Reveal authorization with a different idempotency key');
      const fresh = this.#getSessionRaw(sessionId);
      invariant(fresh.state === 'BLIND_COMPLETE', 'REVEAL_NOT_ALLOWED', 'state changed before authorization');
      invariant(this.db.countOpenAttempts(sessionId) === 0, 'OPEN_ATTEMPTS', 'unresolved model attempts block Reveal');
      const authorizationId = uuid();
      this.db.insertRevealAuthorization({
        authorization_id: authorizationId, session_id: sessionId, idempotency_key: idempotencyKey,
        target_id: fresh.target_id, target_revision: fresh.target_revision, target_sha256: fresh.target_sha256,
        authorized_at: now, status: 'AUTHORIZED',
      });
      this.db.updateSession(sessionId, { state: 'REVEAL_AUTHORIZED', reveal_authorized_at: now, updated_at: now, version: fresh.version + 1 });
      this.db.appendAudit(sessionId, 'REVEAL_AUTHORIZED', { authorization_id: authorizationId, idempotency_key: idempotencyKey, target_id: fresh.target_id, target_revision: fresh.target_revision, target_sha256: fresh.target_sha256 }, ctx, now);
      authorization = this.db.getRevealAuthorization(authorizationId);
    });
    return this.#authorizationView(ctx, authorization);
  }

  executeReveal(ctx, sessionId, authorizationId, idempotencyKey) {
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    const accessSession = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, accessSession);
    this.authority.requireConductor(ctx, accessSession);
    const existingByKey = this.db.getRevealByKey(sessionId, idempotencyKey);
    if (existingByKey) return existingByKey.reveal_payload;
    const existingForSession = this.db.getRevealBySession(sessionId);
    invariant(!existingForSession, 'REVEAL_IDEMPOTENCY_MISMATCH', 'Reveal already exists for this session under a different idempotency key');

    const now = this.now(); let payload; let committedNew = false;
    this.#fault('beforeRevealPersist', { sessionId, authorizationId });
    this.db.transaction(() => {
      const racedByKey = this.db.getRevealByKey(sessionId, idempotencyKey);
      if (racedByKey) { payload = racedByKey.reveal_payload; return; }
      const racedForSession = this.db.getRevealBySession(sessionId);
      invariant(!racedForSession, 'REVEAL_IDEMPOTENCY_MISMATCH', 'Reveal already exists for this session under a different idempotency key');
      const session = this.#getSessionRaw(sessionId);
      invariant(session.state === 'REVEAL_AUTHORIZED', 'REVEAL_NOT_ALLOWED', 'Reveal execution requires REVEAL_AUTHORIZED');
      const auth = this.db.getRevealAuthorization(authorizationId);
      invariant(auth && auth.session_id === sessionId && auth.idempotency_key === idempotencyKey, 'INVALID_REVEAL_AUTHORIZATION', 'authorization/idempotency mismatch');
      invariant(auth.status === 'AUTHORIZED', 'REVEAL_AUTHORIZATION_CONSUMED', 'authorization already consumed');
      invariant(auth.target_id === session.target_id && auth.target_revision === session.target_revision && auth.target_sha256 === session.target_sha256, 'TARGET_COMMIT_MISMATCH', 'Reveal target differs from committed target');
      const target = this.db.getTarget(session.target_id, session.target_revision);
      invariant(target && target.sha256 === session.target_sha256, 'TARGET_COMMIT_MISMATCH', 'committed target bytes unavailable or changed');
      payload = {
        reveal_operation_id: uuid(), session_id: sessionId, target_id: target.target_id, target_revision: target.revision,
        target_sha256: target.sha256, title: target.title, kind: target.kind, content: target.content, has_ascii_feedback: target.has_ascii_feedback,
      };
      this.db.updateSession(sessionId, { state: 'REVEALING', updated_at: now, version: session.version + 1 });
      this.db.insertReveal({
        reveal_operation_id: payload.reveal_operation_id, authorization_id: authorizationId, session_id: sessionId, idempotency_key: idempotencyKey,
        target_id: target.target_id, target_revision: target.revision, target_sha256: target.sha256,
        reveal_payload_json: JSON.stringify(payload), revealed_at: now,
      });
      this.db.updateRevealAuthorization(authorizationId, { status: 'CONSUMED' });
      const fresh = this.#getSessionRaw(sessionId);
      this.db.updateSession(sessionId, { state: 'REVEALED', revealed_at: now, monitor_blindness: 'DISCLOSED_AFTER_REVEAL', updated_at: now, version: fresh.version + 1 });
      this.db.markExposureRevealed(target.target_id, session.viewer_agent_id, sessionId, now);
      this.db.appendAudit(sessionId, 'REVEAL_COMMITTED', { reveal_operation_id: payload.reveal_operation_id, authorization_id: authorizationId, idempotency_key: idempotencyKey, target_id: target.target_id, target_revision: target.revision, target_sha256: target.sha256 }, ctx, now);
      committedNew = true;
    });
    if (committedNew) this.#fault('afterRevealPersistBeforeReturn', { sessionId, revealOperationId: payload.reveal_operation_id });
    return payload;
  }

  getTargetFeedback(ctx, sessionId) {
    const session = this.getSession(ctx, sessionId);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor', 'echo_viewer']);
    invariant(REVEALED_STATES.has(session.state), 'TARGET_SEALED', 'target feedback is sealed until Reveal');
    if (ctx.role === 'echo_viewer') invariant(session.viewer_agent_id === ctx.agentId, 'FORBIDDEN', 'viewer is not bound to this session');
    const reveal = this.db.getRevealBySession(sessionId);
    invariant(reveal, 'REVEAL_RECORD_MISSING', 'durable Reveal record missing');
    return reveal.reveal_payload;
  }

  enterPostReveal(ctx, sessionId) {
    const session = this.getSession(ctx, sessionId);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor', 'echo_viewer']);
    invariant(session.state === 'REVEALED', 'ILLEGAL_STATE', 'POST_REVEAL requires REVEALED');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'POST_REVEAL', updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'POST_REVEAL_STARTED', {}, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  closeSession(ctx, sessionId) {
    const session = this.getSession(ctx, sessionId);
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    invariant(session.state === 'POST_REVEAL', 'ILLEGAL_STATE', 'session can close only after POST_REVEAL');
    const now = this.now();
    this.db.transaction(() => {
      this.db.updateSession(sessionId, { state: 'CLOSED', closed_at: now, updated_at: now, version: session.version + 1 });
      this.db.appendAudit(sessionId, 'SESSION_CLOSED', {}, ctx, now);
    });
    return this.getSession(ctx, sessionId);
  }

  freezeTelepathyTaskingQuestions(ctx, sessionId, questions, { neutralityVerifier, neutralityVerifierId = 'echo-neutrality-v1' } = {}) {
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    this.authority.requireConductor(ctx, session);
    invariant(session.protocol_id === 'telepathy', 'NOT_TELEPATHY', 'T9 tasking questions apply only to Telepathy protocol');
    invariant(session.state === 'BLIND_RUNNING' && session.current_step_id === 'telepathy.t8' && session.checkpoint_pending, 'TELEPATHY_TASKING_WINDOW', 'T9 questions must be frozen at the T8 checkpoint');
    invariant(Array.isArray(questions) && questions.length > 0 && questions.length <= 20, 'INVALID_TASKING_QUESTIONS', '1..20 tasking questions required');
    invariant(typeof neutralityVerifier === 'function', 'NEUTRALITY_VERIFIER_REQUIRED', 'trusted neutrality verifier required');
    const neutralityContext = this.#neutralityBlindContext(session);
    const frozen = questions.map((question, index) => {
      invariant(typeof question === 'string' && question.trim(), 'INVALID_TASKING_QUESTION', `question ${index + 1} is empty`);
      const text = question.trim(); const status = neutralityVerifier(text, neutralityContext);
      invariant(status === 'NEUTRAL', 'TASKING_NOT_NEUTRAL', `T9 question ${index + 1} blocked: neutrality=${status}`);
      return { question_id: `T9-Q${index + 1}`, text, sha256: sha256Text(text), neutrality_verifier_id: neutralityVerifierId, neutrality_status: 'NEUTRAL' };
    });
    const now = this.now();
    this.db.transaction(() => {
      const fresh = this.#getSessionRaw(sessionId);
      invariant(JSON.parse(fresh.telepathy_tasking_questions_json ?? '[]').length === 0, 'TASKING_ALREADY_FROZEN', 'Telepathy tasking questions are immutable once frozen');
      this.db.updateSession(sessionId, { telepathy_tasking_questions_json: JSON.stringify(frozen), updated_at: now, version: fresh.version + 1 });
      this.db.appendAudit(sessionId, 'TELEPATHY_TASKING_FROZEN', { count: frozen.length, questions: frozen.map((q) => ({ question_id: q.question_id, sha256: q.sha256, neutrality_verifier_id: q.neutrality_verifier_id })) }, ctx, now);
    });
    return { count: frozen.length, questions: frozen.map((q) => ({ question_id: q.question_id, sha256: q.sha256 })) };
  }

  getTelepathyTaskingQuestions(ctx, sessionId) {
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor', 'echo_viewer']);
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    invariant(session.protocol_id === 'telepathy', 'NOT_TELEPATHY', 'tasking questions apply only to Telepathy protocol');
    invariant(session.state === 'BLIND_RUNNING' && session.current_step_id === 'telepathy.t9', 'TASKING_SEALED', 'T9 tasking questions are available only while T9 is active');
    return JSON.parse(session.telepathy_tasking_questions_json ?? '[]').map(({ question_id, text, sha256 }) => ({ question_id, text, sha256 }));
  }

  freezeAdjunct(ctx, sessionId, instruction, { neutralityVerifier, neutralityVerifierId = 'echo-neutrality-v1' } = {}) {
    const session = this.#getSessionRaw(sessionId); this.#assertSessionAccess(ctx, session); this.authority.requireConductor(ctx, session);
    invariant(session.state === 'BLIND_RUNNING' && session.checkpoint_pending, 'NO_ADJUNCT_CHECKPOINT', 'adjunct probes are allowed only at a pending blind checkpoint');
    invariant(typeof instruction === 'string' && instruction.trim(), 'EMPTY_ADJUNCT', 'adjunct instruction required');
    invariant(typeof neutralityVerifier === 'function', 'NEUTRALITY_VERIFIER_REQUIRED', 'trusted neutrality verifier required');
    const status = neutralityVerifier(instruction, this.#neutralityBlindContext(this.#getSessionRaw(sessionId)));
    invariant(status === 'NEUTRAL', 'ADJUNCT_NOT_NEUTRAL', `adjunct blocked: neutrality=${status}`);
    const now = this.now(); const adjunctId = uuid();
    this.db.transaction(() => {
      this.db.insertAdjunct({ adjunct_id: adjunctId, session_id: sessionId, step_instance_id: session.current_step_instance_id,
        instruction_text: instruction, instruction_sha256: sha256Text(instruction), issued_by: ctx.role,
        neutrality_verifier_id: neutralityVerifierId, neutrality_status: 'NEUTRAL', frozen_at: now });
      this.db.appendAudit(sessionId, 'ADJUNCT_FROZEN', { adjunct_id: adjunctId, step_instance_id: session.current_step_instance_id, instruction_sha256: sha256Text(instruction), issued_by: ctx.role, neutrality_verifier_id: neutralityVerifierId }, ctx, now);
    });
    return { adjunct_id: adjunctId, instruction_sha256: sha256Text(instruction), neutrality_status: 'NEUTRAL', issued_by: ctx.role };
  }

  auditTrail(ctx, sessionId) {
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    const session = this.#getSessionRaw(sessionId);
    this.#assertSessionAccess(ctx, session);
    if (!['session_core', 'admin'].includes(ctx.role) && !REVEALED_STATES.has(session.state)) {
      throw new EchoError('AUDIT_SEALED', 'full audit payload is sealed from conductors until Reveal');
    }
    return this.db.listAudit(sessionId);
  }

  verifyAuditTrail(ctx, sessionId) {
    this.authority.requireRole(ctx, ['session_core', 'admin', 'human_user', 'ai_monitor']);
    this.getSession(ctx, sessionId);
    return this.db.verifyAudit(sessionId);
  }
}
