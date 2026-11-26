# Deploy WebDAV on Cloudflare

1. Install the project's dependencies with `npm ci` and sign in with `npx wrangler login`.
2. Create an R2 bucket with `npx wrangler r2 bucket create r2-webdav`. If you choose a different name, set it in `r2_buckets[0].bucket_name` in your Wrangler config. Keep the binding name `bucket`. Leave public access to the bucket disabled.
3. Copy `wrangler.jsonc` to `wrangler.production.local.jsonc`. In the copy, set `workers_dev` to `true` for a `workers.dev` address, or add a [Worker custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
4. Create `secrets.local.json` with the production `USERNAME` and `PASSWORD` values. Use a strong password and keep this file on your machine. Git ignores both local files.
5. Deploy the Worker and its secrets together.

   ```sh
   npm run deploy -- --config wrangler.production.local.jsonc --secrets-file secrets.local.json
   ```

In a browser or WebDAV client, use your Worker’s HTTPS address and the credentials you set. The service path is `/`. The browser accepts individual files smaller than 100 MB.

To verify a local instance with `npm run test:protocol`, keep `npm run dev` running. Set `WEBDAV_LARGE_MB=90` to include a 90 MiB round trip. The script creates and removes a temporary test directory.
