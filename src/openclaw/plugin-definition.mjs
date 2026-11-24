import { EchoOpenClawAdapter, ECHO_OPENCLAW_COMPAT } from './adapter.mjs';
import { EchoError } from '../errors.mjs';

const TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['create','status','start','run_next','collect','continue','pause','resume','freeze_t9','freeze_adjunct','cancel','reveal','post_reveal','close'] },
    session_id: { type: 'string' },
    protocol_id: { type: 'string', enum: ['rcp','rv-lite-core','rv-lite-extended','telepathy'] },
    protocol_version: { type: 'string' },
    conductor_mode: { type: 'string', enum: ['human_user','ai_monitor'] },
    tasking_mode: { type: 'string', enum: ['neutral_code','no_code'] },
    mode: { type: 'string', enum: ['manual','training','automation'] },
    language: { type: 'string', enum: ['pl','en'] },
    human_blindness: { type: 'string', enum: ['BLIND','USER_KNOWN','PARTIALLY_KNOWN'] },
    viewer_blindness: { type: 'string', enum: ['BLIND','KNOWN_TARGET_TRAINING'] },
    target_exposure_class: { type: 'string', enum: ['public','private'] },
    target_id: { type: 'string' },
    reason: { type: 'string' },
    questions: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1 } },
    instruction: { type: 'string', minLength: 1 },
  },
  required: ['action'],
};

function resultEnvelope(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value };
}
function errorEnvelope(error) {
  const details = { ok: false, error: { code: error?.code ?? 'ECHO_OPENCLAW_ERROR', message: String(error?.message ?? error) } };
  return resultEnvelope(details);
}

function createConcreteTool({ name, description, adapter, coreContextFactory, toolContext }) {
  return {
    name,
    label: name === 'echo_owner_session' ? 'ECHO-CLAW Owner Session' : 'ECHO-CLAW Monitor Session',
    description,
    parameters: TOOL_PARAMETERS,
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      try {
        const ctx = coreContextFactory(toolContext);
        const assertCurrent = toolContext.assertInvocationCurrent ?? (() => {});
        if (params.action === 'run_next') return resultEnvelope(await adapter.runNext(ctx, params.session_id, { assertCurrent }));
        if (params.action === 'collect') return resultEnvelope(await adapter.collectRun(ctx, params.session_id, { assertCurrent }));
        return resultEnvelope(await adapter.perform(ctx, params.action, params, { assertCurrent }));
      } catch (error) {
        if (error instanceof EchoError || error?.code) return errorEnvelope(error);
        throw error;
      }
    },
  };
}

export function createEchoPluginDefinition() {
  let adapter = null;
  const getAdapter = (api) => {
    if (!adapter) adapter = new EchoOpenClawAdapter({ api, config: api.pluginConfig ?? {} });
    return adapter;
  };

  return {
    id: 'echo-claw',
    name: 'ECHO-CLAW',
    description: 'Blind Remote Viewing session orchestration with durable Session Core, Vault, Reveal Gate, and OpenClaw Viewer continuity.',
    configSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        dataDir: { type: 'string' },
        ownerAgentId: { type: 'string', default: 'main' },
        monitorAgentId: { type: 'string', default: 'echo-monitor' },
        viewerAgentId: { type: 'string', default: 'echo-viewer' },
      },
    },
    register(api) {
      api.registerTool({
        contextVersion: 2,
        create(toolContext) {
          if (toolContext.senderIsOwner !== true || !toolContext.requesterSenderId || toolContext.agentId !== (api.pluginConfig?.ownerAgentId ?? 'main')) return null;
          const a = getAdapter(api);
          return createConcreteTool({ name: 'echo_owner_session', description: 'Create and conduct ECHO-CLAW sessions as the host-verified human owner. Authority is derived from OpenClaw runtime context, never tool arguments.', adapter: a, coreContextFactory: (tc) => a.ownerContext(tc), toolContext });
        },
      }, { name: 'echo_owner_session' });

      api.registerTool({
        contextVersion: 2,
        create(toolContext) {
          if (toolContext.agentId !== (api.pluginConfig?.monitorAgentId ?? 'echo-monitor') || !toolContext.requesterSenderId) return null;
          const a = getAdapter(api);
          return createConcreteTool({ name: 'echo_monitor_session', description: 'Conduct ECHO-CLAW sessions as the configured blind AI Monitor for the host-trusted requester. Core owner binding and conductor mode remain authoritative.', adapter: a, coreContextFactory: (tc) => a.monitorContext(tc), toolContext });
        },
      }, { name: 'echo_monitor_session' });

      if (api.registrationMode && api.registrationMode !== 'full') return;
      const a = getAdapter(api);
      api.on('before_model_request', async (event, ctx) => a.handleBeforeModelRequest(event, ctx), { priority: 1000, timeoutMs: 10000 });
      api.on('model_call_started', (event, ctx) => { a.handleModelCallStarted(event, ctx); });
      api.on('model_call_ended', (event, ctx) => { a.handleModelCallEnded(event, ctx); });
      api.on('gateway_stop', async () => { a.close(); });
      api.logger?.info?.(`ECHO-CLAW ECHO-3 loaded; compatibility target ${ECHO_OPENCLAW_COMPAT.tested_release}`);
    },
  };
}
