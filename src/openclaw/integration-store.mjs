import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { EchoError } from '../errors.mjs';

function nowIso() { return new Date().toISOString(); }

export class EchoOpenClawStore {
  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys=ON;');
    if (dbPath !== ':memory:') this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS echo_openclaw_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const schemaRow = this.db.prepare("SELECT value FROM echo_openclaw_meta WHERE key='schema_version'").get();
    const existingVersion = schemaRow ? Number(schemaRow.value) : 0;
    if (!Number.isInteger(existingVersion) || existingVersion < 0 || existingVersion > 3) {
      throw new EchoError('OPENCLAW_STORE_SCHEMA_UNSUPPORTED', `unsupported OpenClaw integration store schema version: ${schemaRow?.value ?? 'unknown'}`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS viewer_bindings (
        echo_session_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL,
        viewer_agent_id TEXT NOT NULL,
        viewer_session_key TEXT NOT NULL UNIQUE,
        core_viewer_session_id TEXT NOT NULL,
        host_session_id TEXT,
        lifecycle_revision INTEGER,
        current_attempt_id TEXT,
        current_run_id TEXT,
        current_step_instance_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS viewer_bindings_by_run ON viewer_bindings(current_run_id);
      CREATE TABLE IF NOT EXISTS viewer_recovery (
        echo_session_id TEXT PRIMARY KEY,
        recovery_revision INTEGER NOT NULL DEFAULT 0,
        recovery_context_json TEXT,
        recovery_required INTEGER NOT NULL DEFAULT 0 CHECK (recovery_required IN (0,1)),
        resume_status TEXT NOT NULL DEFAULT 'NONE' CHECK (resume_status IN ('NONE','PENDING','CORE_APPLIED','COMPLETE')),
        resume_operation_id TEXT,
        planned_session_key TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transport_links (
        transport_attempt_id TEXT PRIMARY KEY,
        echo_session_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        run_id TEXT,
        session_key TEXT NOT NULL,
        physical_ordinal INTEGER NOT NULL,
        call_id TEXT,
        status TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        upstream_request_id_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS transport_links_lookup ON transport_links(session_key, attempt_id, physical_ordinal);
      CREATE INDEX IF NOT EXISTS transport_links_run ON transport_links(run_id, status, physical_ordinal);
      CREATE TABLE IF NOT EXISTS runtime_event_dedup (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        echo_session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPLIED')),
        recorded_at TEXT NOT NULL,
        applied_at TEXT
      );
    `);
    const recoveryColumns = new Set(this.db.prepare('PRAGMA table_info(viewer_recovery)').all().map((r) => r.name));
    if (!recoveryColumns.has('resume_status')) this.db.exec("ALTER TABLE viewer_recovery ADD COLUMN resume_status TEXT NOT NULL DEFAULT 'NONE'");
    if (!recoveryColumns.has('resume_operation_id')) this.db.exec('ALTER TABLE viewer_recovery ADD COLUMN resume_operation_id TEXT');
    if (!recoveryColumns.has('planned_session_key')) this.db.exec('ALTER TABLE viewer_recovery ADD COLUMN planned_session_key TEXT');
    const eventColumns = new Set(this.db.prepare('PRAGMA table_info(runtime_event_dedup)').all().map((r) => r.name));
    if (!eventColumns.has('status')) this.db.exec("ALTER TABLE runtime_event_dedup ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'");
    if (!eventColumns.has('applied_at')) this.db.exec('ALTER TABLE runtime_event_dedup ADD COLUMN applied_at TEXT');
    if (existingVersion === 0) {
      this.db.prepare("INSERT INTO echo_openclaw_meta(key,value) VALUES ('schema_version','3')").run();
    } else if (existingVersion < 3) {
      this.db.prepare("UPDATE echo_openclaw_meta SET value='3' WHERE key='schema_version'").run();
    }
  }

  close() { this.db.close(); }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE;');
    try { const result = fn(); this.db.exec('COMMIT;'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK;'); } catch {} throw error; }
  }

  bindViewer({ echoSessionId, ownerPrincipalId, viewerAgentId, viewerSessionKey, coreViewerSessionId }) {
    const now = nowIso();
    const existing = this.getBinding(echoSessionId);
    if (existing) {
      if (existing.owner_principal_id !== ownerPrincipalId || existing.viewer_agent_id !== viewerAgentId || existing.viewer_session_key !== viewerSessionKey || existing.core_viewer_session_id !== coreViewerSessionId) {
        throw new EchoError('VIEWER_BINDING_MISMATCH', 'existing OpenClaw Viewer binding differs from requested binding');
      }
      return existing;
    }
    this.db.prepare(`INSERT INTO viewer_bindings(
      echo_session_id,owner_principal_id,viewer_agent_id,viewer_session_key,core_viewer_session_id,
      host_session_id,lifecycle_revision,current_attempt_id,current_run_id,current_step_instance_id,created_at,updated_at
    ) VALUES (?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,?)`).run(
      echoSessionId, ownerPrincipalId, viewerAgentId, viewerSessionKey, coreViewerSessionId, now, now,
    );
    return this.getBinding(echoSessionId);
  }

  getBinding(echoSessionId) {
    return this.db.prepare('SELECT * FROM viewer_bindings WHERE echo_session_id=?').get(echoSessionId) ?? null;
  }
  getBindingBySessionKey(sessionKey) {
    return this.db.prepare('SELECT * FROM viewer_bindings WHERE viewer_session_key=?').get(sessionKey) ?? null;
  }
  getBindingByRunId(runId) {
    return this.db.prepare('SELECT * FROM viewer_bindings WHERE current_run_id=?').get(runId) ?? null;
  }

  setGeneration(echoSessionId, { hostSessionId, lifecycleRevision }) {
    const row = this.getBinding(echoSessionId);
    if (!row) throw new EchoError('VIEWER_BINDING_NOT_FOUND', 'OpenClaw Viewer binding missing');
    this.db.prepare('UPDATE viewer_bindings SET host_session_id=?, lifecycle_revision=?, updated_at=? WHERE echo_session_id=?')
      .run(hostSessionId ?? null, Number.isInteger(lifecycleRevision) ? lifecycleRevision : null, nowIso(), echoSessionId);
    return this.getBinding(echoSessionId);
  }

  setActiveAttempt(echoSessionId, { attemptId, stepInstanceId, runId = null }) {
    const row = this.getBinding(echoSessionId);
    if (!row) throw new EchoError('VIEWER_BINDING_NOT_FOUND', 'OpenClaw Viewer binding missing');
    this.db.prepare('UPDATE viewer_bindings SET current_attempt_id=?, current_step_instance_id=?, current_run_id=?, updated_at=? WHERE echo_session_id=?')
      .run(attemptId, stepInstanceId, runId, nowIso(), echoSessionId);
    return this.getBinding(echoSessionId);
  }

  setRunId(echoSessionId, runId) {
    this.db.prepare('UPDATE viewer_bindings SET current_run_id=?, updated_at=? WHERE echo_session_id=?').run(runId, nowIso(), echoSessionId);
  }

  clearActiveAttempt(echoSessionId, attemptId) {
    const row = this.getBinding(echoSessionId);
    if (!row || (attemptId && row.current_attempt_id !== attemptId)) return false;
    this.db.prepare('UPDATE viewer_bindings SET current_attempt_id=NULL,current_run_id=NULL,current_step_instance_id=NULL,updated_at=? WHERE echo_session_id=?')
      .run(nowIso(), echoSessionId);
    return true;
  }

  nextPhysicalOrdinal(attemptId) {
    const row = this.db.prepare('SELECT MAX(physical_ordinal) AS n FROM transport_links WHERE attempt_id=?').get(attemptId);
    return Number(row?.n ?? 0) + 1;
  }

  insertTransportLink({ transportAttemptId, echoSessionId, attemptId, runId = null, sessionKey, physicalOrdinal, providerId, requestSha256, status = 'DISPATCHED' }) {
    const now = nowIso();
    this.db.prepare(`INSERT INTO transport_links(
      transport_attempt_id,echo_session_id,attempt_id,run_id,session_key,physical_ordinal,call_id,status,provider_id,request_sha256,upstream_request_id_hash,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,NULL,?,?,?,NULL,?,?)`).run(
      transportAttemptId, echoSessionId, attemptId, runId, sessionKey, physicalOrdinal, status, providerId, requestSha256, now, now,
    );
    return this.getTransportLink(transportAttemptId);
  }

  getTransportLink(transportAttemptId) {
    return this.db.prepare('SELECT * FROM transport_links WHERE transport_attempt_id=?').get(transportAttemptId) ?? null;
  }

  latestOpenTransport({ sessionKey, attemptId }) {
    return this.db.prepare(`SELECT * FROM transport_links WHERE session_key=? AND attempt_id=? AND status='DISPATCHED' ORDER BY physical_ordinal DESC LIMIT 1`)
      .get(sessionKey, attemptId) ?? null;
  }

  latestCompletedTransport(attemptId) {
    return this.db.prepare(`SELECT * FROM transport_links WHERE attempt_id=? AND status='COMPLETED' ORDER BY physical_ordinal DESC LIMIT 1`).get(attemptId) ?? null;
  }

  latestOpenTransportByRun(runId) {
    return this.db.prepare(`SELECT * FROM transport_links WHERE run_id=? AND status='DISPATCHED' ORDER BY physical_ordinal DESC LIMIT 1`).get(runId) ?? null;
  }

  attachRunToLatest(sessionKey, attemptId, runId) {
    const row = this.db.prepare(`SELECT transport_attempt_id FROM transport_links WHERE session_key=? AND attempt_id=? AND run_id IS NULL ORDER BY physical_ordinal DESC LIMIT 1`).get(sessionKey, attemptId);
    if (row) this.db.prepare('UPDATE transport_links SET run_id=?,updated_at=? WHERE transport_attempt_id=?').run(runId, nowIso(), row.transport_attempt_id);
  }

  attachCall(runId, callId) {
    const row = this.db.prepare(`SELECT transport_attempt_id FROM transport_links WHERE run_id=? AND status='DISPATCHED' AND call_id IS NULL ORDER BY physical_ordinal DESC LIMIT 1`).get(runId);
    if (!row) return null;
    this.db.prepare('UPDATE transport_links SET call_id=?,updated_at=? WHERE transport_attempt_id=?').run(callId ?? null, nowIso(), row.transport_attempt_id);
    return this.getTransportLink(row.transport_attempt_id);
  }

  transportForCall(runId, callId) {
    if (callId) {
      return this.db.prepare('SELECT * FROM transport_links WHERE run_id=? AND call_id=? ORDER BY physical_ordinal DESC LIMIT 1').get(runId, callId) ?? null;
    }
    const rows = this.db.prepare(`SELECT * FROM transport_links WHERE run_id=? AND status='DISPATCHED' ORDER BY physical_ordinal DESC`).all(runId);
    if (rows.length !== 1 || rows[0].call_id) return null;
    return rows[0];
  }

  openTransportsByRun(runId) {
    return this.db.prepare(`SELECT * FROM transport_links WHERE run_id=? AND status='DISPATCHED' ORDER BY physical_ordinal`).all(runId);
  }

  setRecoveryRequired(echoSessionId, recoveryContext) {
    const now = nowIso();
    const row = this.db.prepare('SELECT recovery_revision FROM viewer_recovery WHERE echo_session_id=?').get(echoSessionId);
    const rev = Number(row?.recovery_revision ?? 0) + 1;
    this.db.prepare(`INSERT INTO viewer_recovery(
      echo_session_id,recovery_revision,recovery_context_json,recovery_required,resume_status,resume_operation_id,planned_session_key,updated_at
    ) VALUES (?,?,?,?,'NONE',NULL,NULL,?)
      ON CONFLICT(echo_session_id) DO UPDATE SET
        recovery_revision=excluded.recovery_revision,
        recovery_context_json=excluded.recovery_context_json,
        recovery_required=1,
        resume_status='NONE',resume_operation_id=NULL,planned_session_key=NULL,updated_at=excluded.updated_at`)
      .run(echoSessionId, rev, JSON.stringify(recoveryContext ?? {}), 1, now);
    return this.getRecovery(echoSessionId);
  }

  getRecovery(echoSessionId) {
    const row = this.db.prepare('SELECT * FROM viewer_recovery WHERE echo_session_id=?').get(echoSessionId);
    if (!row) return null;
    return { ...row, recovery_context: row.recovery_context_json ? JSON.parse(row.recovery_context_json) : null };
  }

  beginRecoveryResume(echoSessionId, newSessionKey) {
    const recovery = this.getRecovery(echoSessionId);
    if (!recovery || !recovery.recovery_required) throw new EchoError('RECOVERY_NOT_REQUIRED', 'Viewer recovery is not pending');
    const operationId = recovery.resume_operation_id ?? `resume:${echoSessionId}:${recovery.recovery_revision}`;
    const plannedKey = recovery.planned_session_key ?? newSessionKey;
    if (recovery.planned_session_key && recovery.planned_session_key !== newSessionKey) {
      throw new EchoError('RECOVERY_KEY_MISMATCH', 'recovery already planned with a different Viewer session key');
    }
    this.db.prepare(`UPDATE viewer_recovery SET resume_status=CASE WHEN resume_status IN ('CORE_APPLIED','COMPLETE') THEN resume_status ELSE 'PENDING' END,
      resume_operation_id=?,planned_session_key=?,updated_at=? WHERE echo_session_id=?`)
      .run(operationId, plannedKey, nowIso(), echoSessionId);
    return this.getRecovery(echoSessionId);
  }

  markRecoveryCoreApplied(echoSessionId, operationId) {
    const recovery = this.getRecovery(echoSessionId);
    if (!recovery || recovery.resume_operation_id !== operationId) throw new EchoError('RECOVERY_OPERATION_MISMATCH', 'unknown Viewer recovery operation');
    if (recovery.resume_status === 'COMPLETE') return recovery;
    this.db.prepare("UPDATE viewer_recovery SET resume_status='CORE_APPLIED',updated_at=? WHERE echo_session_id=?")
      .run(nowIso(), echoSessionId);
    return this.getRecovery(echoSessionId);
  }

  finalizeRecovery(echoSessionId, operationId) {
    const recovery = this.getRecovery(echoSessionId);
    if (!recovery || recovery.resume_operation_id !== operationId) throw new EchoError('RECOVERY_OPERATION_MISMATCH', 'unknown Viewer recovery operation');
    if (!['CORE_APPLIED','COMPLETE'].includes(recovery.resume_status)) throw new EchoError('RECOVERY_CORE_NOT_APPLIED', 'Session Core Resume has not been durably observed');
    const binding = this.getBinding(echoSessionId);
    if (!binding) throw new EchoError('VIEWER_BINDING_NOT_FOUND', 'OpenClaw Viewer binding missing');
    if (recovery.resume_status === 'COMPLETE') return binding;
    this.transaction(() => {
      this.db.prepare('UPDATE viewer_bindings SET viewer_session_key=?,host_session_id=NULL,lifecycle_revision=NULL,current_attempt_id=NULL,current_run_id=NULL,current_step_instance_id=NULL,updated_at=? WHERE echo_session_id=?')
        .run(recovery.planned_session_key, nowIso(), echoSessionId);
      this.db.prepare("UPDATE viewer_recovery SET recovery_required=0,resume_status='COMPLETE',updated_at=? WHERE echo_session_id=?")
        .run(nowIso(), echoSessionId);
    });
    return this.getBinding(echoSessionId);
  }

  clearRecoveryContext(echoSessionId) {
    this.db.prepare("UPDATE viewer_recovery SET recovery_context_json=NULL,resume_status='NONE',resume_operation_id=NULL,planned_session_key=NULL,updated_at=? WHERE echo_session_id=?")
      .run(nowIso(), echoSessionId);
  }

  beginRuntimeEvent(eventId, eventType, echoSessionId) {
    const existing = this.getRuntimeEvent(eventId);
    if (existing) {
      if (existing.event_type !== eventType || existing.echo_session_id !== echoSessionId) {
        throw new EchoError('RUNTIME_EVENT_ID_COLLISION', 'runtime event id is already bound to different event metadata');
      }
      return existing;
    }
    this.db.prepare(`INSERT INTO runtime_event_dedup(event_id,event_type,echo_session_id,status,recorded_at,applied_at)
      VALUES (?,?,?,'PENDING',?,NULL)`).run(eventId, eventType, echoSessionId, nowIso());
    return this.getRuntimeEvent(eventId);
  }

  getRuntimeEvent(eventId) {
    return this.db.prepare('SELECT * FROM runtime_event_dedup WHERE event_id=?').get(eventId) ?? null;
  }

  pendingRuntimeEvent(eventType, echoSessionId) {
    return this.db.prepare("SELECT * FROM runtime_event_dedup WHERE event_type=? AND echo_session_id=? AND status='PENDING' ORDER BY recorded_at,event_id LIMIT 1")
      .get(eventType, echoSessionId) ?? null;
  }

  completeViewerContextLossEvent({ eventId, echoSessionId, recoveryContext, currentAttemptId = null }) {
    const event = this.getRuntimeEvent(eventId);
    if (!event) throw new EchoError('RUNTIME_EVENT_NOT_FOUND', 'runtime event must be begun before it can be applied');
    if (event.echo_session_id !== echoSessionId || event.event_type !== 'VIEWER_CONTEXT_LOST') throw new EchoError('RUNTIME_EVENT_MISMATCH', 'runtime event metadata mismatch');
    if (event.status === 'APPLIED') return event;
    this.transaction(() => {
      const now = nowIso();
      const row = this.db.prepare('SELECT recovery_revision FROM viewer_recovery WHERE echo_session_id=?').get(echoSessionId);
      const rev = Number(row?.recovery_revision ?? 0) + 1;
      this.db.prepare(`INSERT INTO viewer_recovery(
        echo_session_id,recovery_revision,recovery_context_json,recovery_required,resume_status,resume_operation_id,planned_session_key,updated_at
      ) VALUES (?,?,?,?,'NONE',NULL,NULL,?)
        ON CONFLICT(echo_session_id) DO UPDATE SET
          recovery_revision=excluded.recovery_revision,recovery_context_json=excluded.recovery_context_json,recovery_required=1,
          resume_status='NONE',resume_operation_id=NULL,planned_session_key=NULL,updated_at=excluded.updated_at`)
        .run(echoSessionId, rev, JSON.stringify(recoveryContext ?? {}), 1, now);
      const binding = this.getBinding(echoSessionId);
      if (binding && (!currentAttemptId || binding.current_attempt_id === currentAttemptId)) {
        this.db.prepare('UPDATE viewer_bindings SET current_attempt_id=NULL,current_run_id=NULL,current_step_instance_id=NULL,updated_at=? WHERE echo_session_id=?')
          .run(now, echoSessionId);
      }
      this.db.prepare("UPDATE runtime_event_dedup SET status='APPLIED',applied_at=? WHERE event_id=?").run(now, eventId);
    });
    return this.getRuntimeEvent(eventId);
  }

  finishTransportLink(transportAttemptId, { status, upstreamRequestIdHash = null }) {
    this.db.prepare('UPDATE transport_links SET status=?,upstream_request_id_hash=?,updated_at=? WHERE transport_attempt_id=?')
      .run(status, upstreamRequestIdHash, nowIso(), transportAttemptId);
    return this.getTransportLink(transportAttemptId);
  }

}
