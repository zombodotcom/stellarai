import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'

export default defineConfig({
  output: 'static',
  adapter: cloudflare(),
  vite: {
    // Catalog chunks are fetched at runtime, never bundled.
    assetsInclude: ['**/*.bin'],
  },
})
