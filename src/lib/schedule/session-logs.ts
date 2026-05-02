/**
 * TODO #64 (2.1, 2026-05-02 part5): shared types for the
 * `schedule_past_session_logs` table that replaced the singular
 * `schedule_past_sessions.logs_url` column. Lives outside the
 * `server` directory so client components (memo popover) can import
 * the type without pulling `server-only`.
 */
export type SessionLogSource = "auto" | "manual";

export type SessionLogEntry = {
  id: string;
  url: string;
  source: SessionLogSource;
};
