import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file per post in src/content/writing. Files starting with _ are ignored (templates).
const writing = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['journey', 'technical']),
    tags: z.array(z.string()).default([]),
    // slug of a case study in src/data/site.ts, linked at the end of the post
    project: z.string().optional(),
    // drafts show in `npm run dev` and are left out of the built site
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing };
