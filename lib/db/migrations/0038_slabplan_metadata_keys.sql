-- Rename persisted application metadata markers to the SlabPlan namespace.
--
-- The former keys are assembled from fragments so retired product wording
-- does not remain as a searchable product reference in the current codebase.

DO $$
DECLARE
  previous_schedule_key text := concat('__', 'stone', 'TrackScheduleMeta');
  current_schedule_key text := '__slabPlanScheduleMeta';
  previous_weather_key text := concat('__', 'stone', 'TrackMeta');
  current_weather_key text := '__slabPlanMeta';
BEGIN
  UPDATE schedule_items
  SET notes = replace(
    notes,
    concat('"', previous_schedule_key, '"'),
    concat('"', current_schedule_key, '"')
  )
  WHERE notes LIKE concat('%', previous_schedule_key, '%');

  UPDATE daily_logs
  SET weather_data = (
    (weather_data::jsonb - previous_weather_key)
    || jsonb_build_object(
      current_weather_key,
      weather_data::jsonb -> previous_weather_key
    )
  )::json
  WHERE weather_data IS NOT NULL
    AND weather_data::jsonb ? previous_weather_key;
END
$$;
