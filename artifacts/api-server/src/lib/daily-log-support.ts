import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let ensureDailyLogConfigTablesPromise: Promise<void> | null = null;

export async function ensureDailyLogConfigTables() {
  if (!ensureDailyLogConfigTablesPromise) {
    ensureDailyLogConfigTablesPromise = (async () => {
      await db.execute(sql`
        alter table daily_logs
        add column if not exists custom_field_values json
      `);
      await db.execute(sql`
        create table if not exists daily_log_settings (
          id uuid primary key,
          stamp_location boolean default false,
          default_notes text default '',
          include_weather_by_default boolean default true,
          include_weather_notes_by_default boolean default false,
          share_internal_users_by_default boolean default true,
          notify_internal_users_by_default boolean default false,
          share_estimators_by_default boolean default false,
          notify_estimators_by_default boolean default false,
          share_installers_by_default boolean default false,
          notify_installers_by_default boolean default false,
          created_at timestamp not null default now(),
          updated_at timestamp not null default now()
        )
      `);
      await db.execute(sql`
        create table if not exists daily_log_custom_fields (
          id uuid primary key,
          name varchar(100) not null,
          field_type varchar(50) not null,
          options json,
          display_order integer not null default 0,
          created_at timestamp not null default now(),
          updated_at timestamp not null default now()
        )
      `);
      await db.execute(sql`
        create unique index if not exists daily_log_custom_fields_name_unique
        on daily_log_custom_fields (name)
      `);
    })().catch((error) => {
      ensureDailyLogConfigTablesPromise = null;
      throw error;
    });
  }

  await ensureDailyLogConfigTablesPromise;
}
