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

| Value                           | Goes into                                                      |
| ------------------------------- | -------------------------------------------------------------- |
| Project URL                     | `SUPABASE_URL` and `VITE_SUPABASE_URL`                         |
| Project ID (the ref in the URL) | `SUPABASE_PROJECT_ID` and `VITE_SUPABASE_PROJECT_ID`           |
| `anon` / publishable key        | `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `service_role` key              | `SUPABASE_SERVICE_ROLE_KEY` — **secret**                       |

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

Run the migrations (step 4) **before** deploying. Without them the site builds
and serves fine but every page is empty, which looks like a broken deploy.

### 1. Import the repo

<https://vercel.com/new> → import the GitHub repo.

Leave the framework preset as **Other**. `vercel.json` already sets the build
command and output directory; do not override them. There is no "root
directory" to change — the app is at the repo root.

### 2. Environment variables — do this BEFORE the first deploy

**Settings → Environment Variables.** Vercel never reads `.env` files, so a
deploy without these fails at build time with "Missing Supabase environment
variable(s)".

Add all seven, ticking **Production**, **Preview** and **Development** for each:

| Variable                        | Notes                                    |
| ------------------------------- | ---------------------------------------- |
| `SUPABASE_URL`                  |                                          |
| `SUPABASE_PROJECT_ID`           |                                          |
| `SUPABASE_PUBLISHABLE_KEY`      |                                          |
| `VITE_SUPABASE_URL`             | same value as `SUPABASE_URL`             |
| `VITE_SUPABASE_PROJECT_ID`      | same value as `SUPABASE_PROJECT_ID`      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same value as `SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY`     | mark **Sensitive**. No `VITE_` prefix.   |

The `VITE_` copies are not redundant — those are the ones compiled into the
browser bundle. The unprefixed ones are read by the server at runtime.

Changing an env var later does **not** rebuild the site. Redeploy from the
Deployments tab afterwards.

### 3. Point Supabase at the deployed URL

**Authentication → URL Configuration:**

- Site URL: `https://<your-domain>.vercel.app`
- Redirect URLs: add `https://<your-domain>.vercel.app/auth/callback`, and keep
  `http://localhost:8080/auth/callback` for local work

Skip this and sign-in emails keep pointing at localhost — login appears broken
for everyone but the person running it locally.

Vercel gives every deploy its own preview URL. Those will not work for OAuth
unless added here too; test auth on the production domain.

### 4. Verify

- The site loads and subject pages list classrooms (proves migrations ran)
- Sign up with a real email, confirm the link, and check a row appears in
  `profiles` in the Supabase Table Editor

Node is pinned to >=22.12 in `package.json` (Vite 8 requires it); Vercel picks
this up automatically.

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

- Files marked _"automatically generated — do not edit"_ under
  `src/integrations/` come from Lovable's tooling. Prefer changing config or
  environment over editing them; they can be regenerated.
- `npm run lint` must stay at zero errors. Run `npm run format` before pushing.
- Never commit `.env`. Never add a `VITE_` prefix to a secret — anything with
  that prefix is compiled into the JavaScript the browser downloads.
