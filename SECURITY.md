# Security policy

ECHO-CLAW treats target blindness, session ownership, Reveal authorization, and durable execution evidence as security boundaries rather than prompt conventions.

## Core invariants

- Full target data must remain inside the trusted Session Core / Vault boundary before Reveal.
- Monitor and Viewer must not receive full target content before Reveal.
- Session ownership is bound to a trusted host principal.
- `owner_principal_id = null` is treated as `UNBOUND_LEGACY` and fails closed for ordinary Human, Monitor, Viewer and runtime contexts.
- `VIEWER_CONTEXT_LOST` requires a trusted runtime event bound to the exact ECHO session and Viewer session.
- A physical provider dispatch must have durable pre-dispatch evidence before transport.
- Accepted step output must be tied to a completed transport attempt.
- Reveal is transactional and idempotent.
- Unknown protocol/version combinations fail closed before paid execution.

## Reporting a security issue

Do not publish an exploit containing private target material or real user session data. Open a minimal private report with reproduction steps, affected version, expected behavior and actual behavior through the repository owner's preferred private contact channel.

For public bug reports, use synthetic targets and synthetic session identifiers.

## ECHO-3 note

The ECHO-2 core is host-independent. OpenClaw tool exposure, trusted runtime facts, plugin permissions and user identity binding are implemented in the ECHO-3 integration stage. An adapter must not weaken the core invariants listed above.
