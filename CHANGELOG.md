# Changelog

## 0.4.0-rc.4 - ECHO-4 FIX A1-A7 after GPT-6.2 audit

- fail closed when plugin inventory or existing OpenClaw configuration cannot be read reliably before mutation;
- verify every rollback mutation and report `ROLLBACK_INCOMPLETE` instead of false success;
- protect user configuration/workspace edits made after installation or concurrently with automatic rollback;
- use role/path-unique workspace backups and reject overlapping Monitor/Viewer workspaces;
- validate `plugins inspect --runtime --json` structurally using `inspectionScope: cli`, top-level `imported`, plugin `toolNames`, and top-level `typedHooks`; diagnostic text can never substitute for registrations;
- strengthen live-smoke evidence to bind session, protocol/version, conductor/tasking, accepted attempt, step result, physical receipt, chronology, exact step sequence, and Reveal boundary;
- persist crash-safe `PLUGIN_INSTALL_PENDING` intent before the external install effect and reconcile it after restart;
- preserve the original GPT-6.2 reproduction ZIP and add 14 focused A1-A7 regression tests while retaining 49 baseline ECHO-4 tests;
- split installer tests into isolated Node processes and use a deterministic sequential test runner to avoid fake-CLI/process-state interference;
- retain the deliberately narrow ECHO-4 validated Node profile (24.x/26.x) even though current OpenClaw documentation also accepts Node 27 as a development line.

## 0.4.0-rc.3 - ECHO-4 installer security hardening

- require explicit operator `--accept-capabilities` before ECHO performs any plugin-install mutation;
- pass both `--force` (source acknowledgement) and `--accept-capabilities` to local/Git OpenClaw installs;
- validate the actual built entry with `plugins validate --root <repo> --entry ./dist/index.js --json`;
- keep the ECHO-4 validated host range deliberately narrower than OpenClaw's full runtime acceptance: Node 24.16+ on 24.x or Node 26.1+ on 26.x; OpenClaw's Node 27 development line remains outside this RC until separately audited;
- when Gateway RPC is reachable, require a successful `plugins reload echo-claw --wait --json` before installation is accepted;
- host self-test now performs the same Gateway reload gate before runtime inspection;
- rollback uninstalls the transaction-owned plugin before restoring the exact pre-install plugin/agent policy snapshots;
- live provider smoke uses a unique dedicated OpenClaw agent session key instead of contaminating the normal `main` session;
- detect incompatible pre-existing Monitor/Viewer and ECHO hook policy before mutation;
- keep workspace planning read-only until the install transaction actually applies changes;
- extend installer regressions through E4-T35.

## 0.4.0-rc.2 - ECHO-4 offline hardening

- dokładny floor Node: 24.16+ albo 26.1+; Node 26.0 jest odrzucany;
- prerelease OpenClaw nie jest traktowany jako zweryfikowany stabilny host;
- instalacja z Git wymaga jawnego `gitRef`, preferencyjnie SHA commita;
- host self-test potwierdza także obecność `echo_owner_session` dla agenta `main`;
- live smoke wykrywa nową sesję przez różnicę identyfikatorów, bez zależności od porównania zegarów;
- rozszerzono testy instalatora do E4-T01–E4-T26.

## 0.4.0-rc.1 - ECHO-4 installation/release candidate

- add OpenClaw 2026.11.7 host preflight and plugin-manifest validation
- update Node compatibility to the current OpenClaw policy: `>=24.16.0 <25 || >=26.1.0`
- add transactional installer with config backup, conflict detection, local-link/Git modes and explicit rollback records
- preserve existing main-agent tool allowlists while adding `echo_owner_session`
- create/reconcile Monitor and Viewer workspaces with backup-before-overwrite behavior
- enforce Monitor-only `echo_monitor_session` and Viewer `deny: ["*"]` defense in depth
- add active-Gateway self-test for RPC reachability, runtime registrations and required hook permissions
- add opt-in one-step real provider smoke evidence and opt-in full RV Lite Core session gate
- add Windows PowerShell and POSIX install wrappers
- add 23 ECHO-4 installer/release regressions while preserving all accepted ECHO-3 tests
- keep real OpenClaw Gateway/provider execution as an explicit final release gate rather than claiming it from mock-host evidence

