// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import starlightThemeNext from 'starlight-theme-next';
import tailwindcss from '@tailwindcss/vite';
import astroMermaid from 'astro-mermaid';
import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  site: 'https://jagreehal.github.io',
  // Use base path for GitHub Pages deployment
  // For local development, you can override with: BASE=/ pnpm dev
  base: process.env.BASE || '/awaitly',
  integrations: [
    preact(),
    sitemap(),
    astroMermaid(),
    starlight({
      title: 'awaitly',
      description: 'Typed async workflows with Result types and automatic error inference',
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
          label: 'Playground',
          slug: 'playground',
          attrs: { class: 'sidebar-playground' },
        },
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
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Results', slug: 'concepts/results' },
            { label: 'Steps', slug: 'concepts/step' },
            { label: 'Workflows', slug: 'concepts/workflows' },
            { label: 'Tagged Errors', slug: 'concepts/tagged-errors' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Retries & Timeouts', slug: 'guides/retries-timeouts' },
            { label: 'Caching', slug: 'guides/caching' },
            { label: 'Persistence', slug: 'guides/persistence' },
            { label: 'Streaming', slug: 'guides/streaming' },
            { label: 'Human-in-the-Loop', slug: 'guides/human-in-loop' },
            { label: 'Visualization', slug: 'guides/visualization' },
            { label: 'Static Analysis', slug: 'guides/static-analysis' },
            { label: 'Testing', slug: 'guides/testing' },
            { label: 'Batch Processing', slug: 'guides/batch-processing' },
            { label: 'ESLint Plugin', slug: 'guides/eslint-plugin' },
            { label: 'Claude Code Skill', slug: 'guides/claude-skill' },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
            { label: 'Framework Integration', slug: 'guides/framework-integration' },
            { label: 'Extending Awaitly', slug: 'guides/extending-awaitly' },
            { label: 'Dependency Binding', slug: 'guides/dependency-binding' },
            { label: 'Functional Utilities', slug: 'guides/functional-utilities' },
            { label: 'Migration Guide', slug: 'guides/migration' },
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
    plugins: [tailwindcss()],
  },
});
