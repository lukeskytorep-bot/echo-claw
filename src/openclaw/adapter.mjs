import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EchoSessionEngine } from '../session-engine.mjs';
import { createExecutionAuthority } from '../security.mjs';
import { importBundledTargets } from '../target-library.mjs';
import { resolveProtocol } from '../protocol-runtime.mjs';
import { EchoError } from '../errors.mjs';
import { EchoOpenClawStore } from './integration-store.mjs';
import { renderViewerPrompt, strictT10SupportVerifier } from './prompt-renderer.mjs';
import { strictBlindNeutralityVerifier } from './neutrality-verifier.mjs';

function sha256Json(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safeId(value) { return String(value).replace(/[^A-Za-z0-9._-]/gu, '_'); }
function terminalText(result) {
  const v = result?.terminalReply;
  if (typeof v === 'string') return v;
  if (v && typeof v.text === 'string') return v.text;
  if (v && typeof v.rawText === 'string') return v.rawText;
  if (typeof result?.text === 'string') return result.text;
  return '';
}
function providerId(ctx, event = null) { return [event?.provider ?? ctx?.modelProviderId ?? ctx?.provider ?? 'unknown', event?.model ?? ctx?.modelId ?? ctx?.model ?? 'unknown'].join('/'); }
function expandHome(value) { const v=String(value); return v === '~' ? os.homedir() : v.startsWith('~/') || v.startsWith('~\\') ? path.join(os.homedir(), v.slice(2)) : v; }
function normalizeDataDir(value) { return path.resolve(expandHome(value)); }

export const ECHO_OPENCLAW_COMPAT = Object.freeze({
  host: 'OpenClaw',
  tested_release: '2026.11.7',
  viewer_runtime: 'plugin-owned persistent subagent session',
  required_model_gate: 'before_model_request',
  unsupported_transport_policy: 'fail-closed if no ECHO physical receipt is produced',
});

export class EchoOpenClawAdapter {
  constructor({ api, config = {}, coreDbPath = null, integrationDbPath = null, waitTimeoutMs = 60000 } = {}) {
    if (!api?.runtime?.subagent || !api?.runtime?.system) throw new EchoError('OPENCLAW_RUNTIME_REQUIRED', 'OpenClaw subagent and system runtime helpers are required');
    this.api = api;
    this.config = {
      ...config,
      ownerAgentId: config.ownerAgentId ?? 'main',
      monitorAgentId: config.monitorAgentId ?? 'echo-monitor',
      viewerAgentId: config.viewerAgentId ?? 'echo-viewer',
      dataDir: normalizeDataDir(config.dataDir ?? path.join(os.homedir(), '.openclaw', 'echo-claw')),
    };
    fs.mkdirSync(this.config.dataDir, { recursive: true });
    this.authority = createExecutionAuthority({ monitorAgentIds: [this.config.monitorAgentId], viewerAgentIds: [this.config.viewerAgentId] });
    this.core = new EchoSessionEngine({ authority: this.authority, dbPath: coreDbPath ?? path.join(this.config.dataDir, 'session-core.sqlite') });
    this.store = new EchoOpenClawStore(integrationDbPath ?? path.join(this.config.dataDir, 'openclaw-integration.sqlite'));
    this.systemCtx = this.authority.fromHostFacts({ actorKind: 'system', requesterPrincipalId: 'system:echo-claw' });
    importBundledTargets(this.core, this.systemCtx);
    this.waitTimeoutMs = waitTimeoutMs;
  }

  close() { this.store.close(); this.core.close(); }

  ownerContext(toolCtx) {
    if (toolCtx?.senderIsOwner !== true || !toolCtx?.requesterSenderId || toolCtx?.agentId !== this.config.ownerAgentId) throw new EchoError('OWNER_CONTEXT_REQUIRED', 'host-verified owner sender on the configured owner-facing agent is required');
    return this.authority.fromHostFacts({ actorKind: 'owner', principalId: toolCtx.requesterSenderId, requesterPrincipalId: toolCtx.requesterSenderId, agentId: toolCtx.agentId, sessionKey: toolCtx.sessionKey, sessionId: toolCtx.sessionId, runId: toolCtx.runId });
  }

  monitorContext(toolCtx) {
    if (toolCtx?.agentId !== this.config.monitorAgentId || !toolCtx?.requesterSenderId) throw new EchoError('MONITOR_CONTEXT_REQUIRED', 'configured Monitor plus host-trusted requester identity required');
    return this.authority.fromHostFacts({ actorKind: 'agent', agentId: toolCtx.agentId, requesterPrincipalId: toolCtx.requesterSenderId, sessionKey: toolCtx.sessionKey, sessionId: toolCtx.sessionId, runId: toolCtx.runId });
  }

  coreContext(ownerPrincipalId) {
    return this.authority.fromHostFacts({ actorKind: 'system', requesterPrincipalId: ownerPrincipalId });
  }

  #assertConductorExecution(ctx, sessionId) {
    const visible = this.core.getSession(ctx, sessionId);
    const internal = this.core.getSession(this.systemCtx, sessionId);
    this.authority.requireConductor(ctx, internal);
    return visible;
  }

  viewerSessionKey(sessionId) { return `agent:${this.config.viewerAgentId}:subagent:echo-${safeId(sessionId)}`; }

  prepareSession(ctx, input = {}) {
    const protocol = resolveProtocol(input.protocol_id ?? 'rv-lite-extended', input.protocol_version ?? (input.protocol_id === 'rcp' ? '1.5a' : input.protocol_id === 'telepathy' ? '1.1' : '1.1.0'));
    const session = this.core.createSession(ctx, {
      mode: input.mode ?? 'manual',
      protocol_id: protocol.id,
      protocol_version: protocol.version,
      conductor_mode: input.conductor_mode ?? (ctx.role === 'ai_monitor' ? 'ai_monitor' : 'human_user'),
      tasking_mode: input.tasking_mode ?? 'neutral_code',
      human_blindness: input.human_blindness ?? 'BLIND',
      viewer_blindness: input.viewer_blindness ?? 'BLIND',
      target_exposure_class: input.target_exposure_class ?? 'public',
      viewer_agent_id: this.config.viewerAgentId,
      language: input.language ?? 'pl',
    });
    this.core.reserveTarget(ctx, session.session_id, { target_id: input.target_id ?? null });
    this.core.commitReservedTarget(ctx, session.session_id);
    const key = this.viewerSessionKey(session.session_id);
    this.core.bindViewer(ctx, session.session_id, key);
    const internal = this.core.getSession(this.systemCtx, session.session_id);
    this.store.bindViewer({ echoSessionId: session.session_id, ownerPrincipalId: internal.owner_principal_id, viewerAgentId: this.config.viewerAgentId, viewerSessionKey: key, coreViewerSessionId: key });
    return this.core.getSession(ctx, session.session_id);
  }

  #coreAuditHas(coreCtx, sessionId, eventType, predicate = () => true) {
    return this.core.auditTrail(coreCtx, sessionId).some((event) => event.event_type === eventType && predicate(event.payload ?? {}));
  }

  #reconcilePendingViewerContextLoss(binding, { generation = null } = {}) {
    const pendingEvent = this.store.pendingRuntimeEvent('VIEWER_CONTEXT_LOST', binding.echo_session_id);
    if (!pendingEvent) return null;
    const eventId = pendingEvent.event_id;
    const coreCtx = this.coreContext(binding.owner_principal_id);
    let session = this.core.getSession(coreCtx, binding.echo_session_id);
    const coreHasLoss = this.#coreAuditHas(coreCtx, binding.echo_session_id, 'VIEWER_CONTEXT_LOST', (payload) => payload.runtime_event_id === eventId);
    if (!coreHasLoss) {
      if (session.state === 'RECOVERING') {
        throw new EchoError('RECOVERY_EVENT_CORE_MISMATCH', 'pending Viewer context-loss event has no matching Session Core audit record');
      }
      const runtimeCtx = this.authority.fromRuntimeEvent({ actorKind: 'runtime', eventType: 'VIEWER_CONTEXT_LOST', eventId, echoSessionId: binding.echo_session_id, viewerAgentId: binding.viewer_agent_id, viewerSessionId: binding.core_viewer_session_id, requesterPrincipalId: binding.owner_principal_id, sessionId: generation?.sessionId ?? null });
      this.core.viewerContextLost(runtimeCtx, binding.echo_session_id, 'OpenClaw Viewer session generation changed or disappeared');
      session = this.core.getSession(coreCtx, binding.echo_session_id);
    }
    const recoveryMarker = `runtime_event_id=${eventId}`;
    if (!this.#coreAuditHas(coreCtx, binding.echo_session_id, 'INTERRUPTED_WORK_RECOVERED', (payload) => String(payload.reason ?? '').includes(recoveryMarker))) {
      if (session.state !== 'RECOVERING') {
        throw new EchoError('RECOVERY_EVENT_CORE_MISMATCH', `pending Viewer context-loss event cannot be reconciled from Session Core state ${session.state}`);
      }
      this.core.recoverInterruptedWork(coreCtx, binding.echo_session_id, `Viewer context lost; ${recoveryMarker}; unresolved work marked unknown before rebind`);
    }
    const snapshot = this.core.getBlindRecoveryContext(coreCtx, binding.echo_session_id);
    this.store.completeViewerContextLossEvent({ eventId, echoSessionId: binding.echo_session_id, recoveryContext: snapshot, currentAttemptId: binding.current_attempt_id });
    return this.store.getRuntimeEvent(eventId);
  }

  async #checkViewerGeneration(binding) {
    if (!binding.host_session_id || !Number.isInteger(binding.lifecycle_revision)) return { ok: true, first: true };
    const generation = await this.api.runtime.system.captureSessionGeneration({ agentId: binding.viewer_agent_id, sessionKey: binding.viewer_session_key });
    const pendingEvent = this.store.pendingRuntimeEvent('VIEWER_CONTEXT_LOST', binding.echo_session_id);
    if (pendingEvent) {
      this.#reconcilePendingViewerContextLoss(binding, { generation });
      return { ok: false, generation };
    }
    if (!generation || generation.sessionId !== binding.host_session_id || generation.lifecycleRevision !== binding.lifecycle_revision) {
      const eventId = `viewer-context-lost:${binding.echo_session_id}:${safeId(binding.host_session_id)}:${binding.lifecycle_revision}`;
      this.store.beginRuntimeEvent(eventId, 'VIEWER_CONTEXT_LOST', binding.echo_session_id);
      this.#reconcilePendingViewerContextLoss(binding, { generation });
      return { ok: false, generation };
    }
    return { ok: true, generation };
  }

  async #captureGeneration(binding) {
    const generation = await this.api.runtime.system.captureSessionGeneration({ agentId: binding.viewer_agent_id, sessionKey: binding.viewer_session_key });
    if (!generation) throw new EchoError('VIEWER_GENERATION_MISSING', 'OpenClaw did not expose a generation for the Viewer session');
    if (binding.host_session_id && (generation.sessionId !== binding.host_session_id || generation.lifecycleRevision !== binding.lifecycle_revision)) {
      await this.#checkViewerGeneration(binding);
      throw new EchoError('VIEWER_CONTEXT_LOST', 'Viewer generation changed during the ECHO run');
    }
    this.store.setGeneration(binding.echo_session_id, { hostSessionId: generation.sessionId, lifecycleRevision: generation.lifecycleRevision });
    return generation;
  }

  async runNext(ctx, sessionId, { assertCurrent = () => {} } = {}) {
    let session = this.#assertConductorExecution(ctx, sessionId);
    const binding = this.store.getBinding(sessionId);
    if (!binding) throw new EchoError('VIEWER_BINDING_NOT_FOUND', 'Viewer OpenClaw binding missing');
    if (session.state === 'RECOVERING') {
      const reconciled = this.#reconcilePendingViewerContextLoss(binding);
      if (reconciled) return { status: 'RECOVERING', session: this.core.getSession(ctx, sessionId), reason: 'VIEWER_CONTEXT_LOST' };
    }
    if (session.state !== 'BLIND_RUNNING') throw new EchoError('ILLEGAL_STATE', 'run_next requires BLIND_RUNNING');
    if (session.checkpoint_pending) return { status: 'CHECKPOINT_PENDING', session };
    const continuity = await this.#checkViewerGeneration(binding);
    if (!continuity.ok) return { status: 'RECOVERING', session: this.core.getSession(ctx, sessionId), reason: 'VIEWER_CONTEXT_LOST' };

    if (binding.current_run_id && binding.current_attempt_id) return this.collectRun(ctx, sessionId, { assertCurrent });

    const coreCtx = this.coreContext(binding.owner_principal_id);
    assertCurrent();
    const attempt = this.core.createAttempt(coreCtx, sessionId, {});
    this.store.setActiveAttempt(sessionId, { attemptId: attempt.attempt_id, stepInstanceId: attempt.step_instance_id });
    const tasking = this.core.getBlindTasking(coreCtx, sessionId);
    let questions = [];
    if (session.current_step_id === 'telepathy.t9') questions = this.core.getTelepathyTaskingQuestions(coreCtx, sessionId);
    const recovery = this.store.getRecovery(sessionId)?.recovery_context ?? null;
    const internalSession = this.core.getSession(coreCtx, sessionId);
    const adjuncts = this.core.getFrozenAdjuncts(coreCtx, sessionId).filter((a) => a.step_instance_id === internalSession.last_accepted_step_instance_id);
    const message = renderViewerPrompt({ session: internalSession, tasking, telepathyQuestions: questions, recoveryContext: recovery, adjuncts });
    assertCurrent();
    let launched;
    try {
      launched = await this.api.runtime.subagent.run({
        sessionKey: binding.viewer_session_key,
        message,
        promptMode: 'minimal',
        disableTools: true,
        deliver: false,
        assertCurrent,
      });
    } catch (error) {
      this.core.failAttempt(coreCtx, attempt.attempt_id, `OpenClaw subagent launch failed: ${error?.message ?? error}`);
      this.store.clearActiveAttempt(sessionId, attempt.attempt_id);
      throw error;
    }
    this.store.setRunId(sessionId, launched.runId);
    this.store.attachRunToLatest(binding.viewer_session_key, attempt.attempt_id, launched.runId);
    return this.collectRun(ctx, sessionId, { assertCurrent });
  }

  async collectRun(ctx, sessionId, { assertCurrent = () => {} } = {}) {
    const session = this.#assertConductorExecution(ctx, sessionId);
    const binding = this.store.getBinding(sessionId);
    if (!binding?.current_run_id || !binding.current_attempt_id) throw new EchoError('NO_ACTIVE_VIEWER_RUN', 'no active OpenClaw Viewer run to collect');
    const coreCtx = this.coreContext(binding.owner_principal_id);
    const waited = await this.api.runtime.subagent.waitForRun({ runId: binding.current_run_id, timeoutMs: this.waitTimeoutMs });
    if (waited.status === 'timeout' || waited.status === 'pending') return { status: 'RUNNING', run_id: binding.current_run_id, session };
    assertCurrent();
    if (waited.status !== 'ok') {
      const open = this.store.latestOpenTransportByRun(binding.current_run_id);
      if (open) { try { this.core.failTransport(coreCtx, open.transport_attempt_id, waited.error ?? `OpenClaw run ${waited.status}`); } catch {} this.store.finishTransportLink(open.transport_attempt_id, { status: 'FAILED' }); }
      this.core.failAttempt(coreCtx, binding.current_attempt_id, waited.error ?? `OpenClaw Viewer run ended with ${waited.status}`);
      this.store.clearActiveAttempt(sessionId, binding.current_attempt_id);
      return { status: 'FAILED', error: waited.error ?? waited.status, session: this.core.getSession(ctx, sessionId) };
    }
    await this.#captureGeneration(binding);
    const transport = this.store.latestCompletedTransport(binding.current_attempt_id);
    if (!transport) {
      this.core.recoverInterruptedWork(coreCtx, sessionId, 'Viewer run completed without a provable completed before_model_request transport receipt');
      this.store.clearActiveAttempt(sessionId, binding.current_attempt_id);
      return { status: 'RECOVERING', reason: 'MISSING_PHYSICAL_TRANSPORT_PROOF', session: this.core.getSession(ctx, sessionId) };
    }
    const text = terminalText(waited);
    if (!text.trim()) {
      this.core.failAttempt(coreCtx, binding.current_attempt_id, 'OpenClaw Viewer run returned no terminal text');
      this.store.clearActiveAttempt(sessionId, binding.current_attempt_id);
      return { status: 'REJECTED', errors: ['empty terminal Viewer response'], session: this.core.getSession(ctx, sessionId) };
    }
    const recorded = this.core.recordAttemptResponse(coreCtx, binding.current_attempt_id, text, { transport_attempt_id: transport.transport_attempt_id, supportVerifier: strictT10SupportVerifier });
    if (!recorded.validation.ok) {
      this.store.clearActiveAttempt(sessionId, binding.current_attempt_id);
      return { status: 'REJECTED', errors: recorded.validation.errors, session: this.core.getSession(ctx, sessionId) };
    }
    this.core.acceptAttempt(coreCtx, binding.current_attempt_id);
    this.store.clearActiveAttempt(sessionId, binding.current_attempt_id);
    if (this.store.getRecovery(sessionId)?.recovery_context) this.store.clearRecoveryContext(sessionId);
    return { status: 'ACCEPTED', response: text, session: this.core.getSession(ctx, sessionId) };
  }

  async handleBeforeModelRequest(event, hookCtx) {
    const sessionKey = hookCtx?.sessionKey;
    if (!sessionKey) return undefined;
    const binding = this.store.getBindingBySessionKey(sessionKey);
    if (!binding) return undefined;
    if (hookCtx.agentId && hookCtx.agentId !== binding.viewer_agent_id) throw new EchoError('VIEWER_AGENT_MISMATCH', 'ECHO Viewer sessionKey used by unexpected agent');
    if (!binding.current_attempt_id) throw new EchoError('ECHO_UNCONTROLLED_MODEL_REQUEST', 'ECHO Viewer model request has no active logical attempt');
    const coreCtx = this.coreContext(binding.owner_principal_id);
    const prior = this.store.latestOpenTransport({ sessionKey, attemptId: binding.current_attempt_id });
    if (prior) {
      this.core.markTransportUnknown(coreCtx, prior.transport_attempt_id, 'OpenClaw issued another provider request before prior transport reached a terminal hook outcome');
      this.store.finishTransportLink(prior.transport_attempt_id, { status: 'UNKNOWN' });
    }
    const receipt = this.core.authorizePhysicalTransport(coreCtx, binding.current_attempt_id, { provider_id: providerId(hookCtx, event), request_sha256: sha256Json(event?.payload ?? event ?? null) });
    this.core.markTransportDispatched(coreCtx, receipt.transport_attempt_id);
    const ordinal = this.store.nextPhysicalOrdinal(binding.current_attempt_id);
    this.store.insertTransportLink({ transportAttemptId: receipt.transport_attempt_id, echoSessionId: binding.echo_session_id, attemptId: binding.current_attempt_id, runId: hookCtx.runId ?? binding.current_run_id, sessionKey, physicalOrdinal: ordinal, providerId: providerId(hookCtx, event), requestSha256: receipt.request_sha256, status: 'DISPATCHED' });
    return undefined;
  }

  handleModelCallStarted(event, hookCtx) {
    const runId = event?.runId ?? hookCtx?.runId;
    if (!runId) return;
    const binding = this.store.getBindingByRunId(runId) ?? (hookCtx?.sessionKey ? this.store.getBindingBySessionKey(hookCtx.sessionKey) : null);
    if (!binding) return;
    this.store.attachRunToLatest(binding.viewer_session_key, binding.current_attempt_id, runId);
    this.store.attachCall(runId, event?.callId ?? null);
  }

  handleModelCallEnded(event, hookCtx) {
    const runId = event?.runId ?? hookCtx?.runId;
    if (!runId) return;
    const link = this.store.transportForCall(runId, event?.callId ?? null);
    if (!link) {
      const open = this.store.openTransportsByRun(runId);
      const binding = this.store.getBindingByRunId(runId);
      if (open.length && binding) {
        const coreCtx = this.coreContext(binding.owner_principal_id);
        for (const row of open) {
          try { this.core.markTransportUnknown(coreCtx, row.transport_attempt_id, `OpenClaw model_call_ended could not be matched exactly to callId=${event?.callId ?? 'missing'}`); } catch {}
          this.store.finishTransportLink(row.transport_attempt_id, { status: 'UNKNOWN' });
        }
        try { this.core.recoverInterruptedWork(coreCtx, binding.echo_session_id, 'Unmatched OpenClaw model-call terminal event'); } catch {}
      }
      return;
    }
    if (link.status !== 'DISPATCHED') return;
    const coreCtx = this.coreContext(this.store.getBinding(link.echo_session_id)?.owner_principal_id);
    const ok = ['ok','success','completed'].includes(String(event?.outcome ?? '').toLowerCase());
    if (ok) this.core.completeTransport(coreCtx, link.transport_attempt_id, { provider_request_id: event?.upstreamRequestIdHash ?? null });
    else this.core.failTransport(coreCtx, link.transport_attempt_id, `OpenClaw model call outcome=${event?.outcome ?? 'unknown'}`);
    this.store.finishTransportLink(link.transport_attempt_id, { status: ok ? 'COMPLETED' : 'FAILED', upstreamRequestIdHash: event?.upstreamRequestIdHash ?? null });
  }

  async recoverViewerContext(ctx, sessionId, { assertCurrent = () => {} } = {}) {
    let session = this.#assertConductorExecution(ctx, sessionId);
    const binding = this.store.getBinding(sessionId);
    if (!binding) throw new EchoError('VIEWER_BINDING_NOT_FOUND', 'Viewer OpenClaw binding missing');
    this.#reconcilePendingViewerContextLoss(binding);
    session = this.core.getSession(ctx, sessionId);
    const coreCtx = this.coreContext(binding.owner_principal_id);
    let recovery = this.store.getRecovery(sessionId);
    if (!recovery?.recovery_context) {
      if (session.state !== 'RECOVERING') throw new EchoError('ILLEGAL_STATE', 'Viewer recovery requires RECOVERING or an existing durable recovery workflow');
      recovery = this.store.setRecoveryRequired(sessionId, this.core.getBlindRecoveryContext(coreCtx, sessionId));
    }
    if (recovery.resume_status === 'COMPLETE') {
      if (session.state !== 'BLIND_RUNNING') throw new EchoError('RECOVERY_STATE_MISMATCH', 'Integration Store says recovery completed but Session Core is not BLIND_RUNNING');
      return this.core.getSession(ctx, sessionId);
    }
    const newKey = recovery.planned_session_key ?? `${this.viewerSessionKey(sessionId)}:recovery-${recovery.recovery_revision}`;
    recovery = this.store.beginRecoveryResume(sessionId, newKey);
    assertCurrent();
    session = this.core.getSession(ctx, sessionId);
    if (recovery.resume_status === 'PENDING') {
      if (session.state === 'RECOVERING') {
        this.core.resume(ctx, sessionId);
        session = this.core.getSession(ctx, sessionId);
      } else if (session.state !== 'BLIND_RUNNING') {
        throw new EchoError('RECOVERY_STATE_MISMATCH', `cannot reconcile Viewer recovery with Session Core state ${session.state}`);
      }
      if (session.state !== 'BLIND_RUNNING') throw new EchoError('RECOVERY_CORE_RESUME_FAILED', 'Session Core did not reach BLIND_RUNNING during Viewer recovery');
      recovery = this.store.markRecoveryCoreApplied(sessionId, recovery.resume_operation_id);
    }
    if (recovery.resume_status === 'CORE_APPLIED') {
      this.store.finalizeRecovery(sessionId, recovery.resume_operation_id);
    }
    return this.core.getSession(ctx, sessionId);
  }

  async perform(ctx, action, params = {}, { assertCurrent = () => {} } = {}) {
    const effect = (fn) => { assertCurrent(); return fn(); };
    if (action === 'create') return effect(() => this.prepareSession(ctx, params));
    if (action === 'status') return this.core.getSession(ctx, params.session_id);
    if (params.session_id) {
      const recoveryWorkflow = this.store.getRecovery(params.session_id);
      if (recoveryWorkflow?.recovery_context && ['PENDING','CORE_APPLIED'].includes(recoveryWorkflow.resume_status) && action !== 'resume') {
        throw new EchoError('RECOVERY_RESUME_INCOMPLETE', 'Viewer recovery Resume is durably incomplete; only status or resume may proceed');
      }
    }
    if (action === 'start') return effect(() => this.core.startBlind(ctx, params.session_id));
    if (action === 'continue') return effect(() => this.core.continueCheckpoint(ctx, params.session_id));
    if (action === 'pause') return effect(() => this.core.pause(ctx, params.session_id, params.reason ?? 'paused by conductor'));
    if (action === 'resume') {
      const session = this.#assertConductorExecution(ctx, params.session_id);
      const recovery = this.store.getRecovery(params.session_id);
      const incompleteSaga = recovery?.recovery_context && ['PENDING','CORE_APPLIED'].includes(recovery.resume_status);
      const completedSagaReplyLost = recovery?.recovery_context && recovery.resume_status === 'COMPLETE' && session.state === 'BLIND_RUNNING';
      if (session.state === 'RECOVERING' || incompleteSaga || completedSagaReplyLost) return this.recoverViewerContext(ctx, params.session_id, { assertCurrent });
      return effect(() => this.core.resume(ctx, params.session_id));
    }
    if (action === 'freeze_t9') return effect(() => this.core.freezeTelepathyTaskingQuestions(ctx, params.session_id, params.questions, { neutralityVerifier: strictBlindNeutralityVerifier, neutralityVerifierId: 'echo-openclaw-strict-blind-v1' }));
    if (action === 'freeze_adjunct') return effect(() => this.core.freezeAdjunct(ctx, params.session_id, params.instruction, { neutralityVerifier: strictBlindNeutralityVerifier, neutralityVerifierId: 'echo-openclaw-strict-blind-v1' }));
    if (action === 'cancel') return effect(() => this.core.cancel(ctx, params.session_id, params.reason ?? 'cancelled by conductor'));
    if (action === 'reveal') return effect(() => {
      const key = `openclaw:${params.session_id}:reveal:v1`;
      const auth = this.core.authorizeReveal(ctx, params.session_id, key);
      return this.core.executeReveal(ctx, params.session_id, auth.authorization_id, key);
    });
    if (action === 'post_reveal') return effect(() => { const feedback=this.core.getTargetFeedback(ctx, params.session_id); const session=this.core.enterPostReveal(ctx, params.session_id); return { feedback, session }; });
    if (action === 'close') return effect(() => this.core.closeSession(ctx, params.session_id));
    throw new EchoError('UNKNOWN_OPENCLAW_ACTION', `unknown ECHO action ${action}`);
  }
}
