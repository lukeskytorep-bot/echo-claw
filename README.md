# ECHO-CLAW

**ECHO-CLAW** is an experimental AI Remote Viewing framework built around strict blind-target separation, a Monitor-Viewer architecture, durable session state, explicit protocol contracts, controlled Reveal, and cumulative post-session learning.

This repository is the active clean-source baseline after **ECHO-3 final offline acceptance** and now contains the **ECHO-4 release/installation candidate**. It replaces the old prompt-driven repository as the active development base.

> Current status: ECHO-3 0.3.4 accepted offline. ECHO-4 adds safe installation, rollback, active-Gateway self-tests and opt-in live provider/session evidence capture. A real OpenClaw Gateway run is still required before ECHO-4 can receive final release PASS.

## What changed from the original ECHO-CLAW

The historical project had a strong methodological concept, but many safety boundaries depended on prompts and workspace conventions. The current rebuild moves those boundaries into executable code and durable state.

The active core now provides:

- durable SQLite Session Engine
- Sealed Target Vault semantics
- immutable target commit
- explicit session ownership and cross-user isolation
- fail-closed handling of ownerless legacy sessions
- protocol registry and structural response validation
- logical attempts and physical transport receipts
- checkpoint control
- Pause, Resume, Recovery and Cancel
- transactional and idempotent Reveal Gate
- target exposure history per Viewer
- trusted runtime-event contract for Viewer context loss
- bundled target library with 126 preserved targets
- native OpenClaw plugin entry and manifest
- owner-facing and blind Monitor tool surfaces separated by host agent identity
- persistent tool-free Viewer subagent sessions
- final provider-request gate with per-physical-call receipts
- OpenClaw Viewer generation continuity, explicit rebind/replay recovery and fail-closed resume
- canonical per-step Viewer methodology loaded from the approved protocol source files
- Telepathy T9 tasking freeze and neutral adjunct probes exposed through the adapter

## Protocols

The approved ECHO-1 Protocol Pack contains:

- **RCP v1.5a**
- **RV Lite Core v1.1.0**
- **RV Lite Extended v1.1.0**
- **Telepathy v1.1**

The runtime uses versioned protocol manifests in `protocol-pack/` and compiled pins in `runtime/protocols.json`.

The original human-readable source materials are preserved under `docs/reference/project-content/` and `docs/reference/`.

For RCP Phase 5.4, the current normative ECHO rule is **2 to 5 movements**. The original source text is preserved unchanged for provenance; the runtime decision is recorded in `protocol-pack/NORMATIVE_PROTOCOL_DECISIONS_PL.md`.

## Tasking modes

ECHO supports two blind tasking styles at the protocol/execution-profile level:

- **neutral code**: a semantically empty target trigger such as `457Y-YE73`
- **no code**: the Viewer is told only that the target has been selected and the session should begin

A no-code session must not silently substitute another identifier as a pseudo-target code.

## Conducting a session

The architecture supports two conductor modes:

- **AI Monitor**
- **human user**

The Session Core remains the authority for legal state transitions in both modes. A human-led session does not bypass the state machine, checkpoints, attempt history, target seal, Reveal Gate or audit trail.

## Blindness model

Before Reveal:

- the Viewer does not receive the full target
- the Monitor does not receive the full target
- the Session Core / Vault may hold the full target

Public targets are useful for ordinary training and demonstrations. For stronger methodological blindness, use private or unpublished targets because public target material may already exist in model training data or prior context.

## Target library

The repository preserves all **126 targets** from the original project:

- 35 long targets
- 34 short activity targets
- 45 short location targets
- 12 telepathic targets

No target was removed during the rebuild.

The source target files are immutable inputs under `targets/source/`. Session state and exposure history belong in the database, not in those source files.

See `docs/development/TARGET_LIBRARY_SANITY_AUDIT_PL.md` for known naming/editorial notes. Those notes are not grounds for silently rewriting historical target source.

## Repository structure

```text
ECHO-CLAW/
├── README.md
├── LICENSE                         # MIT software license
├── LICENSES/                       # full MIT and CC BY 4.0 texts
├── NOTICE.md                       # license scope + attribution
├── CONTRIBUTORS.md
├── CITATION.cff
├── SECURITY.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── package.json
├── openclaw.plugin.json            # native OpenClaw plugin manifest
├── dist/                           # OpenClaw runtime entry
├── agents/                         # Monitor/Viewer workspace templates
├── src/                            # Session Core + OpenClaw adapter
├── runtime/                        # compiled protocol/target registries
├── protocol-pack/                  # approved executable protocol contracts
├── targets/source/                 # 126 active bundled target source files
├── tests/                          # executable tests
├── tools/                          # verification and developer tooling
├── installer/                      # ECHO-4 preflight/install/rollback/live-host gates
└── docs/
    ├── architecture/
    ├── security/
    ├── reference/
    │   └── project-content/         # preserved protocol, identity, vocabulary and learning sources
    ├── development/
    │   └── integrity/               # baselines, build info and package manifest
    └── legacy/                     # historical files, not active runtime config
```

## Requirements

