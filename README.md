# Workers smoke test

`scripts/workerd-smoke.sh` is the standing Cloudflare Workers check for a PR that touches the root shell or SSR. It builds with `NODE_OPTIONS=--max-old-space-size=4096`, boots `.output/server/wrangler.json` under a pinned Wrangler (`wrangler dev --local`), and curls `/`, `/apply`, `/apply?t=x`, `/thank-you?t=x`, `/sign/abc`, `/card/abc?t=x`, `/login`, `/invite`, `/admin`, and an unknown path.

The run fails on any HTTP 5xx, or when the workerd log contains `EvalError` or `Code generation from strings` (`new Function` / `eval` at module scope). It prints whether `googletagmanager` appears on each route. Supabase env values are dummies pointed at `http://127.0.0.1:9`. The script always kills the wrangler and workerd process tree and removes its temp dir.

Wrangler is pinned to 4.151.3, which runs on Node 22 or newer. On an older Node the script fetches a local Node 22. If that download fails it falls back to an older Wrangler with `--compatibility-date` and prints a loud warning, because that date is not the one in the production worker config.

```bash
bash scripts/workerd-smoke.sh
```

The default readiness run does not start workerd. Opt in with:

```bash
WORKERD_SMOKE=1 bash scripts/readiness-test.sh
```
