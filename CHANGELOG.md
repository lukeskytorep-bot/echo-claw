# Changelog

## 0.2.3 - 2026-11-24

First clean-source repository generated after final ECHO-2 acceptance.

Highlights:

- durable SQLite Session Engine
- Sealed Target Vault semantics
- immutable target commit
- owner-principal session isolation
- fail-closed `UNBOUND_LEGACY` migration behavior
- trusted runtime-event path for Viewer context loss
- logical attempts and physical transport receipts
- checkpoints, Pause, Resume, Recovery and Cancel
- transactional/idempotent Reveal Gate
- target exposure history
- 126 preserved bundled targets
- four approved protocol baselines from ECHO-1
- 76 executable ECHO-2 tests
- split MIT / CC BY 4.0 licensing and explicit project provenance

OpenClaw plugin/adapter integration is intentionally deferred to ECHO-3.

### Repository layout cleanup

- Moved preserved protocol/identity/vocabulary/learning source content under `docs/reference/project-content/`.
- Moved build provenance, frozen baselines and package integrity manifest under `docs/development/integrity/`.
- Kept only active runtime/data directories at repository root.
- `targets/source/` remains active because the Session Core reads the bundled target library directly.
