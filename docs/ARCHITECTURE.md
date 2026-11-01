# WhatsApp Booking OS — Architecture

Independent WhatsApp-first appointment platform for barbershops, starting with a 4MEN pilot.

## Product principles
- Customers book, reschedule, and cancel inside WhatsApp without installing an app.
- Staff manage availability in a mobile-friendly web dashboard.
- PostgreSQL is the sole source of truth for bookings; the AI never invents slots.
- The first milestone works with a local WhatsApp simulator; live Meta integration comes later.

## Stack
Next.js App Router, TypeScript, Tailwind CSS, Supabase (PostgreSQL, Auth, RLS), Meta WhatsApp Cloud API, Vercel.

## Modules
- `booking`: availability, atomic booking, cancellation, rescheduling, idempotency.
- `calendar`: working hours, time off, staff views.
- `whatsapp`: verified webhook, messaging adapters, interactive flows.
- `ai`: intent recognition and tool calling, with confirmation before mutation.
- `salons`: multi-tenant configuration, staff, services and permissions.
- `notifications`: template messages, reminders, retries and opt-outs.

## Core tables
`salons`, `staff`, `services`, `staff_services`, `working_hours`, `time_off`, `clients`, `bookings`, `conversations`, `messages`, `notification_jobs`, `audit_logs`.

All tenant-scoped tables require salon isolation. Use PostgreSQL exclusion constraints over staff/time ranges to reject overlapping active bookings, plus transactional booking operations and idempotency keys. Store timestamps in UTC and display in Europe/Bucharest.

## Milestone 1 acceptance
1. Seed demo salon, staff, services, and working hours.
2. Simulator offers real available slots.
3. Confirmed booking appears in PRO calendar.
4. Concurrent attempts to reserve the same slot cannot both succeed.
5. Client can cancel or reschedule.
6. Lint, typecheck, build, and booking tests pass.

## Integration boundaries
Live WhatsApp requires Meta Business setup, credentials, webhook signature verification and applicable approved message templates. Never commit secrets. Marketing requires consent and opt-out handling.

## Delivery sequence
1. Next.js scaffold, database migrations and RLS.
2. Booking engine and tests.
3. Admin/PRO calendar and simulator.
4. Meta Cloud API and AI receptionist.
5. Reminders, loyalty and SaaS billing.
