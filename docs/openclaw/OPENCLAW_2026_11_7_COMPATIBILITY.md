# OpenClaw 2026.11.7 compatibility baseline

Status: ECHO-3 implementation candidate, independent audit pending.

Verified on 2026-11-24 against the public OpenClaw documentation and stable release information.

## Pinned host

- OpenClaw stable target: `2026.11.7`
- plugin API/package compatibility: `>=2026.11.7 <2026.12.0`
- minimum Gateway version: `2026.11.7`
- supported Node 22 floor used by this package: `22.22.3`
- Node 24 is the recommended OpenClaw runtime line

The Plugin SDK is experimental. Do not widen the declared compatibility range merely because a newer OpenClaw version exists. Test the new host first.

## Contracts used by ECHO-3

ECHO-3 depends on documented OpenClaw behavior for:

1. v2 plugin tool factories and host-trusted requester context;
2. `assertInvocationCurrent` at authority-sensitive effect boundaries;
3. `api.runtime.subagent.run(...)` with persistent `sessionKey`, `promptMode: "minimal"`, `disableTools: true`, and `deliver: false`;
4. `api.runtime.subagent.waitForRun(...)` terminal/pending observations;
5. `api.runtime.system.captureSessionGeneration(...)` for Viewer continuity;
6. `before_model_request` as the awaited final provider-request policy gate on supported paths;
7. `model_call_started` / `model_call_ended` for bounded provider-call telemetry.

The model-request hook must be explicitly enabled for this plugin with `allowModelRequest`, conversation access, and prompt modification permission.

## Explicit unsupported boundary

OpenClaw documents that `before_model_request` does not intercept every possible external harness/cloud-worker/custom transport path. ECHO-3 therefore does not claim audited execution on a path that cannot produce the required ECHO physical transport receipt.

If a Viewer run completes without such evidence, the adapter fails closed into Recovery rather than accepting the Viewer response.

The ECHO-2 invariant also remains stronger than a permissive host retry policy: after one physical transport has reached `COMPLETED`, a second provider dispatch under the same logical attempt is rejected. Provider retry is supported after a failed/unknown physical attempt, not after a completed one whose result has not yet been resolved.

## Local validation limitation

The build container used for ECHO-3 has Node `22.16.0` and does not have the supported OpenClaw CLI/package installed. It can execute the host-independent Session Core and mock-host integration suite, but it cannot honestly prove live Gateway loading or real-provider hook behavior.

Therefore ECHO-3 audit evidence separates:

- executable core + mock-host contract tests, which are performed now;
- real OpenClaw 2026.11.7 plugin validation, Gateway smoke tests and end-to-end model calls, which are release gates for ECHO-4.

## Public references consulted

- https://github.com/openclaw/openclaw/releases
- https://docs.openclaw.ai/plugins/tool-plugins
- https://docs.openclaw.ai/plugins/sdk-runtime/background-work
- https://docs.openclaw.ai/plugins/hooks/prompt-and-session
- https://docs.openclaw.ai/plugins/building-plugins
- https://docs.openclaw.ai/configuration
- https://docs.openclaw.ai/install/node
