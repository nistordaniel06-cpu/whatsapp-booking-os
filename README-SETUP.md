# Setup

1. Run `npm install` and `npm run dev`.
2. Visit `/demo` for a **UI-only simulator** (no real bookings).
3. Create a Supabase project and apply `supabase/migrations/202611010001_core.sql` in a development database.
4. Do not use the schema for production yet: tenant membership/RLS policies, schedule tables and transactional booking APIs are pending.
5. Configure Meta credentials only when the verified webhook and messaging adapters are implemented.
