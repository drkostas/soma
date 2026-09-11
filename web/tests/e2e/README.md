# Playwright end-to-end checks

`npx playwright test` from `web/` runs the specs in this directory against
`BASE_URL`, which defaults to the public demo (`https://soma-demo.gkos.dev`).

## Where to point it

| Target | `BASE_URL` | Database | Use |
|---|---|---|---|
| Verification server | `http://127.0.0.1:3457` | `verify_soma`, a snapshot of the live database | any run that clicks around, logs meals, or otherwise writes |
| Dev server | `http://127.0.0.1:3456` | `soma`, the live database | hands-on development only |
| Live host or demo | the public address | production | the post-merge check, and nothing else |

The verification server is the launchd job `dev.gkos.soma.web`. Its plist sets
`DATABASE_URL` to `verify_soma` in the job environment, which Next's env loading
does not override with `web/.env.local`, so the same working tree serves the live
database on 3456 and the snapshot on 3457.

Refresh the snapshot with `scripts/verify-db-refresh.sh` (about 40 seconds for
the current database). It drops and recreates only `verify_soma`, restores from a
fresh dump of `soma`, runs `ANALYZE`, and fails loudly if the table or row counts
differ from the source.

```bash
scripts/verify-db-refresh.sh
cd web && BASE_URL=http://127.0.0.1:3457 npx playwright test
```
