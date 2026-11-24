# ECHO-CLAW roadmap

## ECHO-0 - architecture and migration

Complete.

## ECHO-1 - Protocol Pack

Complete and accepted.

Includes RCP v1.5a, RV Lite Core v1.1.0, RV Lite Extended v1.1.0 and Telepathy v1.1, plus tasking overlays, structural result contracts and protocol validation.

Normative RCP Phase 5.4 rule: 2 to 5 movements.

## ECHO-2 - Session Core

Complete and accepted.

Includes durable Session Engine, SQLite persistence, Vault semantics, ownership isolation, attempts/transport receipts, checkpoints, Pause/Resume/Recovery/Cancel, Reveal Gate, target exposure history and migration protections.

## ECHO-3 - OpenClaw integration

ECHO-3 FIX 0.3.4 implementation candidate complete after A1–A8 remediation, B1–B2 crash-safe Recovery coordination and C1 orphaned-Recovery reconciliation; final independent audit pending.

Implemented scope:

- native OpenClaw plugin/adapter and manifest
- trusted requester/agent binding from host context
- separated owner-facing and blind Monitor tool surfaces
- persistent tool-free Viewer session contract
- Viewer generation continuity plus explicit recovery rebind/replay
- crash-safe `PENDING → APPLIED` runtime-event handling, orphaned-event reconciliation from durable Session Core audit/state, and idempotent cross-store Resume saga
- final supported provider-request gate with physical transport receipts
- strict model-call correlation (`runId + callId`) and fail-closed missing-proof handling
- canonical per-step protocol methodology rendering
- Telepathy T9 neutral tasking and neutral adjunct probes
- per-agent workspace/tool configuration example
- executable mock-host integration tests preserving all ECHO-2 guarantees
- 16 full-session scenarios across all 4 protocols, both conductors and both tasking modes

Real supported-Gateway smoke/E2E validation remains an ECHO-4 gate because the current build container does not have a compatible OpenClaw CLI/runtime installed.

## ECHO-4 - installation and end-to-end release

Planned scope:

- installer / self-test
- clean setup and upgrade tests
- conflict detection and rollback
- full blind session tests
- public GitHub installation instructions

## ECHO-5 - autonomous training and learning

Planned scope:

- opt-in scheduled training
- target selection policies
- post-Reveal learning lifecycle
- confirmed/rejected/retired pattern handling
- cost/frequency/session limits
