import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'

export default defineConfig({
  output: 'static',
  // The dev toolbar overlays the bottom of the viewport, exactly where the
  // mobile tab bar lives.
  devToolbar: { enabled: false },
  adapter: cloudflare(),
  vite: {
    // Catalog chunks are fetched at runtime, never bundled.
    assetsInclude: ['**/*.bin'],
  },
})
