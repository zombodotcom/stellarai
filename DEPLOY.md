# Deploying StellarAI

One-time setup:

```sh
npx wrangler login        # opens a browser; authorize Cloudflare
```

Then, from the repo root:

```sh
npm run deploy
```

That rebuilds the star catalog from the cached AT-HYG download (first run
downloads ~70 MB from Codeberg), builds the site, and publishes it to
Cloudflare Pages as the `stellarai` project. First deploy creates the
project and prints the public URL (stellarai.pages.dev).

Costs nothing: Cloudflare Pages' free tier has unlimited bandwidth and
500 builds/month, and this site is static files — no server, no database,
no API keys. The catalog chunks (~23 MB total) are served with Pages'
standard CDN compression.

To wire continuous deploys later, connect the GitHub repo to the Pages
project in the Cloudflare dashboard; every push to main then publishes
automatically with `npm run build-catalog -w @stellarai/pipeline && npm
run build -w @stellarai/web` as the build command and `apps/web/dist` as
the output directory.
