// Cloudflare Pages Function — validated ADQL passthrough to the ESA Gaia TAP
// service. Exists because the browser cannot reach TAP directly (CORS), and
// because model-authored ADQL must be validated against an allowlist before
// it leaves our infrastructure. Implemented in Phase 6.
export const onRequestPost: PagesFunction = async () =>
  new Response('Not implemented until Phase 6', { status: 501 })
