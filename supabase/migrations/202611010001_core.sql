create extension if not exists btree_gist;
create table public.salons(id uuid primary key default gen_random_uuid(),name text not null,timezone text not null default 'Europe/Bucharest',created_at timestamptz not null default now());
create table public.staff(id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.salons(id),name text not null,created_at timestamptz not null default now(),unique(id,salon_id));
create table public.services(id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.salons(id),name text not null,duration_minutes int not null check(duration_minutes>0),price_ron numeric(10,2) not null default 0,unique(id,salon_id));
create table public.clients(id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.salons(id),phone_e164 text not null,name text,unique(salon_id,phone_e164),unique(id,salon_id));
create table public.bookings(id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.salons(id),staff_id uuid not null,service_id uuid not null,client_id uuid not null,starts_at timestamptz not null,ends_at timestamptz not null,status text not null default 'confirmed' check(status in ('confirmed','pending','cancelled','completed','no_show')),idempotency_key text,created_at timestamptz not null default now(),check(ends_at>starts_at),foreign key(staff_id,salon_id) references public.staff(id,salon_id),foreign key(service_id,salon_id) references public.services(id,salon_id),foreign key(client_id,salon_id) references public.clients(id,salon_id),unique(salon_id,idempotency_key));
alter table public.bookings add constraint no_staff_overlap exclude using gist(staff_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('confirmed','pending'));
create index bookings_staff_start_idx on public.bookings(staff_id,starts_at);
alter table public.salons enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.bookings enable row level security;
-- RLS deny-by-default until tenant membership policies are implemented. Never expose service role credentials to the browser.