## 0.3.4 - ECHO-3 FIX C1 candidate

- reconcile orphaned `VIEWER_CONTEXT_LOST` events when Session Core is already durably `RECOVERING` but Integration Store still records the event as `PENDING`
- recover the missing blind snapshot from Session Core audit/state before permitting Resume
- allow `run_next` in `RECOVERING` to perform reconciliation and return a controlled `RECOVERING` status instead of failing with `ILLEGAL_STATE`
- preserve accepted blind outputs across C1 crash/restart reconciliation
- prove idempotence across two restarts with exactly one `VIEWER_CONTEXT_LOST`, one matching `INTERRUPTED_WORK_RECOVERED`, and one `SESSION_RESUMED` audit event
- retain Integration Store schema v3; C1 requires no database schema change
- add the dedicated E3-FIX-C1 crash-point regression while retaining the full 16-scenario protocol matrix

## 0.3.3 - ECHO-3 FIX B1-B2 candidate

- make `VIEWER_CONTEXT_LOST` runtime-event dedup durable with explicit `PENDING` and `APPLIED` states
- replay incomplete context-loss recovery after restart by reconciling Session Core audit evidence instead of consuming the event early
- resume an existing pending context-loss event even if the host Viewer generation changes again before recovery finishes
- make Viewer Resume a durable idempotent saga across Session Core and the OpenClaw Integration Store
- persist the planned recovery `sessionKey` and operation id before calling Session Core Resume
- infer an already-applied core Resume after a crash and safely finish the Integration Store commit on retry
- block unrelated mutations while a cross-store Resume saga is incomplete
- version the Integration Store as schema v3 and test v1→v3 and v2→v3 migration behavior
- preserve legacy runtime events as `PENDING` on migration rather than assuming they were fully applied
- add crash/restart regressions for B1 and B2 while retaining the full 16-scenario protocol matrix

## 0.3.2 - ECHO-3 FIX final candidate

- enforce conductor identity before `run_next` and `collect` privilege elevation
- require exact `runId + callId` settlement; unmatched terminal events enter Recovery
- replace weak Telepathy T10 word-overlap support check with fail-closed content-token support
- implement Viewer context Recovery rebind with accepted-blind-output replay
- expose Telepathy T9 question freezing and neutral adjunct probes through OpenClaw tools
- create/normalize plugin data directory before opening SQLite, including `~` expansion
- restore canonical per-step protocol methodology in Viewer prompts; ECHO markers remain output-only contracts
- add 7 focused A1–A7 audit regressions and 16 full end-to-end session scenarios across all protocols, conductor modes and tasking modes
- version the OpenClaw integration store as schema v2 and test migration from legacy v1 with Viewer bindings preserved

## 0.3.0 - 2026-11-24

ECHO-3 OpenClaw integration candidate. Independent audit pending.

Highlights:

- native `openclaw.plugin.json` and runtime entry
- OpenClaw adapter backed by the accepted ECHO-2 Session Core
- separate owner-facing (`main` by default), blind Monitor and tool-free Viewer roles
- trusted requester identity comes from OpenClaw runtime context, never model parameters
- persistent plugin-owned Viewer session with generation continuity checks
- `before_model_request` durable physical receipt gate for supported provider paths
- `model_call_started` / `model_call_ended` transport correlation
- provider retry evidence while preserving the ECHO-2 no-double-successful-dispatch rule
- fail-closed behavior when a Viewer run lacks transport proof
- durable OpenClaw integration SQLite store
- OpenClaw 2026.11.7 compatibility pin and configuration example
- canonical RV Lite source/reference files restored under `docs/reference/project-content/protocols/`
- 28 ECHO-3 integration tests plus the unchanged 76 ECHO-2 tests

Real supported-Gateway smoke/E2E testing is explicitly deferred to ECHO-4; the current build environment does not provide a compatible OpenClaw CLI/runtime.

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
