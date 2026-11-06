# Workers smoke test

`scripts/workerd-smoke.sh` is the standing Cloudflare Workers check for a PR that touches the root shell or SSR. The build step exports dummy Supabase settings so Vite does not inline a hosted URL from `.env` (process env beats `.env`):

- `VITE_SUPABASE_URL=http://127.0.0.1:9`
- `VITE_SUPABASE_PUBLISHABLE_KEY=x`
- `VITE_SUPABASE_PROJECT_ID=x`
- `SUPABASE_URL=http://127.0.0.1:9`
- `SUPABASE_PUBLISHABLE_KEY=x`

The build uses `NODE_OPTIONS=--max-old-space-size=4096`. After it, the script searches `.output/server` for `supabase.co` and fails on any hit outside `.output/server/_libs/supabase__*.mjs`. Those library chunks are supabase-js and contain its own example hosts (`xyzcompany.supabase.co`, `example.supabase.co`). The app URL is inlined into the other server chunks, which stay in the search. It also fails if the `SUPABASE_URL` host from `.env` appears anywhere in the server bundle.

It then boots `.output/server/wrangler.json` with `wrangler dev --local` and curls:

- `/`, `/apply`, `/apply?t=x`, `/thank-you?t=x`, `/sign/abc`, `/card/abc?t=x`, `/card/00000000-0000-4000-8000-000000000000?t=x`, `/login`, `/invite`, `/admin`, `/fleet`, `/portal`, `/faq`, `/sitemap.xml` — each must return HTTP 200
- `/workerd-smoke-no-such-route` — must return HTTP 404

The run also fails when the workerd log contains `EvalError` or `Code generation from strings` (`new Function` / `eval` at module scope). It prints whether `googletagmanager` appears on each route. Runtime Supabase env values are dummies pointed at `http://127.0.0.1:9`. The script always kills the wrangler and workerd process tree and removes its temp dir.

An existing Wrangler whose version is 4.x is reused (`node_modules/.bin`, `PATH`, or the npm global bin). Otherwise Wrangler is installed at 4.151.3, which runs on Node 22 or newer. On an older Node the script fetches a local Node 22. If that download fails it falls back to an older Wrangler with `--compatibility-date` and prints a loud warning, because that date is not the one in the production worker config.

```bash
bash scripts/workerd-smoke.sh
```

The default readiness run does not start workerd. Opt in with:

```bash
WORKERD_SMOKE=1 bash scripts/readiness-test.sh
```
