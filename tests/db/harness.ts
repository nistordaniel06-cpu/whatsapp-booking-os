import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {PGlite} from "@electric-sql/pglite";
import {btree_gist} from "@electric-sql/pglite/contrib/btree_gist";

/** Minimal stand-in for the parts of Supabase the migrations rely on (auth schema, roles). */
const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

export async function freshDb() {
  const db = new PGlite({extensions: {btree_gist}});
  await db.exec(SUPABASE_STUB);
  const dir = join(__dirname, "..", "..", "supabase", "migrations");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  // Supabase grants table privileges to these roles by default; RLS then filters rows.
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);
  return db;
}

export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

/** Seeds one salon with a specialist working every day 09:00–18:00 Bucharest time. */
export async function seedSalon(db: PGlite, name: string) {
  const salon = (await db.query<{id: string}>(`insert into salons(name, min_notice_minutes) values ($1, 0) returning id`, [name])).rows[0].id;
  const staff = (await db.query<{id: string}>(`insert into staff(salon_id, name) values ($1, 'Andrei') returning id`, [salon])).rows[0].id;
  const service = (await db.query<{id: string}>(`insert into services(salon_id, name, duration_minutes, price_ron) values ($1, 'Tuns', 30, 60) returning id`, [salon])).rows[0].id;
  for (let d = 0; d < 7; d++) {
    await db.query(`insert into working_hours(salon_id, staff_id, weekday, starts_local, ends_local) values ($1,$2,$3,'09:00','18:00')`, [salon, staff, d]);
  }
  return {salon, staff, service};
}

/** Tomorrow at HH:MM in Bucharest, as an ISO instant computed by Postgres itself. */
export async function tomorrowAt(db: PGlite, hhmm: string) {
  const r = await db.query<{t: string}>(
    `select ((((now() at time zone 'Europe/Bucharest')::date + 1) + $1::time) at time zone 'Europe/Bucharest')::text as t`, [hhmm]);
  return r.rows[0].t;
}
