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

Complete and accepted offline at version 0.3.4.

Includes native plugin integration, trusted owner/Monitor surfaces, persistent tool-free Viewer sessions, physical provider-call receipts, strict call correlation, canonical protocol rendering, T9/adjunct neutrality gates and crash-safe cross-store Recovery/Resume coordination.

## ECHO-4 - installation and end-to-end release

Implementation candidate 0.4.0-rc.4 after GPT-6.2 installer/security hardening.

Implemented offline scope:

- installer preflight and dry planning
- OpenClaw plugin manifest validation
- supported Node/OpenClaw version checks
- verified config backup before mutation
- conflict detection for existing ECHO agent workspaces/config
- local-link and pinned Git installation modes
- transactional workspace/config changes with rollback
- active runtime registration self-test
- opt-in one-step real provider smoke capture
- opt-in full RV Lite Core session capture through Reveal and CLOSED
- Windows PowerShell and POSIX wrappers

Final ECHO-4 gate still requires a real OpenClaw 2026.11.7 Gateway on a supported Node runtime.

## ECHO-5 - autonomous training and learning

Planned scope:

- opt-in scheduled training
- target selection policies
- post-Reveal learning lifecycle
- confirmed/rejected/retired pattern handling
- cost/frequency/session limits
