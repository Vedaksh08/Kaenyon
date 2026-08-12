# StudyAll — setup

Running this project needs a Supabase project of our own. The original database
was provisioned by Lovable under Lovable's account, so nobody on the team could
administer it — no dashboard, no service key, no migrations. We are starting on a
fresh one.

## 1. Create the Supabase project

<https://supabase.com/dashboard> → **New Project**.

- Name: `studyall`
- Region: pick the one closest to the users (`ap-south-1` / Mumbai for India)
- Save the database password somewhere safe — it is shown only once

## 2. Collect the keys

**Project Settings → API:**

| Value | Goes into |
|---|---|
| Project URL | `SUPABASE_URL` and `VITE_SUPABASE_URL` |
| Project ID (the ref in the URL) | `SUPABASE_PROJECT_ID` and `VITE_SUPABASE_PROJECT_ID` |
| `anon` / publishable key | `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` — **secret** |

The `anon` key is safe in the browser; row-level security is what protects the
data. The `service_role` key bypasses RLS entirely — it must never get a `VITE_`
prefix, never be committed, and never be pasted into chat or screenshots.

## 3. Local env

```bash
cp .env.example .env
```

Fill in the values from step 2. `.env` is gitignored — keep it that way.

## 4. Push the schema

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

That runs all 13 migrations in `supabase/migrations/`: the schema, row-level
security, the `SECURITY DEFINER` functions, and seeds (44 subjects, 3 classrooms
each). Verify in the dashboard that Table Editor shows 13 tables and `subjects`
has 44 rows.

## 5. Auth configuration

**Authentication → URL Configuration:**

- Site URL: `http://localhost:8080` for local, the Vercel URL once deployed
- Redirect URLs: add **both**
  - `http://localhost:8080/auth/callback`
  - `https://<your-vercel-domain>/auth/callback`

Without these, magic-link emails bounce to the wrong place and sign-in fails.

Email sign-in works out of the box.

### Google / Apple (optional)

The buttons call Supabase directly, but each provider needs credentials under
**Authentication → Providers** or it returns `missing OAuth secret`:

- **Google** — create an OAuth client at <https://console.cloud.google.com>
  (APIs & Services → Credentials → OAuth client ID → Web application). Add
  `https://<project-ref>.supabase.co/auth/v1/callback` as an authorised redirect
  URI, then paste the client ID and secret into Supabase.
- **Apple** — needs a paid Apple Developer account; skip unless you need it.

Until credentials are set, leave both providers **disabled** in Supabase so the
buttons don't offer a path that fails.

## 6. Run it

```bash
npm install
npm run dev
```

<http://localhost:8080>

---

## Deploying to Vercel

`npm run build` writes `.vercel/output/` (Build Output API v3). Import the repo
at <https://vercel.com/new> and add the same variables from `.env` under
**Settings → Environment Variables** — Vercel does not read `.env` files.

Set `VITE_*` for all environments. Keep `SUPABASE_SERVICE_ROLE_KEY` marked
**Sensitive**.

After the first deploy, add the live URL to Supabase → Authentication → URL
Configuration (Site URL, plus `https://<domain>/auth/callback` as a redirect),
or sign-in links will keep pointing at localhost.

## Notes on the Lovable migration

This started as a Lovable project. Already removed: the hosted OAuth broker
(`@lovable.dev/cloud-auth-js`) and the Cloudflare Workers build default.

Still present, deliberately:

- **`@lovable.dev/vite-tanstack-config`** bundles the entire Vite setup
  (TanStack Start, React, Tailwind, path aliases, env injection). Replacing it
  means rebuilding the build config by hand — worth doing eventually, not
  urgent, and it does not tie us to Lovable's servers.
- **`src/lib/lovable-error-reporting.ts`** is a no-op outside Lovable; it
  optional-chains a global that never exists.

## Notes for whoever is editing

- Files marked *"automatically generated — do not edit"* under
  `src/integrations/` come from Lovable's tooling. Prefer changing config or
  environment over editing them; they can be regenerated.
- `npm run lint` must stay at zero errors. Run `npm run format` before pushing.
- Never commit `.env`. Never add a `VITE_` prefix to a secret — anything with
  that prefix is compiled into the JavaScript the browser downloads.
