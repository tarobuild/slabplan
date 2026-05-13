-- Task: Project managers use the same field-user defaults as crew.
--
-- Admins can still grant documents, financials, or assistant access per job.
-- Keep photos, videos, daily logs, and schedule visible by default.

UPDATE "job_assignees" ja
   SET "can_view_financials" = false,
       "can_view_documents" = false,
       "can_use_assistant" = false
  FROM "users" u
 WHERE u."id" = ja."user_id"
   AND u."role" = 'project_manager';
