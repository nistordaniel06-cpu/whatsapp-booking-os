# Setup (doable entirely from a phone browser)

## 1. Database (Supabase → SQL Editor)
Run the migrations in order. Paste each file's content and press **Run**:
1. `supabase/migrations/202611010001_core.sql` — skip it if the tables already exist.
2. `supabase/migrations/202611020001_mvp_whatsapp_booking.sql` — safe to re-run.

⚠️ Migration 2 replaces every RLS policy on the tenant tables. Until you give yourself a role, the dashboard shows no data.

## 2. Give yourself access (SQL Editor)
```sql
-- your Supabase Auth user id: Authentication → Users → copy "UID"
insert into platform_admins(user_id, role) values ('<YOUR-USER-ID>', 'founder');
insert into salon_members(salon_id, user_id, role)
select id, '<YOUR-USER-ID>', 'owner' from salons where name = '<SALON NAME>';
```

## 3. Salon data
Staff, services and working hours must exist (`/pro/hours` manages hours). Optional settings:
```sql
update salons set address = 'Str. ..., Oraș', slot_step_minutes = 15, min_notice_minutes = 60,
  booking_horizon_days = 14, cancel_notice_minutes = 120 where name = '<SALON NAME>';
```

## 4. WhatsApp (Meta for Developers → your app → WhatsApp → API Setup)
1. Copy the **Phone number ID** and link it to the salon:
   ```sql
   insert into whatsapp_numbers(salon_id, phone_number_id, display_phone)
   select id, '<PHONE_NUMBER_ID>', '+40...' from salons where name = '<SALON NAME>';
   ```
2. Vercel → Project → Settings → Environment Variables (Production), then **Redeploy**:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API keys — secret, server only)
   - `WHATSAPP_VERIFY_TOKEN` — any long random string you invent
   - `WHATSAPP_APP_SECRET` — Meta app → App settings → Basic → App secret
   - `WHATSAPP_ACCESS_TOKEN` — a System User permanent token with `whatsapp_business_messaging`
3. Meta → WhatsApp → Configuration → Webhook:
   - Callback URL: `https://<your-vercel-domain>/api/whatsapp/webhook`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field.
4. Test: send "Salut" from a phone that is allowed in the Meta test number list.

Customer messages to the business are answered inside the 24-hour service window, so no templates are needed for the booking flow. Reminders (V7) will need approved templates.

## Local / CI checks
`npm ci && npm run ci` — typecheck, tests (including the SQL migrations in an in-memory Postgres) and build. GitHub Actions runs the same on every pull request.
