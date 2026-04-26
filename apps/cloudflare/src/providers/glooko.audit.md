# Glooko Driver Audit (nightscout-connect)

Source references:
- `lib/sources/glooko/index.js`
- `README.md` (Glooko env vars)

## Endpoints Observed

- Login: `/api/v2/users/sign_in`
- Readings: `/api/v2/cgm/readings`
- Additional endpoints used by upstream for treatments (not required for BG-only provider):
  - `/api/v2/foods`
  - `/api/v2/insulins`
  - `/api/v2/pumps/scheduled_basals`
  - `/api/v2/pumps/normal_boluses`
  - `/api/v2/external/pumps/settings`

## Authentication Style

- Session login via email/password POST body:
  - `userLogin.email`
  - `userLogin.password`
- Upstream captures `set-cookie` from login response and replays it on subsequent GET requests.
- Patient code used in query parameters is read from `session.user.userLogin.glookoCode`.

## Request / Response Shape Notes

- Upstream request query uses:
  - `patient=<glookoCode>`
  - `startDate=<iso>`
  - `endDate=<iso>`
  - `lastGuid=<guid>`
  - `lastUpdatedAt=<iso>`
  - `limit=<count>`
- Upstream typically receives a payload with `readings` array from `/api/v2/cgm/readings`.
- Existing upstream transformer in plugin mostly handles treatment conversion; it does not directly map glucose entries to Nightscout in this module.

## Polling / Backoff (Plugin-Specific)

- Upstream runtime uses external scheduler loops and retry backoff.
- This project extraction intentionally does NOT include timers/backoff.

## Environment Variables in Upstream

- `CONNECT_SOURCE=glooko`
- `CONNECT_GLOOKO_EMAIL`
- `CONNECT_GLOOKO_PASSWORD`
- `CONNECT_GLOOKO_TIMEZONE_OFFSET`
- `CONNECT_GLOOKO_ENV` (`default`, `eu`, `development`, `production`)
- `CONNECT_GLOOKO_SERVER` (overrides env-derived server)

## Adaptation Decisions in This Project

- Inject plain config object into the driver; no `process.env` reads.
- Return normalized BG readings in project-native shape:
  - `{ timestamp: Date, sgv: number, direction?: string, device?: string, source: "glooko" }`
- Keep module independently testable by allowing dependency-injected `fetch` and `now()`.
