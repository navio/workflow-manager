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
