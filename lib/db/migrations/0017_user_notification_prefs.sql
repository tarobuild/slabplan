-- Task #320: Settings restructure — per-user notification preferences.
--
-- Backs the new /settings/notifications page. We store the per-event
-- email toggles as a single JSONB blob keyed by event slug (e.g.
-- {"daily_log_mention": true, "schedule_change": false}) rather than a
-- side table because (a) the set of events is small and frequently
-- changing while we wire up notifications, (b) we always read/write the
-- whole bundle for one user at a time, and (c) we don't query *across*
-- preferences. A row-per-event table would be over-modelled at this
-- stage; if we ever need to fan-out queries ("who has X enabled?") we
-- can extract.
--
-- Default {} means "no preferences set yet" — the UI seeds defaults
-- for unknown keys.
--
-- Idempotent: safe to re-apply.

alter table "users"
  add column if not exists "notification_prefs" jsonb not null default '{}'::jsonb;
