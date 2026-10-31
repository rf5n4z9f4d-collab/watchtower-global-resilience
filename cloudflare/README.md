# WATCHTOWER — Cloudflare Free Migration

STATUS: Source code is staged only on feature/cloudflare-free-migration. No Cloudflare Worker, D1, OneSignal account, or paid resource has been created. Render main remains untouched.

## Architecture

- Cloudflare Workers static assets host the existing mobile dashboard.
- GET /api/alerts and /api/status read normalized incident records from D1.
- Cron runs each minute and polls one of eight official feeds round-robin; each feed is checked about every 8 minutes if the schedule runs normally.
- D1 records feed health, 30 days of incident history, first-seen timestamps, retry status, and stable notification UUIDs.
- An initial source read seeds history without sending notifications.
- OneSignal Web SDK v16 delivers optional worldwide grouped alerts (high and critical only), using five group tags and one minimum-severity tag. Nearby targeting remains disabled.

## Free-tier constraints — checked October 31, 2026

Cloudflare Workers Free: 100,000 requests/day, 10ms CPU time per invocation including Cron, up to 50 subrequests per invocation. Parsing large JSON/XML may exceed 10ms and cause missed checks.
Cloudflare D1 Free: 5 million rows read/day, 100,000 written/day, 5GB total storage. When free limits are exceeded D1 rejects requests.
OneSignal Free: web push to up to 10,000 subscribers per send and six data tags. We use all six. There is no delivery guarantee.
No free platform is an emergency-grade service-level agreement. Keep official government and local alerts enabled.

## Manual setup (no paid resources needed)

1. Get a Cloudflare Free account; do not upgrade or enter billing details unless you choose to.
2. Clone the feature/cloudflare-free-migration branch from https://github.com/rf5n4z9f4d-collab/watchtower-global-resilience
3. From the cloudflare directory run: npm install ; npm run check
4. Sign in with: npx wrangler login
5. Create a free D1 database: npx wrangler d1 create watchtower-free
6. Replace the placeholder all-zero UUID 00000000-0000-0000-0000-000000000000 in cloudflare/wrangler.jsonc with the returned real database UUID. Do not deploy before replacing it.
7. Apply schema: npx wrangler d1 migrations apply watchtower-free --remote
8. Publish a push-disabled preview: npx wrangler deploy. Check /api/status, /api/alerts and /api/push/config on the new workers.dev URL. Keep Render running.
9. Create a separate OneSignal FREE Web Push app for this exact HTTPS workers.dev origin. Existing subscriptions on Render will not transfer across origins.
10. Set the public OneSignal App ID in the Wrangler vars field ONESIGNAL_APP_ID. Store the private REST API Key ONLY with: npx wrangler secret put ONESIGNAL_REST_API_KEY
11. Configure OneSignal Custom Code web setup and the service-worker path /OneSignalSDKWorker.js on the same origin.
12. Keep PUSH_ENABLED=false until you have verified the OneSignal app, service worker, origin and plan. To enable, change the Wrangler setting to true and deploy again.
13. On an eligible iPhone, open Safari and use Share → Add to Home Screen, launch the installed app, choose alert groups, grant notification permission.
14. Test a real message from the OneSignal dashboard to the subscribed device. Verify delivery with the web app closed, unsubscribe, and retry/restart behavior. There is intentionally NO unauthenticated public push-test API.
15. Monitor for at least a week with npx wrangler tail and Cloudflare CPU/D1 analytics before depending on the system for situational awareness.

## Push groups and six Free-plan user data tags

wt_disasters: Earthquake, Climate & disasters, Humanitarian
wt_utilities: Power & energy, Water, Communications
wt_foodhealth: Food & supply, Healthcare
wt_cyber: Cyber & data
wt_security: Military & security (travel advisories)
wt_min: minimum severity: moderate, high, or critical

Group subscriptions are broader than individual categories: selecting a group opts into all of its categories. Nearby-only delivery is disabled. The dashboard still supports individual category filtering, separate from notification preferences.

## Known limitations and protections

- Current incident feeds are not comprehensive water outages, 911 outages, hospital shutdowns, grid failures, information leaks, or active military operations.
- Source HTTP response sizes are capped at 1.5MB; feeds that exceed this are marked unavailable/stale rather than silently reporting an all-clear.
- CPU limits, source outages, rate limits and delayed publication can result in missed notifications.
- Worker remembers accepted sends and reuses a persisted random idempotency UUID when retrying OneSignal calls. An accepted send still does not guarantee delivery to the device.
- All REST credentials remain secret on the Worker, never in the public repository or browser.
- Existing Render site and its GitHub main branch remain unchanged until you explicitly approve a cutover.
- Do not insert sponsored content into alert severity or notification prioritization.

Local-only tests: npm run check. Local schema: npm run migrateLocal. Local Worker: npm run dev. To simulate schedules locally: npx wrangler dev --test-scheduled.

Official documentation:
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/workers/configuration/cron-triggers/
https://developers.cloudflare.com/workers/static-assets/
https://documentation.onesignal.com/docs/en/web-sdk-reference
https://documentation.onesignal.com/reference/create-message
https://documentation.onesignal.com/reference/idempotent-notification-requests
https://onesignal.com/pricing
