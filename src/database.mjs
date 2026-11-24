import { DatabaseSync } from 'node:sqlite';
import { ecjSha256, ecjStringify, sha256Text } from './canonical.mjs';
import { EchoError } from './errors.mjs';

const SCHEMA_VERSION = 4;

function parseJson(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  return JSON.parse(v);
}

export class EchoDatabase {
  constructor(path = ':memory:') {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.#migrate();
  }

  close() { this.db.close(); }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS echo_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS targets (
        target_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        kind TEXT NOT NULL,
        exposure_class TEXT NOT NULL CHECK (exposure_class IN ('public','private')),
        source_path TEXT,
        title TEXT,
        has_ascii_feedback INTEGER NOT NULL DEFAULT 0 CHECK (has_ascii_feedback IN (0,1)),
        content TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (target_id, revision)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('manual','training','automation')),
        owner_principal_id TEXT,
        viewer_agent_id TEXT NOT NULL,
        viewer_session_id TEXT,
        protocol_id TEXT NOT NULL,
        protocol_version TEXT NOT NULL,
        protocol_sha256 TEXT NOT NULL,
        execution_overlay_id TEXT NOT NULL,
        execution_overlay_sha256 TEXT NOT NULL,
        language TEXT NOT NULL CHECK (language IN ('pl','en')),
        conductor_mode TEXT NOT NULL CHECK (conductor_mode IN ('ai_monitor','human_user')),
        tasking_mode TEXT NOT NULL CHECK (tasking_mode IN ('neutral_code','no_code')),
        human_blindness TEXT NOT NULL CHECK (human_blindness IN ('BLIND','USER_KNOWN','PARTIALLY_KNOWN')),
        monitor_blindness TEXT NOT NULL CHECK (monitor_blindness IN ('BLIND','DISCLOSED_AFTER_REVEAL')),
        viewer_blindness TEXT NOT NULL CHECK (viewer_blindness IN ('BLIND','KNOWN_TARGET_TRAINING')),
        target_exposure_class TEXT NOT NULL CHECK (target_exposure_class IN ('public','private')),
        target_id TEXT,
        target_revision TEXT,
        target_sha256 TEXT,
        blind_cue TEXT,
        telepathy_tasking_questions_json TEXT NOT NULL DEFAULT '[]',
        target_committed_at TEXT,
        state TEXT NOT NULL CHECK (state IN ('CREATED','TARGET_RESERVED','TARGET_COMMITTED','VIEWER_READY','BLIND_RUNNING','PAUSED','RECOVERING','PAUSED_REQUIRES_DECISION','BLIND_COMPLETE','REVEAL_AUTHORIZED','REVEALING','REVEALED','POST_REVEAL','CANCELLED','FAILED','CLOSED')),
        current_step_id TEXT NOT NULL,
        current_step_instance_id TEXT NOT NULL,
        last_accepted_step_id TEXT,
        last_accepted_step_instance_id TEXT,
        cycle_index INTEGER NOT NULL DEFAULT 0 CHECK (cycle_index >= 0),
        max_extension_cycles INTEGER NOT NULL DEFAULT 0 CHECK (max_extension_cycles >= 0),
        checkpoint_pending INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_pending IN (0,1)),
        pending_transition_event TEXT,
        parent_step_instance_id TEXT,
        blind_completion_reason TEXT,
        pause_reason TEXT,
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        blind_completed_at TEXT,
        reveal_authorized_at TEXT,
        revealed_at TEXT,
        closed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        CHECK ((target_id IS NULL AND target_revision IS NULL AND target_sha256 IS NULL) OR (target_id IS NOT NULL AND target_revision IS NOT NULL AND target_sha256 IS NOT NULL)),
        FOREIGN KEY (target_id, target_revision) REFERENCES targets(target_id, revision)
      ) STRICT;

      CREATE TRIGGER IF NOT EXISTS trg_session_owner_immutable
      BEFORE UPDATE OF owner_principal_id ON sessions
      WHEN NEW.owner_principal_id IS NOT OLD.owner_principal_id
      BEGIN
        SELECT RAISE(ABORT, 'session owner principal is immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_target_commit_identity_immutable
      BEFORE UPDATE OF target_id, target_revision, target_sha256 ON sessions
      WHEN OLD.target_committed_at IS NOT NULL AND (NEW.target_id IS NOT OLD.target_id OR NEW.target_revision IS NOT OLD.target_revision OR NEW.target_sha256 IS NOT OLD.target_sha256)
      BEGIN
        SELECT RAISE(ABORT, 'target commit identity is immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_target_commit_timestamp_immutable
      BEFORE UPDATE OF target_committed_at ON sessions
      WHEN OLD.target_committed_at IS NOT NULL AND NEW.target_committed_at IS NOT OLD.target_committed_at
      BEGIN
        SELECT RAISE(ABORT, 'target commit timestamp is immutable');
      END;

      CREATE TABLE IF NOT EXISTS attempts (
        attempt_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        step_instance_id TEXT NOT NULL,
        viewer_session_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('CREATED','DISPATCHED','COMPLETED','FAILED','REJECTED','ACCEPTED','SUPERSEDED')),
        retry_of TEXT REFERENCES attempts(attempt_id),
        logical_ordinal INTEGER NOT NULL CHECK (logical_ordinal >= 1),
        request_started_at TEXT NOT NULL,
        response_received_at TEXT,
        accepted_at TEXT,
        result_text TEXT,
        result_sha256 TEXT,
        validation_json TEXT,
        provider_request_id TEXT,
        response_transport_attempt_id TEXT REFERENCES transport_receipts(transport_attempt_id),
        UNIQUE (session_id, step_instance_id, logical_ordinal)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS transport_receipts (
        transport_attempt_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
        physical_ordinal INTEGER NOT NULL CHECK (physical_ordinal >= 1),
        provider_id TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('AUTHORIZED','DISPATCHED','COMPLETED','FAILED','UNKNOWN')),
        authorized_at TEXT NOT NULL,
        dispatched_at TEXT,
        completed_at TEXT,
        provider_request_id TEXT,
        error_text TEXT,
        UNIQUE (attempt_id, physical_ordinal)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS step_results (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        step_instance_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        cycle_index INTEGER NOT NULL,
        attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
        result_text TEXT NOT NULL,
        result_sha256 TEXT NOT NULL,
        validator_id TEXT NOT NULL,
        validation_sha256 TEXT NOT NULL,
        transport_attempt_id TEXT NOT NULL REFERENCES transport_receipts(transport_attempt_id),
        accepted_at TEXT NOT NULL,
        PRIMARY KEY (session_id, step_instance_id),
        UNIQUE (attempt_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS reveal_authorizations (
        authorization_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_revision TEXT NOT NULL,
        target_sha256 TEXT NOT NULL,
        authorized_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('AUTHORIZED','CONSUMED')),
        UNIQUE (session_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS reveals (
        reveal_operation_id TEXT PRIMARY KEY,
        authorization_id TEXT NOT NULL REFERENCES reveal_authorizations(authorization_id),
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_revision TEXT NOT NULL,
        target_sha256 TEXT NOT NULL,
        reveal_payload_json TEXT NOT NULL,
        revealed_at TEXT NOT NULL,
        UNIQUE (session_id),
        UNIQUE (session_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS target_exposures (
        target_id TEXT NOT NULL,
        viewer_agent_id TEXT NOT NULL,
        first_used_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        revealed_to_viewer INTEGER NOT NULL DEFAULT 0 CHECK (revealed_to_viewer IN (0,1)),
        reveal_count INTEGER NOT NULL DEFAULT 0,
        last_session_id TEXT,
        eligibility TEXT NOT NULL CHECK (eligibility IN ('BLIND_ELIGIBLE','KNOWN_TO_VIEWER','TRAINING_ONLY','RETIRED')),
        PRIMARY KEY (target_id, viewer_agent_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS adjuncts (
        adjunct_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        step_instance_id TEXT NOT NULL,
        instruction_text TEXT NOT NULL,
        instruction_sha256 TEXT NOT NULL,
        issued_by TEXT NOT NULL,
        neutrality_verifier_id TEXT NOT NULL,
        neutrality_status TEXT NOT NULL CHECK (neutrality_status = 'NEUTRAL'),
        frozen_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS audit_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        event_type TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        actor_agent_id TEXT,
        payload_json TEXT NOT NULL,
        previous_hash TEXT,
        event_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id, event_id);
      CREATE INDEX IF NOT EXISTS idx_attempt_session ON attempts(session_id, step_instance_id);
      CREATE INDEX IF NOT EXISTS idx_transport_attempt ON transport_receipts(attempt_id, physical_ordinal);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_target_per_viewer
        ON sessions(viewer_agent_id, target_id)
        WHERE target_id IS NOT NULL AND state NOT IN ('CANCELLED','FAILED','REVEALED','POST_REVEAL','CLOSED');
    `);
    const row = this.db.prepare('SELECT value FROM echo_meta WHERE key = ?').get('schema_version');
    if (!row) {
      this.db.prepare('INSERT INTO echo_meta(key,value) VALUES (?,?)').run('schema_version', String(SCHEMA_VERSION));
    } else if (Number(row.value) === 3) {
      const columns = this.db.prepare("PRAGMA table_info('sessions')").all().map((x) => x.name);
      if (!columns.includes('owner_principal_id')) this.db.exec('ALTER TABLE sessions ADD COLUMN owner_principal_id TEXT;');
      this.db.prepare('UPDATE echo_meta SET value=? WHERE key=?').run(String(SCHEMA_VERSION), 'schema_version');
    } else if (Number(row.value) !== SCHEMA_VERSION) {
      throw new EchoError('SCHEMA_VERSION_MISMATCH', `expected ${SCHEMA_VERSION}, found ${row.value}`);
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  importTarget(target, now) {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM targets WHERE target_id=? AND revision=?').get(target.target_id, target.revision);
      if (existing) {
        if (existing.sha256 !== target.sha256 || existing.content !== target.content) {
          throw new EchoError('TARGET_REVISION_COLLISION', `target ${target.target_id}@${target.revision} already exists with different bytes`);
        }
        return { imported: false, target: this.#targetRow(existing) };
      }
      this.db.prepare(`INSERT INTO targets(target_id,revision,sha256,kind,exposure_class,source_path,title,has_ascii_feedback,content,imported_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(target.target_id, target.revision, target.sha256, target.kind, target.exposure_class, target.source_path ?? null, target.title ?? null, target.has_ascii_feedback ? 1 : 0, target.content, now);
      return { imported: true, target: { ...target } };
    });
  }

  #targetRow(row) {
    return { ...row, has_ascii_feedback: Boolean(row.has_ascii_feedback) };
  }

  getTarget(targetId, revision) {
    const row = this.db.prepare('SELECT * FROM targets WHERE target_id=? AND revision=?').get(targetId, revision);
    return row ? this.#targetRow(row) : null;
  }

  listTargets({ exposureClass = null } = {}) {
    const rows = exposureClass
      ? this.db.prepare('SELECT * FROM targets WHERE exposure_class=? ORDER BY target_id, revision').all(exposureClass)
      : this.db.prepare('SELECT * FROM targets ORDER BY target_id, revision').all();
    return rows.map((r) => this.#targetRow(r));
  }

  activeTargetIdsForViewer(viewerAgentId, excludingSessionId = null) {
    const sql = excludingSessionId
      ? `SELECT DISTINCT target_id FROM sessions WHERE viewer_agent_id=? AND session_id<>? AND target_id IS NOT NULL
         AND state NOT IN ('CANCELLED','FAILED','REVEALED','POST_REVEAL','CLOSED')`
      : `SELECT DISTINCT target_id FROM sessions WHERE viewer_agent_id=? AND target_id IS NOT NULL
         AND state NOT IN ('CANCELLED','FAILED','REVEALED','POST_REVEAL','CLOSED')`;
    const rows = excludingSessionId
      ? this.db.prepare(sql).all(viewerAgentId, excludingSessionId)
      : this.db.prepare(sql).all(viewerAgentId);
    return rows.map((r) => r.target_id);
  }

  getExposure(targetId, viewerAgentId) {
    const row = this.db.prepare('SELECT * FROM target_exposures WHERE target_id=? AND viewer_agent_id=?').get(targetId, viewerAgentId);
    return row ? { ...row, revealed_to_viewer: Boolean(row.revealed_to_viewer) } : null;
  }

  upsertExposureUse(targetId, viewerAgentId, sessionId, now) {
    const existing = this.getExposure(targetId, viewerAgentId);
    if (!existing) {
      this.db.prepare(`INSERT INTO target_exposures(target_id,viewer_agent_id,first_used_at,last_used_at,use_count,revealed_to_viewer,reveal_count,last_session_id,eligibility)
        VALUES (?,?,?,?,1,0,0,?,'BLIND_ELIGIBLE')`).run(targetId, viewerAgentId, now, now, sessionId);
    } else {
      this.db.prepare('UPDATE target_exposures SET last_used_at=?, use_count=use_count+1, last_session_id=? WHERE target_id=? AND viewer_agent_id=?')
        .run(now, sessionId, targetId, viewerAgentId);
    }
  }

  markExposureRevealed(targetId, viewerAgentId, sessionId, now) {
    const existing = this.getExposure(targetId, viewerAgentId);
    if (!existing) {
      this.db.prepare(`INSERT INTO target_exposures(target_id,viewer_agent_id,first_used_at,last_used_at,use_count,revealed_to_viewer,reveal_count,last_session_id,eligibility)
        VALUES (?,?,?,?,1,1,1,?,'KNOWN_TO_VIEWER')`).run(targetId, viewerAgentId, now, now, sessionId);
    } else {
      this.db.prepare(`UPDATE target_exposures SET last_used_at=?, revealed_to_viewer=1, reveal_count=reveal_count+1,
        last_session_id=?, eligibility='KNOWN_TO_VIEWER' WHERE target_id=? AND viewer_agent_id=?`).run(now, sessionId, targetId, viewerAgentId);
    }
  }

  insertSession(row) {
    const keys = Object.keys(row);
    const sql = `INSERT INTO sessions(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    this.db.prepare(sql).run(...keys.map((k) => row[k]));
  }

  getSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE session_id=?').get(sessionId);
    if (!row) return null;
    return { ...row, checkpoint_pending: Boolean(row.checkpoint_pending) };
  }

  updateSession(sessionId, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return this.getSession(sessionId);
    const sql = `UPDATE sessions SET ${keys.map((k) => `${k}=?`).join(',')} WHERE session_id=?`;
    const result = this.db.prepare(sql).run(...keys.map((k) => patch[k]), sessionId);
    if (Number(result.changes) !== 1) throw new EchoError('SESSION_NOT_FOUND', `session ${sessionId} not found`);
    return this.getSession(sessionId);
  }

  insertAttempt(row) {
    const keys = Object.keys(row);
    this.db.prepare(`INSERT INTO attempts(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  }

  getAttempt(attemptId) { return this.db.prepare('SELECT * FROM attempts WHERE attempt_id=?').get(attemptId) ?? null; }
  updateAttempt(attemptId, patch) {
    const keys = Object.keys(patch);
    const result = this.db.prepare(`UPDATE attempts SET ${keys.map((k) => `${k}=?`).join(',')} WHERE attempt_id=?`).run(...keys.map((k) => patch[k]), attemptId);
    if (Number(result.changes) !== 1) throw new EchoError('ATTEMPT_NOT_FOUND', `attempt ${attemptId} not found`);
    return this.getAttempt(attemptId);
  }
  attemptsForStep(sessionId, stepInstanceId) { return this.db.prepare('SELECT * FROM attempts WHERE session_id=? AND step_instance_id=? ORDER BY logical_ordinal').all(sessionId, stepInstanceId); }
  openAttemptsForSession(sessionId) {
    return this.db.prepare("SELECT * FROM attempts WHERE session_id=? AND status IN ('CREATED','DISPATCHED') ORDER BY request_started_at, attempt_id").all(sessionId);
  }
  countOpenAttempts(sessionId) {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE session_id=? AND status IN ('CREATED','DISPATCHED')").get(sessionId);
    return Number(row.n);
  }

  insertTransport(row) {
    const keys = Object.keys(row);
    this.db.prepare(`INSERT INTO transport_receipts(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  }
  getTransport(id) { return this.db.prepare('SELECT * FROM transport_receipts WHERE transport_attempt_id=?').get(id) ?? null; }
  updateTransport(id, patch) {
    const keys = Object.keys(patch);
    const result = this.db.prepare(`UPDATE transport_receipts SET ${keys.map((k) => `${k}=?`).join(',')} WHERE transport_attempt_id=?`).run(...keys.map((k) => patch[k]), id);
    if (Number(result.changes) !== 1) throw new EchoError('TRANSPORT_NOT_FOUND', `transport ${id} not found`);
    return this.getTransport(id);
  }
  transportsForAttempt(attemptId) { return this.db.prepare('SELECT * FROM transport_receipts WHERE attempt_id=? ORDER BY physical_ordinal').all(attemptId); }
  openTransportsForAttempt(attemptId) {
    return this.db.prepare("SELECT * FROM transport_receipts WHERE attempt_id=? AND status IN ('AUTHORIZED','DISPATCHED') ORDER BY physical_ordinal").all(attemptId);
  }

  insertStepResult(row) {
    const keys = Object.keys(row);
    this.db.prepare(`INSERT INTO step_results(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  }
  getStepResult(sessionId, stepInstanceId) { return this.db.prepare('SELECT * FROM step_results WHERE session_id=? AND step_instance_id=?').get(sessionId, stepInstanceId) ?? null; }
  listStepResults(sessionId) { return this.db.prepare('SELECT * FROM step_results WHERE session_id=? ORDER BY accepted_at, step_instance_id').all(sessionId); }

  insertRevealAuthorization(row) {
    const keys = Object.keys(row);
    this.db.prepare(`INSERT INTO reveal_authorizations(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  }
  getRevealAuthorization(id) { return this.db.prepare('SELECT * FROM reveal_authorizations WHERE authorization_id=?').get(id) ?? null; }
  getRevealAuthorizationByKey(sessionId, key) { return this.db.prepare('SELECT * FROM reveal_authorizations WHERE session_id=? AND idempotency_key=?').get(sessionId, key) ?? null; }
  getRevealAuthorizationBySession(sessionId) { return this.db.prepare('SELECT * FROM reveal_authorizations WHERE session_id=? ORDER BY authorized_at, authorization_id LIMIT 1').get(sessionId) ?? null; }
  updateRevealAuthorization(id, patch) {
    const keys = Object.keys(patch);
    this.db.prepare(`UPDATE reveal_authorizations SET ${keys.map((k) => `${k}=?`).join(',')} WHERE authorization_id=?`).run(...keys.map((k) => patch[k]), id);
  }

  insertReveal(row) {
    const keys = Object.keys(row);
    this.db.prepare(`INSERT INTO reveals(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  }
  getRevealBySession(sessionId) { const r = this.db.prepare('SELECT * FROM reveals WHERE session_id=?').get(sessionId); return r ? { ...r, reveal_payload: parseJson(r.reveal_payload_json) } : null; }
  getRevealByKey(sessionId, key) { const r = this.db.prepare('SELECT * FROM reveals WHERE session_id=? AND idempotency_key=?').get(sessionId, key); return r ? { ...r, reveal_payload: parseJson(r.reveal_payload_json) } : null; }

  insertAdjunct(row) {
    const keys = Object.keys(row);
    this.db.prepare(`INSERT INTO adjuncts(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  }
  listAdjuncts(sessionId) { return this.db.prepare('SELECT * FROM adjuncts WHERE session_id=? ORDER BY frozen_at, adjunct_id').all(sessionId); }

  appendAudit(sessionId, eventType, payload, actor, now) {
    const last = this.db.prepare('SELECT event_hash FROM audit_events WHERE session_id IS ? ORDER BY event_id DESC LIMIT 1').get(sessionId ?? null);
    const previousHash = last?.event_hash ?? null;
    const payloadJson = ecjStringify(payload);
    const base = { session_id: sessionId ?? null, event_type: eventType, actor_role: actor.role, actor_agent_id: actor.agentId ?? null, payload, previous_hash: previousHash, created_at: now };
    const eventHash = sha256Text(`${previousHash ?? ''}\n${ecjStringify(base)}`);
    this.db.prepare(`INSERT INTO audit_events(session_id,event_type,actor_role,actor_agent_id,payload_json,previous_hash,event_hash,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(sessionId ?? null, eventType, actor.role, actor.agentId ?? null, payloadJson, previousHash, eventHash, now);
    return eventHash;
  }

  listAudit(sessionId) {
    return this.db.prepare('SELECT * FROM audit_events WHERE session_id IS ? ORDER BY event_id').all(sessionId ?? null).map((r) => ({ ...r, payload: parseJson(r.payload_json) }));
  }

  verifyAudit(sessionId) {
    let previousHash = null;
    for (const row of this.listAudit(sessionId)) {
      if (row.previous_hash !== previousHash) return { ok: false, event_id: row.event_id, reason: 'previous_hash mismatch' };
      const base = { session_id: row.session_id, event_type: row.event_type, actor_role: row.actor_role, actor_agent_id: row.actor_agent_id, payload: row.payload, previous_hash: row.previous_hash, created_at: row.created_at };
      const computed = sha256Text(`${previousHash ?? ''}\n${ecjStringify(base)}`);
      if (computed !== row.event_hash) return { ok: false, event_id: row.event_id, reason: 'event_hash mismatch' };
      previousHash = row.event_hash;
    }
    return { ok: true, final_hash: previousHash };
  }

  rawDbForAuditTests() { return this.db; }
}
