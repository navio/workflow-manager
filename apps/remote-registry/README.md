# Remote Registry App

This is the React + Vite web app for the remote workflow registry.

## Scripts

```bash
bun install
bun run dev
bun run build
bun run test
bun run test:auth:local
```

## Environment

Copy `.env.example` to `.env.local` and provide:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_ENABLE_GOOGLE_AUTH` (`true` to show Google OAuth button, default hidden)

The checked-in defaults already point at the shared hosted registry project, so Netlify and local builds work without extra setup unless you want to override them.

For local Supabase auth validation, set `.env.local` to your local stack values (`http://127.0.0.1:54321` plus local publishable key), make sure Mailpit is running at `http://127.0.0.1:54324`, then run `bun run test:auth:local`.

The app currently includes:

- public overview page
- public search page
- workflow detail page
- sign-in/sign-up page
- dashboard shell
- CLI token creation page

## Netlify release

The repository root `netlify.toml` is configured to auto-release this app on Netlify:

- PRs -> Deploy Previews
- merges to `main` -> production deploys for `workflow-manager-ui`

This assumes the Netlify site is connected to the GitHub repository, uses the root config file, and sets `NETLIFY_SITE_TARGET=remote-ui`.
