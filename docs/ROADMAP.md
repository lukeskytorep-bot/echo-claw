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

Next stage.

Planned scope:

- OpenClaw plugin/adapter
- trusted host principal and runtime-fact binding
- Monitor and Viewer tool surfaces
- Viewer session continuity contract
- per-agent tool permissions
- actual OpenClaw transport integration and recovery tests
- human-user conductor mode in the real host

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
