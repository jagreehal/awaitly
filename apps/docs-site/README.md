# awaitly docs

Documentation site for [awaitly](https://github.com/jagreehal/awaitly), built with Astro and Starlight.

## API reference (generated)

The [API reference](/docs/reference/api) is generated from the awaitly package TypeScript source and JSDoc using [TypeDoc](https://typedoc.org/). To regenerate it:

1. From the repo root: `pnpm run generate-api`
2. Or from this directory: `pnpm run generate-api`

This runs TypeDoc to emit JSON (`.typedoc-out/api.json`) and then `scripts/generate-api-from-typedoc.mjs` to produce `src/content/docs/reference/api.md`.

The docs-site build (`pnpm run build`) runs `generate-api` before building, so the API reference is always up to date when you build.
