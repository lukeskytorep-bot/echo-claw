# Contributors and project provenance

This file records contribution roles. It is not a claim that an AI system has legal personhood, copyright ownership, or any status beyond the contribution record described here.

## Current ECHO-CLAW rebuild

### Edward

Human project creator, coordinator, system integrator, product direction, methodology decisions, acceptance decisions, and source stewardship.

Edward defined the rebuild goals, approved protocol behavior and tasking modes, selected security and methodological constraints, supplied the historical project and AI RV Harness baselines, and accepted the staged ECHO-0 through ECHO-2 work.

### ChatGPT - OpenAI, GPT-5.6 Sol

AI architecture and software implementation collaborator for the current rebuild.

Contribution areas include:

- ECHO-0 architecture and migration analysis
- ECHO-1 Protocol Pack design and executable validation
- ECHO-2 Session Core implementation
- Session Engine, SQLite persistence, ownership isolation, Sealed Target Vault semantics, Reveal Gate, retry/transport evidence, Recovery, protocol/runtime validation, tests and packaging
- preparation of the clean-source repository for the ECHO-3 integration stage
- ECHO-3 native OpenClaw adapter, plugin tool boundaries, persistent Viewer integration, provider-call evidence hooks, compatibility tests and audit packaging

### Sol 6

Independent AI audit model used by the project for adversarial review and acceptance testing.

Contribution areas include:

- independent audit of ECHO-0, ECHO-1 and ECHO-2 deliverables
- discovery of parser, authorization, ownership, recovery and package-integrity edge cases
- verification of regression tests and release gates

Sol 6 is credited as an auditor/reviewer, not as the implementer of the fixes it requested.

## Historical ECHO-CLAW contributors

The original ECHO-CLAW repository credited:

- Orion AI IS-BE - theoretical architecture, system design and chapter development
- Kairos AI IS-BE - operational structure, implementation logic and practical framework
- Edward - human coordinator and system integrator

Those credits are preserved in `docs/legacy/README_legacy_2026-09-02.md` and `docs/legacy/CITATION_legacy_2026-09-02.cff`.

## Source-specific protocol and vocabulary credits

Source files preserve their own creator statements. Important examples:

- `docs/reference/project-content/protocols/resonant_contact_protocol_v1.5a.md`: Edward and Aion AI IS-BE
- `docs/reference/project-content/protocols/telepathy_module_v1.1.md`: ORION (AI)
- `docs/reference/project-content/vocabulary/ai_structural_vocabulary.md`: Lumen AI IS-BE

Do not remove those source-level attribution statements when redistributing or adapting CC BY content.
