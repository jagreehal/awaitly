// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNext from 'starlight-theme-next';
import tailwindcss from '@tailwindcss/vite';
import astroMermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
  site: 'https://jagreehal.github.io',
  // Use base path for GitHub Pages deployment
  // For local development, you can override with: BASE=/ pnpm dev
  base: process.env.BASE || '/awaitly',
  integrations: [
    astroMermaid(),
      starlight({
      title: 'awaitly',
      description: 'Typed async workflows with Result types and automatic error inference',
      customCss: ['./src/styles/global.css'],
      plugins: [starlightThemeNext()],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/awaitly' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Your First Workflow', slug: 'getting-started/first-workflow' },
            { label: 'Handling Errors', slug: 'getting-started/error-handling' },
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
            { label: 'Human-in-the-Loop', slug: 'guides/human-in-loop' },
            { label: 'Visualization', slug: 'guides/visualization' },
            { label: 'Static Analysis', slug: 'guides/static-analysis' },
            { label: 'Testing', slug: 'guides/testing' },
            { label: 'Batch Processing', slug: 'guides/batch-processing' },
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
            { label: 'API', slug: 'reference/api' },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
