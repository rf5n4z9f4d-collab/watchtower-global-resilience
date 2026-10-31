# WATCHTOWER — Global Resilience Monitor

Live preview: **https://watchtower-global-resilience.onrender.com**

An independent global disaster and infrastructure-risk information dashboard. WATCHTOWER collects selected public-source incidents and advisories and displays source status transparently. It is **not** an official emergency alert or all-hazards warning service.

## Features

- Responsive phone/desktop information dashboard.
- Eight server-side public source integrations: GDACS global disaster alerts, USGS earthquakes, U.S. NWS weather warnings, NOAA SWPC space weather, U.S. FDA food recalls, CISA exploited vulnerability catalog, State Department travel advisories, and CDC travel-health notices.
- Search and filter by severity and category, with links to source evidence.
- Approximate event map for geolocated earthquake/disaster reports. **Not an outage map.**
- Source-status health checks and clear "unavailable" or "stale" indicators. Absence of records is not proof of safety.
- Preparedness calculator (one gallon drinking water per person per day, three food portions per person per day) and local browser checklist.
- iPhone Home Screen web-app support and browser push notification UI. Push is **disabled until server credentials and permanent database storage are configured**.

## Local setup

Install Node.js 20 or newer:

```sh
npm install
npm start
```

Open http://localhost:3000

API health: `GET /api/status`
Latest normalized feed entries: `GET /api/alerts`
Push capability: `GET /api/push/config`

## Hosting

This repository is connected to a **free Render web service** in Ohio. Code updates on `main` deploy automatically. The free service may sleep when idle and is **not** suitable for guaranteed unattended notification monitoring.

Render service: https://dashboard.render.com/web/srv-dbj644jbc2fs73buen0g

### Enable actual mobile push (not active in the free preview)

1. Choose an **always-on** Render web-service plan. Confirm current charges before upgrading.
2. Provision a **persistent PostgreSQL** service and set `DATABASE_URL` as a Render secret environment variable. The Node server creates two `wt_*` tables on startup.
3. Generate an ECDSA P-256 VAPID key pair using a Web Push library. Set the secret environment variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a valid `mailto:` contact). Never commit secrets to GitHub.
4. Set `NODE_ENV=production`. Verify `/api/push/config` shows `configured:true` and `persistent:true`.
5. On iPhone, open WATCHTOWER in Safari, choose **Share → Add to Home Screen**, launch the Home Screen icon, enable notifications and test on the actual device.

Only events newly appearing after the worker starts, with event timestamps within the last 20 minutes, are eligible for push. Existing feed entries are not replayed on initial startup. The server checks feeds approximately every 2 minutes while it is running. Notifications are opt-in by category/severity, with optional point-based nearby matching and a 20-per-day delivery cap. Nearby matching is incomplete for polygon-only or unlocated alerts, and source outages can delay or prevent delivery. Successful Web Push API acceptance does not guarantee delivery on the phone.

**Current limitation:** The database-backed duplicate suppression is persistent, but feed-event priming is held in application memory, so reboots and missed feed windows can affect which new events are eligible. The worker is useful for situational awareness only, not a safety-critical notification system.

## Source interpretation

The coverage is **partial**:
- Reported earthquakes do not confirm damaged infrastructure.
- GDACS ranks potential humanitarian impact, not confirmed utility outages.
- NOAA SWPC forecasts risks to power and communications but does not report verified local outages.
- FDA product recalls are not food shortages.
- CISA exploited vulnerabilities do not indicate a specific system has been breached.
- Worldwide 911 failures, water system outages, hospital outages, military developments and leaks are **not comprehensively monitored** by these eight feeds. The State Department and CDC sources publish travel advisories, not live military incidents or hospital disruptions. Some weather bulletins may mention water or telecommunications, but those are not a substitute for authoritative local feeds.

Source data is shown with attribution, may be delayed, and could be unavailable due to upstream network errors or provider changes. Keep local official Wireless Emergency Alerts, emergency radio, and provider notifications enabled. If you are in immediate danger, follow local emergency authorities rather than this website.

## Security

Push subscriptions require browser-supplied origin and push subscription keys. Server-side secrets should be set only through Render's secret environment settings. Use HTTPS, review deployment logs, and test notification functionality directly from a real phone before relying on it.
