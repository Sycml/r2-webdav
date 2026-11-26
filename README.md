# r2-webdav

Browse and manage files in a private Cloudflare R2 bucket through a web interface or a WebDAV client.

The browser supports multiple file uploads, downloads, folder creation, renaming, copying, moving, and deleting files. WebDAV clients can also use file locks.

## Run locally

With Node.js 22 or later, run:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Open [http://localhost:8787/](http://localhost:8787/) and use the example credentials in `.dev.vars`.
See [DEPLOYMENT.md](DEPLOYMENT.md) to configure your Worker, bucket, and production credentials.

## Test

```sh
npm run types
npm run typecheck
npm test
```

With the local server running, `npm run test:protocol` checks WebDAV requests. GitHub Actions also runs the `basic`, `copymove`, `props`, and `locks` suites from [litmus](https://github.com/notroj/litmus).

## License

Apache 2.0. See [LICENSE](LICENSE) and [UPSTREAM.md](UPSTREAM.md) for the source and changes.
