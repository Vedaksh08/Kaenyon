StudyAll — Build Plan

### Phase 1 — Frontend shell ✅ COMPLETE

### Phase 2 — Lovable Cloud backend ✅ COMPLETE

- Real Email/Password + Google auth on `/login` and `/signup`
- Protected routes under `_authenticated/` with automatic redirect to `/login`
- **Suspended-user gate** in `_authenticated/route.tsx` — checks `profiles.suspended_until` and redirects to `/suspended`
- Schema + RLS + GRANTs for profiles, user_roles, subjects, classrooms, doubts, answers, reports, blocks, moderation_log
- `has_role()` security-definer role check
- **Subject page** now reads subjects + classrooms from DB (real UUIDs)
- **Room page** reads doubts from DB filtered by classroom_id, inserts via authenticated client, and subscribes to Supabase Realtime (INSERT/DELETE)
- **Admin dashboard** is role-gated (via `has_role`) and pulls live reports, moderation log, and suspended users; actions write to `profiles.suspended_until` and `moderation_log`
- Sign-out clears session; auth listener invalidates router + query cache

### Phase 3 — Smart room scaling

- Edge cron for room open/merge with ROOM_MERGE broadcast
- Auto-flag rule (3 reports / 7d)
- Email OTP 2FA (replace client-side mock in `/two-factor`)
- Realtime presence for live "online" counts per subject/room
