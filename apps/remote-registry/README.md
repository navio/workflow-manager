# Remote Registry App

This is the React + Vite web app for the remote workflow registry.

## Scripts

```bash
bun install
bun run dev
bun run build
```

## Environment

Copy `.env.example` to `.env.local` and provide:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

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

This assumes the Netlify site is connected to the GitHub repository and uses the root config file.
