// @ts-check
import { createRequire } from "node:module";
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import starlightThemeNext from 'starlight-theme-next';
import tailwindcss from '@tailwindcss/vite';
import astroMermaid from 'astro-mermaid';
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Base path for GitHub Pages (https://jagreehal.github.io/awaitly/). Local dev
// uses /awaitly too so base-path bugs surface locally; `pnpm dev:root` overrides.
const BASE = process.env.BASE || '/awaitly';
// Same value guaranteed to end in exactly one slash, for string concatenation.
const BASE_PATH = BASE.replace(/\/?$/, '/');
// https://astro.build/config
export default defineConfig({
  site: 'https://jagreehal.github.io',
  // GFM is enabled by default, but astro-mermaid sets markdown.remarkPlugins,
  // which drops the default GFM plugins from the MDX pipeline (tables render as
  // raw `|` text in .mdx). Setting it explicitly restores tables/strikethrough.
  markdown: {
    gfm: true,
  },
  // Use base path for GitHub Pages deployment (https://jagreehal.github.io/awaitly/).
  // Local dev uses /awaitly by default so you can catch production issues; use pnpm dev:root or BASE=/ pnpm dev to run from /.
  base: BASE,
  // Pages merged during the docs consolidation. workflows-and-steps duplicated
  // foundations/workflows + foundations/step; thunks folded into the latter.
  // Redirect targets are NOT base-prefixed by Astro, so build them from BASE
  // explicitly — otherwise they land on / instead of /awaitly/ in production.
  redirects: {
    '/foundations/workflows-and-steps': `${BASE_PATH}foundations/workflows`,
    '/foundations/thunks': `${BASE_PATH}foundations/step`,
    // Merged into framework-integration (tRPC, Hono, and Next.js Pages
    // Router moved across); the plural slug was never in the sidebar.
    '/guides/framework-integrations': `${BASE_PATH}guides/framework-integration`,
  },
  integrations: [
    react(),
    sitemap(),
    astroMermaid(),
    starlight({
      title: 'awaitly',
      description: 'Typed async workflows with Result types and automatic error inference',
      // Ensure relative links resolve under base path (dev and production).
      head: [
        {
          tag: 'base',
          attrs: {
            href: BASE_PATH,
          },
        },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: '',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&display=swap',
          },
        },
      ],
      favicon: '/favicon.svg',
      logo: {
        src: './public/logo-animated.svg',
        alt: 'awaitly',
      },
      customCss: ['./src/styles/global.css', './src/styles/landing.css'],
      plugins: [starlightThemeNext()],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      editLink: {
        baseUrl: 'https://github.com/jagreehal/awaitly/edit/main/apps/docs-site/',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/awaitly' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'The Basics', slug: 'getting-started/basics' },
            { label: 'Your First Workflow', slug: 'getting-started/first-workflow' },
            { label: 'What TypeScript Gives You', slug: 'getting-started/types' },
            { label: 'Handling Errors', slug: 'getting-started/error-handling' },
          ],
        },
        {
          label: 'Foundations',
          items: [
            { label: 'Overview', slug: 'foundations' },
            { label: 'Result Types', slug: 'foundations/result-types' },
            { label: 'Workflows', slug: 'foundations/workflows' },
            { label: 'Steps', slug: 'foundations/step' },
            { label: 'Policies (retry, timeout, fallback)', slug: 'advanced/policies' },
            { label: 'Control Flow', slug: 'foundations/control-flow' },
            { label: 'Errors and Retries', slug: 'foundations/error-handling' },
            { label: 'Tagged Errors', slug: 'foundations/tagged-errors' },
            { label: 'Error Patterns', slug: 'foundations/error-patterns' },
            { label: 'State and Resumption', slug: 'foundations/state-and-resumption' },
            { label: 'Streaming', slug: 'foundations/streaming' },
          ],
        },
        {
          label: 'Guides',
          items: [
            {
              label: 'Resilience & execution',
              items: [
                { label: 'Retries & Timeouts', slug: 'guides/retries-timeouts' },
                { label: 'Caching', slug: 'guides/caching' },
                { label: 'Conditional Execution', slug: 'guides/conditional-execution' },
                { label: 'Batch Processing', slug: 'guides/batch-processing' },
                { label: 'Streaming', slug: 'guides/streaming' },
                { label: 'Human-in-the-Loop', slug: 'guides/human-in-loop' },
                { label: 'Callback Hooks', slug: 'guides/hooks' },
                { label: 'Workflow Versioning', slug: 'guides/versioning' },
              ],
            },
            {
              label: 'Persistence',
              items: [
                { label: 'Persistence', slug: 'guides/persistence' },
                { label: 'Durable Execution', slug: 'guides/durable-execution' },
                { label: 'PostgreSQL Persistence', slug: 'guides/postgres-persistence' },
                { label: 'MongoDB Persistence', slug: 'guides/mongo-persistence' },
              ],
            },
            {
              label: 'Integrations',
              items: [
                { label: 'Prisma Integration', slug: 'guides/prisma' },
                { label: 'Drizzle Integration', slug: 'guides/drizzle' },
                { label: 'Zod Integration', slug: 'guides/zod' },
                { label: 'Framework Integration', slug: 'guides/framework-integration' },
                { label: 'React Query Integration', slug: 'guides/react-query' },
                { label: 'AI Integration Patterns', slug: 'guides/ai-integration' },
                { label: 'AI SDK Workflows', slug: 'guides/ai-sdk-workflows' },
              ],
            },
            {
              label: 'Tooling',
              items: [
                { label: 'Static Analysis', slug: 'guides/static-analysis' },
                { label: 'Analyzer Showcase', slug: 'guides/analyzer-showcase' },
                { label: 'Visualization', slug: 'guides/visualization' },
                { label: 'Documenting Workflows', slug: 'guides/documenting-workflows' },
                { label: 'Docs for agents', slug: 'guides/docs-for-agents' },
                { label: 'ESLint Plugin', slug: 'guides/eslint-plugin' },
                { label: 'Claude Code Skill', slug: 'guides/claude-skill' },
                { label: 'Testing', slug: 'guides/testing' },
                { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
              ],
            },
            {
              label: 'Extending',
              items: [
                { label: 'Extending Awaitly', slug: 'guides/extending-awaitly' },
              ],
            },
          ],
        },
        {
          label: 'Patterns',
          items: [
            { label: 'Checkout Flow', slug: 'patterns/checkout-flow' },
            { label: 'Safe Payment Retries', slug: 'patterns/payment-retries' },
            { label: 'Resource Management', slug: 'patterns/resource-management' },
            { label: 'Parallel Operations', slug: 'patterns/parallel-operations' },
            { label: 'Error Recovery', slug: 'patterns/error-recovery' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Circuit Breaker', slug: 'advanced/circuit-breaker' },
            { label: 'Rate Limiting', slug: 'advanced/rate-limiting' },
            { label: 'Saga / Compensation', slug: 'advanced/saga-compensation' },
            { label: 'Webhooks & Events', slug: 'advanced/webhooks' },
            { label: 'Single-flight', slug: 'advanced/singleflight' },
            { label: 'OpenTelemetry', slug: 'advanced/opentelemetry' },
            { label: 'Production Deployment', slug: 'advanced/production-deployment' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Quick Reference', slug: 'reference/quick-reference' },
            { label: 'API', slug: 'reference/api' },
            { label: 'Slug Spine', slug: 'reference/spine' },
          ],
        },
        {
          label: 'Rules',
          items: [
            { label: 'Rule Index', slug: 'rules' },
          ],
        },
        {
          label: 'Comparison',
          items: [
            { label: 'Overview', slug: 'comparison' },
            { label: 'vs Promises', slug: 'comparison/awaitly-vs-promise' },
            { label: 'vs try/catch', slug: 'comparison/awaitly-vs-try-catch' },
            { label: 'vs neverthrow', slug: 'comparison/awaitly-vs-neverthrow' },
            { label: 'vs Effect', slug: 'comparison/awaitly-vs-effect' },
            { label: 'vs Vercel Workflow', slug: 'comparison/awaitly-vs-workflow' },
            { label: 'Effect layers in awaitly', slug: 'comparison/effect-layers-in-awaitly' },
            { label: 'Errors deserve better', slug: 'comparison/errors-deserve-better-in-awaitly' },
          ],
        },
      ],
    }),
  ],
  vite: {
    resolve: {
      alias: {
        "~/components": fileURLToPath(new URL("./src/components", import.meta.url)),
        tslib: require.resolve("tslib"),
      },
      tsconfigPaths: false,
    },
    // @ts-expect-error Tailwind Vite plugin types target Vite 7; Astro uses Vite 6. Runtime compatible.
    plugins: [tailwindcss()],
  },
});
