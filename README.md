# ECHO-CLAW

**ECHO-CLAW** is an experimental AI Remote Viewing framework built around strict blind-target separation, a Monitor-Viewer architecture, durable session state, explicit protocol contracts, controlled Reveal, and cumulative post-session learning.

This repository is the **clean-source baseline after ECHO-2 final acceptance**. It replaces the old prompt-driven repository as the active development base.

> Current status: ECHO-2 Session Core complete. OpenClaw integration is the next stage, ECHO-3.

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
├── src/                            # ECHO-2 Session Core
├── runtime/                        # compiled protocol/target registries
├── protocol-pack/                  # approved executable protocol contracts
├── targets/source/                 # 126 active bundled target source files
├── tests/                          # executable tests
├── tools/                          # verification and developer tooling
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

- Node.js 22.13 or newer
- no production npm dependencies for the ECHO-2 core

## Verify the clean source

From the repository root:

```bash
npm test
npm run verify:baselines
npm run verify:package
```

The clean-source baseline is expected to pass all ECHO-2 executable tests before ECHO-3 changes are introduced.

## Important ECHO-3 boundary

This repository **does not yet expose the Session Core as a production OpenClaw plugin**. That is intentional.

ECHO-3 will connect the approved core to OpenClaw and must provide trusted host facts for user ownership, agent identity, Viewer session identity and runtime events. Model-supplied parameters must not be accepted as substitutes for trusted host identity.

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

The next implementation stage is **ECHO-3: OpenClaw integration**.
