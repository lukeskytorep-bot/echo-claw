# ECHO-3 OpenClaw Integration Contract

Status: implementation candidate for independent audit.

## Trust boundary

OpenClaw host facts are authoritative. Model tool arguments never select caller role, principal, Monitor identity, Viewer identity, runtime event identity, or transport receipt identity.

`echo_owner_session` exists only on the configured owner-facing agent (default `main`) when the v2 tool factory receives `senderIsOwner === true` and a host-trusted `requesterSenderId`. It is not materialized inside the AI Monitor or Viewer agent.

`echo_monitor_session` exists only for the configured Monitor agent and a host-trusted requester principal. Session Core owner binding remains authoritative.

## Viewer continuity

Each ECHO session gets one deterministic plugin-owned Viewer `sessionKey`. The key contains only the ECHO session UUID, never target metadata. Viewer runs use `promptMode: "minimal"`, `disableTools: true`, and `deliver: false`.

After the first Viewer turn, ECHO stores the OpenClaw `sessionId` and `lifecycleRevision` returned by `captureSessionGeneration`. Before each later Viewer step, both values are rechecked. A reset, replacement, or missing generation produces the trusted technical event `VIEWER_CONTEXT_LOST` and Session Core enters `RECOVERING`.

## Physical provider-call evidence

For a bound ECHO Viewer session, every supported provider request must pass through `before_model_request`. Before that request may leave the host, ECHO persists a Session Core physical transport receipt and marks it dispatched. Hook failure throws and therefore blocks the request on supported OpenClaw runtimes.

`model_call_started` associates the provider call with the receipt. `model_call_ended` durably records terminal success/failure and the bounded `upstreamRequestIdHash` when OpenClaw supplies it.

A Viewer answer is never accepted unless it references a durably `COMPLETED` physical receipt. If a Viewer run finishes but no such proof exists, ECHO fails closed to `RECOVERING`.

A failed or unknown provider transport may be retried inside the same logical Viewer attempt, and each physical try gets its own receipt. ECHO-2 intentionally forbids a second provider dispatch after one transport has already reached `COMPLETED` under that logical attempt. This conservative rule prevents a completed call from being silently replayed before its response is resolved. The accepted step result is provenance-bound to one durably completed receipt.

## Compatibility boundary

ECHO-3 targets OpenClaw 2026.11.7 and pins the initial plugin compatibility range to the 2026.11 line. The Plugin SDK is experimental, so later host releases require compatibility testing before widening the range.

ECHO only claims transport-proof coverage for OpenClaw paths intercepted by the final model-request gate. External harnesses, cloud workers, native Codex paths, or custom transports that bypass that gate are unsupported for audited ECHO Viewer execution. The runtime fails closed when a completed ECHO Viewer run lacks the required transport proof.

## ECHO-3 vs ECHO-4

ECHO-3 provides the plugin, agent workspace templates, host configuration example, durable integration binding store, and executable mock-host integration tests. ECHO-4 will provide installer/setup automation and real-host Gateway smoke/end-to-end validation on a machine with the supported OpenClaw CLI/runtime installed.
