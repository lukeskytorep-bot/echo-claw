import { EchoError } from './errors.mjs';

const TRUST = Symbol('echo.trusted-execution-context');

function requireNonEmptyString(value, code, message) {
  if (typeof value !== 'string' || !value.trim()) throw new EchoError(code, message);
  return value.trim();
}

export function createExecutionAuthority(policy = {}) {
  const monitor = new Set(policy.monitorAgentIds ?? ['echo-monitor']);
  const viewer = new Set(policy.viewerAgentIds ?? ['echo-viewer']);
  const admin = new Set(policy.adminAgentIds ?? []);
  const capability = Object.freeze({});

  function assert(ctx) {
    if (!ctx || ctx[TRUST] !== capability) {
      throw new EchoError('UNTRUSTED_CONTEXT', 'execution context was not issued by this engine authority');
    }
    return ctx;
  }

  function fromHostFacts(hostFacts) {
    if (!hostFacts || typeof hostFacts !== 'object') {
      throw new EchoError('UNTRUSTED_CONTEXT', 'host execution facts required');
    }
    let role;
    if (hostFacts.actorKind === 'system') role = 'session_core';
    else if (hostFacts.actorKind === 'owner') role = 'human_user';
    else if (hostFacts.actorKind === 'admin' || admin.has(hostFacts.agentId)) role = 'admin';
    else if (monitor.has(hostFacts.agentId)) role = 'ai_monitor';
    else if (viewer.has(hostFacts.agentId)) role = 'echo_viewer';
    else throw new EchoError('UNAUTHORIZED_ACTOR', 'caller is not mapped to an ECHO role');

    const principalId = role === 'human_user'
      ? requireNonEmptyString(hostFacts.principalId, 'OWNER_PRINCIPAL_REQUIRED', 'trusted owner principalId is required')
      : (typeof hostFacts.principalId === 'string' && hostFacts.principalId.trim() ? hostFacts.principalId.trim() : null);
    const requesterPrincipalId = typeof hostFacts.requesterPrincipalId === 'string' && hostFacts.requesterPrincipalId.trim()
      ? hostFacts.requesterPrincipalId.trim()
      : (role === 'human_user' ? principalId : null);

    return Object.freeze({
      [TRUST]: capability,
      role,
      agentId: hostFacts.agentId ?? null,
      principalId,
      requesterPrincipalId,
      sessionKey: hostFacts.sessionKey ?? null,
      hostSessionId: hostFacts.sessionId ?? null,
      runId: hostFacts.runId ?? null,
      actorKind: hostFacts.actorKind,
      requesterDeviceId: hostFacts.requesterDeviceId ?? null,
    });
  }

  function fromRuntimeEvent(hostFacts) {
    if (!hostFacts || typeof hostFacts !== 'object' || hostFacts.actorKind !== 'runtime') {
      throw new EchoError('UNTRUSTED_RUNTIME_EVENT', 'trusted runtime event facts required');
    }
    const eventType = requireNonEmptyString(hostFacts.eventType, 'RUNTIME_EVENT_TYPE_REQUIRED', 'runtime event type required');
    const eventId = requireNonEmptyString(hostFacts.eventId, 'RUNTIME_EVENT_ID_REQUIRED', 'runtime event id required');
    const echoSessionId = requireNonEmptyString(hostFacts.echoSessionId, 'RUNTIME_SESSION_REQUIRED', 'echo session id required');
    const viewerAgentId = requireNonEmptyString(hostFacts.viewerAgentId, 'RUNTIME_VIEWER_REQUIRED', 'viewer agent id required');
    const viewerSessionId = requireNonEmptyString(hostFacts.viewerSessionId, 'RUNTIME_VIEWER_SESSION_REQUIRED', 'viewer session id required');
    if (!viewer.has(viewerAgentId)) throw new EchoError('UNKNOWN_VIEWER_AGENT', 'runtime event viewer_agent_id is not mapped by this authority');
    const requesterPrincipalId = typeof hostFacts.requesterPrincipalId === 'string' && hostFacts.requesterPrincipalId.trim()
      ? hostFacts.requesterPrincipalId.trim()
      : null;
    return Object.freeze({
      [TRUST]: capability,
      role: 'runtime_event',
      agentId: 'echo-runtime',
      principalId: null,
      requesterPrincipalId,
      sessionKey: null,
      hostSessionId: hostFacts.sessionId ?? null,
      runId: hostFacts.runId ?? null,
      actorKind: 'runtime',
      requesterDeviceId: null,
      eventType,
      eventId,
      echoSessionId,
      viewerAgentId,
      viewerSessionId,
    });
  }

  function requireRole(ctx, allowed) {
    assert(ctx);
    if (!allowed.includes(ctx.role)) {
      throw new EchoError('FORBIDDEN', `role ${ctx.role} is not allowed for this operation`);
    }
  }

  function requireConductor(ctx, session) {
    assert(ctx);
    if (ctx.role === 'session_core' || ctx.role === 'admin') return;
    if (session.conductor_mode === 'ai_monitor' && ctx.role === 'ai_monitor') return;
    if (session.conductor_mode === 'human_user' && ctx.role === 'human_user') {
      if (!session.owner_principal_id || ctx.principalId !== session.owner_principal_id) {
        throw new EchoError('FORBIDDEN_SESSION_OWNER', 'human caller is not the owner of this session');
      }
      return;
    }
    throw new EchoError('WRONG_CONDUCTOR', `session conductor is ${session.conductor_mode}`);
  }

  function requireRuntimeEvent(ctx, expectedEventType) {
    assert(ctx);
    if (ctx.role !== 'runtime_event') throw new EchoError('RUNTIME_EVENT_REQUIRED', 'operation requires a trusted runtime event context');
    if (ctx.eventType !== expectedEventType) throw new EchoError('RUNTIME_EVENT_TYPE_MISMATCH', `expected runtime event ${expectedEventType}`);
  }

  function requireViewerAgentId(agentId) {
    if (typeof agentId !== 'string' || !viewer.has(agentId)) {
      throw new EchoError('UNKNOWN_VIEWER_AGENT', 'viewer_agent_id must be mapped by the bound execution authority');
    }
    return agentId;
  }

  return Object.freeze({ fromHostFacts, fromRuntimeEvent, assert, requireRole, requireConductor, requireRuntimeEvent, requireViewerAgentId });
}
