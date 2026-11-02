# V1 Audit — 2 Nov 2026 (commit b3aab58)

## Implemented
- Next.js 15 app: landing, local simulator (`/demo`, localStorage only), demo calendar (`/pro`, `/admin`).
- Supabase Auth login/sign-up (`/login`), live calendar with day/3-day/week views (`/pro/live`), working-hours editor (`/pro/hours`).
- Core schema: salons, staff, services, clients, bookings with a GiST exclusion constraint against overlapping bookings and composite tenant foreign keys (good foundations).

## Demonstrably working
- Unit tests for the overlap helper (2 tests).
- Nothing else is verifiable from the repo: no CI, no integration tests.

## Broken
- **`main` did not build**: type error in `src/app/pro/live/page.tsx` (Supabase relation typing), so the last commits could not deploy on Vercel.
- `.env.example` listed `NEXT_PUBLIC_SUPABASE_ANON_KEY` but the code reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Dashboard booking times were converted with the browser's timezone, not the salon's.

## Schema drift / unsafe
- The UI uses `working_hours` and RPC `create_staff_booking`, which are **not in any migration** — the live DB was changed by hand and the repo is not the source of truth.
- No RLS policies in the repo. Unknown policies may exist in the live DB; with open sign-up, any registered user could potentially read every salon's data.
- No roles/membership model, no audit log, the login form was pre-filled with a real email address.
- `postcss` vulnerability (high) through `next`.

## Missing for the first real WhatsApp booking
Webhook + signature verification, phone-number → salon routing, availability engine, server-side booking with working-hours/time-off validation, conversation state, outbound sender, idempotency.

## Done in this iteration
See the pull request "V1–V5 MVP: WhatsApp → real booking in Supabase".
