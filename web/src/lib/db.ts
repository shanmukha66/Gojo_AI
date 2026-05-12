import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.APP_DB_PATH || path.join(process.cwd(), "data", "app.db");

let db: Database.Database | null = null;

function hasColumn(database: Database.Database, table: string, column: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        theme TEXT NOT NULL DEFAULT 'dark',
        chart_density TEXT NOT NULL DEFAULT 'comfortable',
        show_risk_panels INTEGER NOT NULL DEFAULT 1,
        voice_input_enabled INTEGER NOT NULL DEFAULT 0,
        doctor_copilot_mode TEXT NOT NULL DEFAULT 'assist',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS patient_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        status TEXT NOT NULL,
        extraction_error TEXT,
        storage_path TEXT NOT NULL,
        extracted_text TEXT,
        report_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES patient_documents(id)
      );
      CREATE TABLE IF NOT EXISTS lab_observations (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        test_name TEXT NOT NULL,
        value_text TEXT,
        numeric_value REAL,
        unit TEXT,
        reference_range TEXT,
        abnormal_flag TEXT,
        observed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES patient_documents(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS patient_record_links (
        user_id TEXT PRIMARY KEY,
        patient_record_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS doctor_memos (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS patient_memos (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS doctor_availability (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        weekday INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        slot_minutes INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        patient_user_id TEXT,
        patient_record_id TEXT,
        slot_start TEXT NOT NULL,
        slot_end TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by_role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id),
        FOREIGN KEY (patient_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS doctor_profiles (
        user_id TEXT PRIMARY KEY,
        specialty TEXT,
        license_number TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS doctor_patient_assignments (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        patient_user_id TEXT,
        patient_record_id TEXT NOT NULL,
        source TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        released_at TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        FOREIGN KEY (doctor_id) REFERENCES users(id),
        FOREIGN KEY (patient_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS patient_reviews (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        patient_user_id TEXT,
        patient_record_id TEXT NOT NULL,
        visit_id TEXT,
        appointment_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        assessment TEXT,
        plan TEXT,
        follow_up TEXT,
        revisit_recommended INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id),
        FOREIGN KEY (patient_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS visits (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        patient_user_id TEXT,
        patient_record_id TEXT NOT NULL,
        appointment_id TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id),
        FOREIGN KEY (patient_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS visit_events (
        id TEXT PRIMARY KEY,
        visit_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        event_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (visit_id) REFERENCES visits(id)
      );
      CREATE TABLE IF NOT EXISTS appointment_status_history (
        id TEXT PRIMARY KEY,
        appointment_id TEXT NOT NULL,
        previous_status TEXT,
        next_status TEXT NOT NULL,
        changed_by_user_id TEXT,
        change_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id),
        FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_text TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_user_id TEXT,
        FOREIGN KEY (owner_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS ai_audit_logs (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        patient_id TEXT,
        kind TEXT NOT NULL,
        model TEXT NOT NULL,
        fallback INTEGER NOT NULL DEFAULT 0,
        evidence_refs TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS ai_response_cache (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        route_kind TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        usage_json TEXT,
        hits INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        route_kind TEXT NOT NULL,
        cache_hit INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        request_hash TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_rl_events (
        id TEXT PRIMARY KEY,
        actor_role TEXT NOT NULL,
        route_kind TEXT NOT NULL,
        state_key TEXT NOT NULL,
        action_key TEXT NOT NULL,
        reward REAL NOT NULL,
        metrics_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_rl_q_values (
        state_key TEXT NOT NULL,
        action_key TEXT NOT NULL,
        q_value REAL NOT NULL DEFAULT 0,
        visits INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (state_key, action_key)
      );
      CREATE TABLE IF NOT EXISTS ground_truth_memories (
        id TEXT PRIMARY KEY,
        actor_role TEXT NOT NULL,
        route_kind TEXT NOT NULL,
        scope_key TEXT,
        question TEXT NOT NULL,
        normalized_question TEXT NOT NULL,
        answer TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        relevance_score REAL NOT NULL DEFAULT 1,
        caution TEXT,
        source_mode TEXT,
        model TEXT,
        fallback INTEGER NOT NULL DEFAULT 0,
        reuse_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ground_truth_relevance_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT,
        actor_role TEXT NOT NULL,
        route_kind TEXT NOT NULL,
        scope_key TEXT,
        question TEXT NOT NULL,
        relevance_score REAL NOT NULL,
        reused INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES ground_truth_memories(id)
      );
      CREATE TABLE IF NOT EXISTS doctor_copilot_chats (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (doctor_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS ground_truth_sources (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        specialty TEXT,
        tags TEXT,
        content TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS ai_feedback_events (
        id TEXT PRIMARY KEY,
        actor_role TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        route_kind TEXT NOT NULL,
        chat_id TEXT,
        message_id TEXT,
        rating TEXT NOT NULL,
        reason TEXT,
        answer_text TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ground_truth_lookup
        ON ground_truth_memories(actor_role, route_kind, scope_key, normalized_question);
      CREATE INDEX IF NOT EXISTS idx_ground_truth_events
        ON ground_truth_relevance_events(actor_role, route_kind, scope_key, created_at);
      CREATE INDEX IF NOT EXISTS idx_doctor_copilot_chats
        ON doctor_copilot_chats(doctor_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_ground_truth_sources
        ON ground_truth_sources(active, updated_at);
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_events
        ON ai_feedback_events(actor_role, route_kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_events
        ON audit_events(action, created_at);
    `);
    ensureColumn(db, "appointments", "cancellation_reason", "TEXT");
    ensureColumn(db, "appointments", "rescheduled_from_appointment_id", "TEXT");
    ensureColumn(db, "appointments", "revisit_from_visit_id", "TEXT");
    ensureColumn(db, "appointments", "confirmed_at", "TEXT");
    ensureColumn(db, "appointments", "completed_at", "TEXT");
    ensureColumn(db, "appointments", "cancelled_at", "TEXT");
    ensureColumn(db, "appointments", "rescheduled_to_appointment_id", "TEXT");
    ensureColumn(db, "appointments", "visit_id", "TEXT");
    ensureColumn(db, "patient_documents", "extraction_version", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(db, "patient_documents", "parser_version", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(db, "patient_documents", "report_version", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(db, "patient_documents", "interpretation_version", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(db, "patient_reviews", "follow_up", "TEXT");
    ensureColumn(db, "patient_reviews", "revisit_recommended", "INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}

export function getDb() {
  return ensureDb();
}
