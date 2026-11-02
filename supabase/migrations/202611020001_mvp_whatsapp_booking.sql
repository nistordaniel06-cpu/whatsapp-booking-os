-- WhatsApp Booking OS — MVP: tenancy, roles, RLS, schedules, WhatsApp, safe booking RPCs.
-- Additive and re-runnable: safe to apply on top of 202611010001_core.sql and on a database
-- where working_hours was already created manually.
-- IMPORTANT: this migration REPLACES every existing RLS policy on the tenant tables listed below
-- with membership-based policies. After applying, insert your salon_members row (see README-SETUP.md)
-- or the dashboard will show no data.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- salon settings
alter table public.salons add column if not exists slug text unique;
alter table public.salons add column if not exists address text;
alter table public.salons add column if not exists phone text;
alter table public.salons add column if not exists slot_step_minutes int not null default 15 check (slot_step_minutes between 5 and 120);
alter table public.salons add column if not exists min_notice_minutes int not null default 60 check (min_notice_minutes >= 0);
alter table public.salons add column if not exists booking_horizon_days int not null default 14 check (booking_horizon_days between 1 and 90);
alter table public.salons add column if not exists cancel_notice_minutes int not null default 120 check (cancel_notice_minutes >= 0);

alter table public.staff add column if not exists active boolean not null default true;
alter table public.services add column if not exists active boolean not null default true;
alter table public.services add column if not exists sort_order int not null default 0;
alter table public.clients add column if not exists created_at timestamptz not null default now();
alter table public.bookings add column if not exists source text not null default 'dashboard' check (source in ('dashboard','whatsapp','api'));
alter table public.bookings add column if not exists cancelled_at timestamptz;

