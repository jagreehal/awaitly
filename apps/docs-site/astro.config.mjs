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
// https://astro.build/config
export default defineConfig({
  site: 'https://jagreehal.github.io',
  // Use base path for GitHub Pages deployment (https://jagreehal.github.io/awaitly/).
  // Local dev uses /awaitly by default so you can catch production issues; use pnpm dev:root or BASE=/ pnpm dev to run from /.
  base: process.env.BASE || '/awaitly',
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
            href: (process.env.BASE || '/awaitly').replace(/\/?$/, '/'),
          },
        },
      ],
      favicon: '/favicon.svg',
      logo: {
        src: './public/logo-animated.svg',
        alt: 'awaitly',
      },
      customCss: ['./src/styles/global.css'],
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
            { label: 'Handling Errors', slug: 'getting-started/error-handling' },
          ],
        },
        {
          label: 'Foundations',
          items: [
            { label: 'Overview', slug: 'foundations' },
            { label: 'Result Types', slug: 'foundations/result-types' },
            { label: 'Workflows and Steps', slug: 'foundations/workflows-and-steps' },
            { label: 'Control Flow', slug: 'foundations/control-flow' },
            { label: 'Errors and Retries', slug: 'foundations/error-handling' },
            { label: 'State and Resumption', slug: 'foundations/state-and-resumption' },
            { label: 'Streaming', slug: 'foundations/streaming' },
            { label: 'Tagged Errors', slug: 'foundations/tagged-errors' },
            { label: 'Step', slug: 'foundations/step' },
            { label: 'Workflows', slug: 'foundations/workflows' },
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
                { label: 'Framework Integrations', slug: 'guides/framework-integrations' },
                { label: 'React Query Integration', slug: 'guides/react-query' },
                { label: 'AI Integration Patterns', slug: 'guides/ai-integration' },
              ],
            },
            {
              label: 'Tooling',
              items: [
                { label: 'Static Analysis', slug: 'guides/static-analysis' },
                { label: 'Visualization', slug: 'guides/visualization' },
                { label: 'Documenting Workflows', slug: 'guides/documenting-workflows' },
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
                { label: 'Dependency Binding', slug: 'guides/dependency-binding' },
                { label: 'Functional Utilities', slug: 'guides/functional-utilities' },
                { label: 'Migration Guide', slug: 'guides/migration' },
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
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Circuit Breaker', slug: 'advanced/circuit-breaker' },
            { label: 'Rate Limiting', slug: 'advanced/rate-limiting' },
            { label: 'Saga / Compensation', slug: 'advanced/saga-compensation' },
            { label: 'Webhooks & Events', slug: 'advanced/webhooks' },
            { label: 'Policies', slug: 'advanced/policies' },
            { label: 'OpenTelemetry', slug: 'advanced/opentelemetry' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Quick Reference', slug: 'reference/quick-reference' },
            { label: 'API', slug: 'reference/api' },
          ],
        },
        {
          label: 'Comparison',
          items: [
            { label: 'Overview', slug: 'comparison' },
            { label: 'vs try/catch', slug: 'comparison/awaitly-vs-try-catch' },
            { label: 'vs neverthrow', slug: 'comparison/awaitly-vs-neverthrow' },
            { label: 'vs Effect', slug: 'comparison/awaitly-vs-effect' },
            { label: 'vs Vercel Workflow', slug: 'comparison/awaitly-vs-workflow' },
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
    },
    plugins: [tailwindcss()],
  },
});
