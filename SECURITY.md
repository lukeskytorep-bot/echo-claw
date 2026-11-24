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

## ECHO-3 OpenClaw boundary

The ECHO-2 core remains host-independent. The ECHO-3 native plugin maps trusted OpenClaw facts into that core and adds these integration invariants:

- the human-owner surface is limited to the configured owner-facing agent and requires host-proven owner/requester identity;
- the AI Monitor surface is separate and cannot borrow the human-owner tool;
- the Viewer is launched with an exact empty client-tool surface;
- supported Viewer provider calls must pass the enabled `before_model_request` gate and receive durable ECHO transport evidence before dispatch;
- a missing receipt, lost Viewer generation, or unsupported transport path fails closed rather than silently accepting a Viewer answer.

Native OpenClaw plugins run inside the Gateway process and therefore belong to the host trust boundary. ECHO-3 is pinned to a tested OpenClaw compatibility line; do not widen that range without compatibility testing. Real Gateway validation is still required before a production release.
