// Cloudflare Pages Function — streaming proxy to the Claude Messages API.
// Sole holder of ANTHROPIC_API_KEY; the key never reaches the client bundle.
// Implemented in Phase 4.
export const onRequestPost: PagesFunction = async () =>
  new Response('Not implemented until Phase 4', { status: 501 })
