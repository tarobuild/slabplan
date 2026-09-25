-- Custom phase creation previously omitted the tenant key. Recover only
-- unscoped phases from their owning job; never reassign an existing tenant.
UPDATE schedule_phases AS phase
SET organization_id = job.organization_id,
    updated_at = NOW()
FROM jobs AS job
WHERE phase.job_id = job.id
  AND phase.organization_id IS NULL
  AND job.organization_id IS NOT NULL;
