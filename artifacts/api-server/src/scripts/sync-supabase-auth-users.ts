import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { users } from "@workspace/db/schema";

type SupabaseAuthUser = {
  id: string;
  email?: string;
};

type SupabaseUsersResponse = {
  users?: SupabaseAuthUser[];
};

const dryRun = process.argv.includes("--dry-run");

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readBootstrapPassword(): string {
  const value = process.env.SUPABASE_AUTH_BOOTSTRAP_PASSWORD?.trim();
  if (!value || value.length < 12) {
    throw new Error(
      "SUPABASE_AUTH_BOOTSTRAP_PASSWORD must be at least 12 characters when creating Supabase Auth users.",
    );
  }
  return value;
}

function authHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit,
  params: { supabaseUrl: string; serviceRoleKey: string },
): Promise<T> {
  const response = await fetch(`${params.supabaseUrl}${path}`, {
    ...init,
    headers: {
      ...authHeaders(params.serviceRoleKey),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase Auth request failed (${response.status}) ${path}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function listAuthUsers(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
}): Promise<Map<string, SupabaseAuthUser>> {
  const byEmail = new Map<string, SupabaseAuthUser>();

  for (let page = 1; ; page += 1) {
    const body = await supabaseRequest<SupabaseUsersResponse>(
      `/auth/v1/admin/users?page=${page}&per_page=1000`,
      { method: "GET" },
      params,
    );
    const batch = body.users || [];
    for (const user of batch) {
      if (user.email) {
        byEmail.set(user.email.trim().toLowerCase(), user);
      }
    }
    if (batch.length < 1000) {
      return byEmail;
    }
  }
}

async function createAuthUser(
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
  },
  params: {
    bootstrapPassword: string;
    serviceRoleKey: string;
    supabaseUrl: string;
  },
): Promise<SupabaseAuthUser> {
  const body = await supabaseRequest<SupabaseAuthUser>(
    "/auth/v1/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        email: user.email,
        password: params.bootstrapPassword,
        email_confirm: true,
        user_metadata: {
          full_name: user.fullName,
        },
        app_metadata: {
          cadstone_user_id: user.id,
          cadstone_role: user.role,
        },
      }),
    },
    params,
  );

  return body;
}

async function updateAuthUserMetadata(
  supabaseAuthUserId: string,
  user: {
    id: string;
    fullName: string;
    role: string;
  },
  params: {
    serviceRoleKey: string;
    supabaseUrl: string;
  },
): Promise<void> {
  await supabaseRequest(
    `/auth/v1/admin/users/${encodeURIComponent(supabaseAuthUserId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        user_metadata: {
          full_name: user.fullName,
        },
        app_metadata: {
          cadstone_user_id: user.id,
          cadstone_role: user.role,
        },
      }),
    },
    params,
  );
}

async function main() {
  const supabaseUrl = normalizeUrl(requireEnv("SUPABASE_URL"));
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bootstrapPassword = dryRun ? "" : readBootstrapPassword();
  const authUsersByEmail = await listAuthUsers({ supabaseUrl, serviceRoleKey });

  const appUsers = await db
    .select({
      id: users.id,
      supabaseAuthUserId: users.supabaseAuthUserId,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.isActive, true), isNull(users.deletedAt)));

  let created = 0;
  let linked = 0;
  let updated = 0;
  let skipped = 0;

  for (const user of appUsers) {
    const email = user.email.trim().toLowerCase();
    let authUser = user.supabaseAuthUserId
      ? { id: user.supabaseAuthUserId, email }
      : authUsersByEmail.get(email);

    if (!authUser && dryRun) {
      console.log(`[dry-run] would create Supabase Auth user for ${email}`);
      skipped += 1;
      continue;
    }

    if (!authUser) {
      authUser = await createAuthUser(
        { id: user.id, email, fullName: user.fullName, role: user.role },
        { bootstrapPassword, serviceRoleKey, supabaseUrl },
      );
      created += 1;
      console.log(`created Supabase Auth user for ${email}`);
    }

    if (!user.supabaseAuthUserId) {
      if (!dryRun) {
        await db
          .update(users)
          .set({ supabaseAuthUserId: authUser.id, updatedAt: new Date() })
          .where(and(eq(users.id, user.id), isNull(users.supabaseAuthUserId)));
      }
      linked += 1;
      console.log(`${dryRun ? "[dry-run] would link" : "linked"} ${email}`);
    }

    if (!dryRun) {
      await updateAuthUserMetadata(
        authUser.id,
        { id: user.id, fullName: user.fullName, role: user.role },
        { serviceRoleKey, supabaseUrl },
      );
      updated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned: appUsers.length,
        created,
        linked,
        updated,
        skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
