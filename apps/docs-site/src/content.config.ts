import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

/**
 * Generate a stable, unique id from the entry path only (no frontmatter).
 * Ensures consistent path normalization and avoids duplicate-id warnings
 * when the default slug would collide (e.g. path separator or legacy id handling).
 * Strips trailing "/index" so directory index pages match Starlight sidebar slugs (e.g. "foundations").
 */
function generateDocId({
  entry,
}: {
  entry: string;
  base: URL;
  data: Record<string, unknown>;
}): string {
  const withoutExt = entry.replace(/\.[^.]+$/, '');
  const normalized = withoutExt.replace(/\\/g, '/');
  return normalized.replace(/\/index$/, '') || 'index';
}

export const collections = {
  docs: defineCollection({
    loader: docsLoader({ generateId: generateDocId }),
    schema: docsSchema(),
  }),
};