-- ---------------------------------------------------------------- roles
create table if not exists public.platform_admins(
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('founder','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.salon_members(
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','specialist','receptionist')),
  staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (salon_id, user_id)
);
create index if not exists salon_members_user_idx on public.salon_members(user_id);

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.has_salon_role(p_salon uuid, p_roles text[] default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.salon_members m
    where m.salon_id = p_salon and m.user_id = auth.uid()
      and (p_roles is null or m.role = any(p_roles)))
$$;

-- ---------------------------------------------------------------- schedules
create table if not exists public.working_hours(
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday (PostgreSQL dow)
  starts_local time not null,
  ends_local time not null,
  check (ends_local > starts_local),
  foreign key (staff_id, salon_id) references public.staff(id, salon_id) on delete cascade
);
create index if not exists working_hours_staff_idx on public.working_hours(staff_id, weekday);

create table if not exists public.time_off(
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  staff_id uuid, -- null = whole salon closed
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (staff_id, salon_id) references public.staff(id, salon_id) on delete cascade
);
create index if not exists time_off_salon_idx on public.time_off(salon_id, starts_at);

-- If a specialist has no rows here they offer every active service.
create table if not exists public.staff_services(
  salon_id uuid not null references public.salons(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  primary key (staff_id, service_id),
  foreign key (staff_id, salon_id) references public.staff(id, salon_id) on delete cascade,
  foreign key (service_id, salon_id) references public.services(id, salon_id) on delete cascade
);

-- ---------------------------------------------------------------- WhatsApp
create table if not exists public.whatsapp_numbers(
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  phone_number_id text not null unique, -- Meta phone number ID (not the phone number itself)
  display_phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations(
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_phone text not null,
  profile_name text,
  state jsonb not null default '{}'::jsonb,
  mode text not null default 'bot' check (mode in ('bot','human')),
  human_until timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, client_phone)
);

create table if not exists public.messages(
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  wa_message_id text unique, -- idempotency for webhooks
  kind text not null,
  body text,
  payload jsonb,
  status text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

create table if not exists public.audit_logs(
  id bigint generated always as identity primary key,
  salon_id uuid references public.salons(id) on delete cascade,
  actor text not null, -- 'user:<uuid>' | 'whatsapp:<phone>' | 'system'
  action text not null,
  entity text,
  entity_id uuid,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_salon_idx on public.audit_logs(salon_id, created_at desc);

-- ---------------------------------------------------------------- RLS
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in (
             'salons','staff','services','clients','bookings','working_hours','time_off','staff_services',
             'whatsapp_numbers','conversations','messages','audit_logs','salon_members','platform_admins')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.salons enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.bookings enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off enable row level security;
alter table public.staff_services enable row level security;
alter table public.whatsapp_numbers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.audit_logs enable row level security;
alter table public.salon_members enable row level security;
alter table public.platform_admins enable row level security;

create policy salons_read on public.salons for select to authenticated using (public.has_salon_role(id));
create policy salons_update on public.salons for update to authenticated
  using (public.has_salon_role(id, array['owner','manager'])) with check (public.has_salon_role(id, array['owner','manager']));

-- Catalogue / schedule tables: members read, owner+manager manage.
create policy staff_read on public.staff for select to authenticated using (public.has_salon_role(salon_id));
create policy staff_manage on public.staff for all to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager'])) with check (public.has_salon_role(salon_id, array['owner','manager']));
create policy services_read on public.services for select to authenticated using (public.has_salon_role(salon_id));
create policy services_manage on public.services for all to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager'])) with check (public.has_salon_role(salon_id, array['owner','manager']));
create policy working_hours_read on public.working_hours for select to authenticated using (public.has_salon_role(salon_id));
create policy working_hours_manage on public.working_hours for all to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager'])) with check (public.has_salon_role(salon_id, array['owner','manager']));
create policy time_off_read on public.time_off for select to authenticated using (public.has_salon_role(salon_id));
create policy time_off_manage on public.time_off for all to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager'])) with check (public.has_salon_role(salon_id, array['owner','manager']));
create policy staff_services_read on public.staff_services for select to authenticated using (public.has_salon_role(salon_id));
create policy staff_services_manage on public.staff_services for all to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager'])) with check (public.has_salon_role(salon_id, array['owner','manager']));

-- Clients & bookings: members read; creation/cancellation only through RPCs below.
create policy clients_read on public.clients for select to authenticated using (public.has_salon_role(salon_id));
create policy clients_update on public.clients for update to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager','receptionist'])) with check (public.has_salon_role(salon_id, array['owner','manager','receptionist']));
create policy bookings_read on public.bookings for select to authenticated using (public.has_salon_role(salon_id));

create policy whatsapp_numbers_read on public.whatsapp_numbers for select to authenticated using (public.has_salon_role(salon_id, array['owner','manager']));
create policy conversations_read on public.conversations for select to authenticated using (public.has_salon_role(salon_id, array['owner','manager','receptionist']));
create policy conversations_update on public.conversations for update to authenticated
  using (public.has_salon_role(salon_id, array['owner','manager','receptionist'])) with check (public.has_salon_role(salon_id, array['owner','manager','receptionist']));
create policy messages_read on public.messages for select to authenticated using (public.has_salon_role(salon_id, array['owner','manager','receptionist']));
create policy audit_logs_read on public.audit_logs for select to authenticated using (public.has_salon_role(salon_id, array['owner']));

create policy salon_members_read on public.salon_members for select to authenticated
  using (user_id = auth.uid() or public.has_salon_role(salon_id, array['owner']));
create policy salon_members_manage on public.salon_members for all to authenticated
  using (public.has_salon_role(salon_id, array['owner'])) with check (public.has_salon_role(salon_id, array['owner']));
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- booking core (server-only)
create or replace function public._book_slot(
  p_salon uuid, p_staff uuid, p_service uuid, p_phone text, p_name text,
  p_start timestamptz, p_key text, p_source text, p_actor text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_salon public.salons;
  v_service public.services;
  v_end timestamptz;
  v_ls timestamp;
  v_le timestamp;
  v_client uuid;
  v_booking public.bookings;
begin
  if p_key is null or length(p_key) < 8 then raise exception 'idempotency_key_required'; end if;
  select * into v_booking from public.bookings where salon_id = p_salon and idempotency_key = p_key;
  if found then return v_booking; end if;

  select * into v_salon from public.salons where id = p_salon;
  if not found then raise exception 'salon_not_found'; end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone'; end if;
  select * into v_service from public.services where id = p_service and salon_id = p_salon and active;
  if not found then raise exception 'service_not_found'; end if;
  perform 1 from public.staff where id = p_staff and salon_id = p_salon and active;
  if not found then raise exception 'staff_not_found'; end if;
  if exists(select 1 from public.staff_services where staff_id = p_staff)
     and not exists(select 1 from public.staff_services where staff_id = p_staff and service_id = p_service) then
    raise exception 'staff_does_not_offer_service';
  end if;
  if p_start < now() + make_interval(mins => v_salon.min_notice_minutes) then raise exception 'too_soon'; end if;
  if p_start > now() + make_interval(days => v_salon.booking_horizon_days + 1) then raise exception 'too_far'; end if;

  v_end := p_start + make_interval(mins => v_service.duration_minutes);
  v_ls := p_start at time zone v_salon.timezone;
  v_le := v_end at time zone v_salon.timezone;
  if v_ls::date <> v_le::date or not exists(
      select 1 from public.working_hours w
      where w.staff_id = p_staff and w.weekday = extract(dow from v_ls)::int
        and w.starts_local <= v_ls::time and w.ends_local >= v_le::time) then
    raise exception 'outside_working_hours';
  end if;
  if exists(select 1 from public.time_off t
            where t.salon_id = p_salon and (t.staff_id is null or t.staff_id = p_staff)
              and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start, v_end, '[)')) then
    raise exception 'time_off';
  end if;

  insert into public.clients(salon_id, phone_e164, name)
  values (p_salon, p_phone, nullif(btrim(coalesce(p_name, '')), ''))
  on conflict (salon_id, phone_e164) do update set name = coalesce(public.clients.name, excluded.name)
  returning id into v_client;

  begin
    insert into public.bookings(salon_id, staff_id, service_id, client_id, starts_at, ends_at, status, idempotency_key, source)
    values (p_salon, p_staff, p_service, v_client, p_start, v_end, 'confirmed', p_key, p_source)
    returning * into v_booking;
  exception
    when exclusion_violation then raise exception 'slot_taken';
    when unique_violation then
      select * into v_booking from public.bookings where salon_id = p_salon and idempotency_key = p_key;
      if not found then raise; end if;
      return v_booking;
  end;

  insert into public.audit_logs(salon_id, actor, action, entity, entity_id, data)
  values (p_salon, p_actor, 'booking.create', 'booking', v_booking.id,
          jsonb_build_object('source', p_source, 'staff_id', p_staff, 'service_id', p_service, 'starts_at', p_start));
  return v_booking;
end $$;

create or replace function public._cancel_booking(p_booking uuid, p_actor text, p_enforce_notice boolean)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare v_booking public.bookings; v_notice int;
begin
  select b.* into v_booking from public.bookings b where b.id = p_booking for update;
  if not found then raise exception 'booking_not_found'; end if;
  if v_booking.status not in ('confirmed','pending') then raise exception 'booking_not_active'; end if;
  select cancel_notice_minutes into v_notice from public.salons where id = v_booking.salon_id;
  if p_enforce_notice and v_booking.starts_at < now() + make_interval(mins => v_notice) then
    raise exception 'too_late_to_cancel';
  end if;
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking returning * into v_booking;
  insert into public.audit_logs(salon_id, actor, action, entity, entity_id)
  values (v_booking.salon_id, p_actor, 'booking.cancel', 'booking', p_booking);
  return v_booking;
end $$;

-- WhatsApp (called by the server with the service role only).
create or replace function public.whatsapp_book_slot(
  p_salon uuid, p_staff uuid, p_service uuid, p_phone text, p_name text, p_start timestamptz, p_key text)
returns public.bookings language sql security definer set search_path = public as $$
  select * from public._book_slot(p_salon, p_staff, p_service, p_phone, p_name, p_start, p_key, 'whatsapp', 'whatsapp:' || p_phone)
$$;

create or replace function public.whatsapp_cancel_booking(p_salon uuid, p_booking uuid, p_phone text)
returns public.bookings language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.bookings b join public.clients c on c.id = b.client_id
  where b.id = p_booking and b.salon_id = p_salon and c.phone_e164 = p_phone;
  if not found then raise exception 'booking_not_found'; end if;
  return public._cancel_booking(p_booking, 'whatsapp:' || p_phone, true);
end $$;

-- Dashboard (authenticated, membership checked).
create or replace function public.dashboard_create_booking(
  p_staff uuid, p_service uuid, p_phone text, p_name text, p_start timestamptz, p_request_key text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare v_salon uuid;
begin
  select salon_id into v_salon from public.staff where id = p_staff;
  if v_salon is null or auth.uid() is null
     or not public.has_salon_role(v_salon, array['owner','manager','receptionist','specialist']) then
    raise exception 'forbidden';
  end if;
  return public._book_slot(v_salon, p_staff, p_service, p_phone, p_name, p_start, p_request_key, 'dashboard', 'user:' || auth.uid());
end $$;

create or replace function public.dashboard_cancel_booking(p_booking uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare v_salon uuid;
begin
  select salon_id into v_salon from public.bookings where id = p_booking;
  if v_salon is null or auth.uid() is null
     or not public.has_salon_role(v_salon, array['owner','manager','receptionist','specialist']) then
    raise exception 'forbidden';
  end if;
  return public._cancel_booking(p_booking, 'user:' || auth.uid(), false);
end $$;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default: lock them down explicitly.
revoke all on function public._book_slot(uuid, uuid, uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public._cancel_booking(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.whatsapp_book_slot(uuid, uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.whatsapp_cancel_booking(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.dashboard_create_booking(uuid, uuid, text, text, timestamptz, text) from public, anon;
revoke all on function public.dashboard_cancel_booking(uuid) from public, anon;
grant execute on function public._book_slot(uuid, uuid, uuid, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public._cancel_booking(uuid, text, boolean) to service_role;
grant execute on function public.whatsapp_book_slot(uuid, uuid, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.whatsapp_cancel_booking(uuid, uuid, text) to service_role;
grant execute on function public.dashboard_create_booking(uuid, uuid, text, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.dashboard_cancel_booking(uuid) to authenticated, service_role;
