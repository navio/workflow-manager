# Remote Registry Design Language

This document defines the visual and interaction rules for `apps/remote-registry`.
Use it as the source of truth for all UI-layer changes.

## Brand values

- Developer-native: the interface should feel at home for terminal-first users and engineering workflows.
- Precision-first: layouts, spacing, and states must be deliberate and consistent.
- Distinctively opinionated: avoid generic dashboard styling and preserve the product’s specific visual voice.

## Two-accent rule

- Brand accent: `#B6FF5C` (token `--accent` in dark mode) is for brand expression only.
- Functional success green: `#22C55E` (token `--ok` in dark mode) is for status semantics only.
- Never swap these roles.

Use brand accent only for:
- Wordmark accent glyph.
- Active navigation state.
- Primary CTA emphasis.

Use functional green only for:
- Published/healthy status pills.
- Success banners and positive system feedback.

## Typography

- Hero `h1` only: Instrument Serif.
- All other headings: IBM Plex Sans at `600`.
- Body copy: IBM Plex Sans at `400`.
- Code, slugs, versions, tokens, metadata: IBM Plex Mono.

## Color tokens

Dark and light color pairs are defined in `src/index.css` in the `:root` theme blocks.

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `#0B0D0C` | `#FAFAF7` |
| `--surface` | `#1A201D` | `#FFFFFF` |
| `--border` | `#2A332E` | `#E4E4DC` |
| `--text` | `#E8EBE5` | `#14171A` |
| `--text-muted` | `#8A948C` | `#6B7166` |
| `--accent` (brand) | `#B6FF5C` | `#4F7A1A` |
| `--ok` (status) | `#22C55E` | `#15803D` |
| `--warn` | `#F59E0B` | `#B45309` |
| `--err` | `#F87171` | `#B91C1C` |

## Spacing

- Use a 4px base grid.
- Scale tokens run from `--s-1` (`4px`) through `--s-20` (`80px`).
- Prefer tokenized spacing instead of hard-coded values.

## Radii

- `--r-sm`: `6px`
- `--r-md`: `10px`
- `--r-lg`: `14px`
- `--r-xl`: `20px`

## Component rules

- One primary CTA per view.
- Use Lucide icons only, with `strokeWidth={1.75}`.
- Do not use emoji as icons.
- Use `Field` for all form inputs.
- Use `StatusBanner` for error and success feedback.
- Use `Eyebrow` for page breadcrumb context.

## New page checklist

- Exactly one `<h1>`.
- Include an `Eyebrow` breadcrumb.
- Render errors through `StatusBanner`.
- Use `Field` for every form input.
- Use `Button` or `LinkButton` for page actions.