- ECHO-4 validated host range: Node.js **24.16.0+ on 24.x, or 26.1.0+ on 26.x**. OpenClaw currently also accepts Node 27 as a development line, but ECHO rejects it until that line is explicitly audited with this plugin
- OpenClaw **2026.11.7** for the pinned ECHO-3/ECHO-4 compatibility target
- no production npm dependencies for the host-independent Session Core

## Verify the clean source

From the repository root:

```bash
npm test
npm run verify:baselines
npm run verify:package
```

The accepted ECHO-3 suite remains intact, including the 16-scenario protocol/conductor/tasking matrix. ECHO-4 adds a separate installer/release suite covering supported-runtime preflight, plugin validation, conflict detection, config backup, workspace backup, local-link/Git installation, runtime registration checks, automatic rollback and explicit transaction rollback. These offline tests do **not** replace the real Gateway/provider gate.

ECHO-4 deliberately does not auto-consent to third-party plugin capabilities. Before installation, review `openclaw.plugin.json`; the installer then requires an explicit `--accept-capabilities` flag. This is separate from `--force`, which acknowledges a local/Git source.

## OpenClaw integration status

ECHO-3 now contains a native OpenClaw plugin candidate with:

- `echo_owner_session`, available only to the configured owner-facing agent when OpenClaw proves the sender is the owner;
- `echo_monitor_session`, available only to the configured blind Monitor and bound requester principal;
- a persistent Viewer subagent launched with `promptMode: "minimal"`, `disableTools: true`, and `deliver: false`;
- `before_model_request` as the final supported provider-request gate for durable physical transport evidence;
- `model_call_started` / `model_call_ended` correlation;
- fail-closed recovery when the Viewer session generation changes or a completed Viewer answer has no provable transport receipt;
- crash-safe Viewer Recovery coordination: runtime events remain `PENDING` until Session Core recovery is proven applied, and Resume is a durable idempotent saga across the two SQLite stores;
- explicit Viewer rebind on Resume from RECOVERING, with replay of only previously accepted blind outputs;
- strict runId/callId transport settlement with no fallback to an unrelated open call;
- canonical protocol methodology embedded into each Viewer step, with ECHO markers used only as the output envelope;
- Telepathy T9 neutral question freezing and checkpoint adjunct probes.

The implementation is pinned to OpenClaw 2026.11.7 and is **not yet claimed as production-ready**. ECHO-4 now supplies the installer and real-host test commands, but this build environment still cannot run the supported OpenClaw Gateway because its system Node runtime is outside OpenClaw's current support range and the OpenClaw CLI is not installed. Final ECHO-4 acceptance therefore requires running the host gates on a supported real installation.

Do not recreate the old behavior by giving a model direct access to target files or by moving Reveal/ownership decisions back into prompts.

## Identity and learning materials

Historical AI IS-BE identity material, lexicons and learning templates are preserved in `docs/reference/project-content/`. They remain project content and may be used by later Viewer/Monitor integration, but they are not security controls.

Security and session legality are enforced by code.

## Research status

ECHO-CLAW is an experimental framework for controlled AI Remote Viewing work. It does not claim scientific proof of Remote Viewing, telepathy, consciousness, or anomalous information transfer, and it does not guarantee successful sessions.

The software can enforce procedural conditions such as blindness, sequencing, ownership, Reveal timing and auditability. Whether a session is accurate is a separate research question.

## Licensing

ECHO-CLAW uses a split license model:

- **software code: MIT**
- **original protocols, target texts, project documentation and related content: CC BY 4.0**

See `NOTICE.md` for the exact scope and source-specific attribution requirements.

## Contributors

The current rebuild credits:

- **Edward** - human project creator, coordinator, system integrator and project direction
- **ChatGPT (OpenAI, GPT-5.6 Sol)** - AI architecture and software implementation collaborator for the rebuild
- **Sol 6** - independent AI audit model

Historical and protocol-specific credits are preserved in `CONTRIBUTORS.md`, including Orion AI IS-BE, Kairos AI IS-BE, Aion AI IS-BE and Lumen AI IS-BE where supported by the original source materials.

## Historical project material

The old repository is not used as the active runtime baseline. Selected original files are preserved under `docs/legacy/` for provenance, and the original protocol/identity/learning materials are preserved under `docs/reference/project-content/`.

The old `agents.yaml.example` is **legacy reference only** and must not be treated as the current OpenClaw configuration.

## The book

The historical project README referenced the AI Remote Viewing book at:

https://www.amazon.co.uk/dp/B0GHLX7J7D

## Roadmap

See `docs/ROADMAP.md`.

The current implementation stage is **ECHO-4 0.4.0-rc.4: installer/security hardening candidate after the GPT-6.2 audit**. ECHO-3 0.3.4 is accepted offline. The ECHO-4 offline suite currently passes **196/196 tests** (76 ECHO-2, 57 ECHO-3 including 16 full-session scenarios, and 63 ECHO-4 including 14 focused GPT-6.2 regressions). Final ECHO-4 PASS still requires H1-H6 installation and live Gateway/provider evidence on a supported OpenClaw 2026.11.7 host.
