// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

// Code blocks in the site's own colours: no violet, comments readable at 4.5:1 or better.
const codeTheme = JSON.parse(readFileSync(new URL('./code-theme.json', import.meta.url), 'utf8'));

// https://astro.build/config
export default defineConfig({
  site: 'https://asr222.github.io',
  markdown: {
    shikiConfig: { theme: codeTheme },
  },
});
