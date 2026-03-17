# smoke-signal

> Get the signal when a campsite opens up.

## Overview

A lightweight campsite availability watchdog that monitors Recreation.gov (and later ReserveCalifornia) for cancellations and reservation window openings, sending push notifications via ntfy.sh. Runs entirely on Cloudflare Workers for free.

---

## Data Sources

### Recreation.gov

Two relevant APIs:

1. **RIDB API** (`ridb.recreation.gov/api/v1/`) — Free API key, provides campground/campsite metadata (names, types, loops, coordinates, amenities). Good for initial setup and searching for facility IDs.

2. **Availability API** (undocumented but stable, widely used by open-source tools) — Returns per-campsite, per-day availability for a whole month:
   ```
   GET https://www.recreation.gov/api/camps/availability/campground/{facilityId}/month?start_date=2026-07-01T00:00:00.000Z
   ```
   Response shape per campsite:
   ```json
   {
     "availabilities": {
       "2026-07-01T00:00:00Z": "Reserved",
       "2026-07-02T00:00:00Z": "Available",
       "2026-07-03T00:00:00Z": "Not Available"
     },
     "campsite_id": "7859",
     "campsite_type": "STANDARD NONELECTRIC",
     "loop": "NORTH PINES",
     "site": "042",
     "type_of_use": "Overnight",
     "min_num_people": 1,
     "max_num_people": 6
   }
   ```
   **Rate limiting:** Be respectful. Headers include `User-Agent` check. Use a reasonable UA string, don't hammer it. Checking every 15–30 minutes for a handful of campgrounds is fine. The existing open-source checkers (banool/recreation-gov-campsite-checker, etc.) suggest 5-minute cron intervals are tolerable, but we'll start conservative.

### Future: ReserveCalifornia

Runs on Aspira's platform. Less documented, would likely need to reverse-engineer their XHR calls. Architecture should abstract the "availability provider" so adding this later is a plugin.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Cloudflare Account                  │
│                                                      │
│  ┌──────────────┐   Cron Triggers   ┌────────────┐  │
│  │              │◄──────────────────►│            │  │
│  │   Worker:    │                    │  D1 (SQL)  │  │
│  │   checker    │───── reads ───────►│            │  │
│  │              │───── writes ──────►│  watches   │  │
│  │              │                    │  history   │  │
│  └──────┬───────┘                    │  config    │  │
│         │                            └────────────┘  │
│         │  fetch()                                    │
│         ▼                                            │
│  Recreation.gov API                                  │
│                                                      │
│         │ availability changed?                      │
│         ▼                                            │
│  ┌──────────────┐        ┌───────────────────────┐  │
│  │  Notifier    │───────►│ ntfy.sh (push)        │  │
│  │  (module)    │        │ email (Phase 2)        │  │
│  └──────────────┘        └───────────────────────┘  │
│                                                      │
│  ┌──────────────┐        ┌───────────────────────┐  │
│  │   Worker:    │◄───────│ Cloudflare Access      │  │
│  │   api/ui     │  auth  │ (zero-trust gateway)   │  │
│  └──────────────┘        └───────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Why D1 over KV?

We need to query watches by date range, filter history, and do relational lookups (which campsites belong to which watch). D1 is free on Cloudflare (5M reads/day, 100K writes/day on free tier) and supports SQL. KV would work but you'd end up reimplementing queries in JS.

---

## Data Model (D1 Schema)

```sql
-- Campgrounds the user wants to track
CREATE TABLE watches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT NOT NULL DEFAULT 'recreation_gov',  -- abstraction point
  facility_id  TEXT NOT NULL,       -- e.g. "232450" for Lower Pines
  facility_name TEXT,               -- human-readable
  start_date   TEXT NOT NULL,       -- ISO date "2026-07-04"
  end_date     TEXT NOT NULL,       -- ISO date "2026-07-06"
  -- Filters (nullable = "any")
  site_ids     TEXT,                -- JSON array of specific site IDs, or null
  site_types   TEXT,                -- JSON array: ["STANDARD NONELECTRIC", "TENT ONLY NONELECTRIC"]
  loop_name    TEXT,                -- filter to specific loop
  -- Notification prefs
  notify_push     INTEGER DEFAULT 1,
  notify_email    INTEGER DEFAULT 0,  -- Phase 2: email via Resend
  -- State
  active       INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- Reservation window reminders
CREATE TABLE reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT NOT NULL DEFAULT 'recreation_gov',
  facility_id  TEXT NOT NULL,
  facility_name TEXT,
  target_date  TEXT NOT NULL,       -- first night of intended stay
  nights       INTEGER DEFAULT 1,   -- intended length of stay (for notification context)
  window_months INTEGER DEFAULT 6,  -- how far in advance reservations open
  remind_days_before INTEGER DEFAULT 3,  -- alert N days before window opens
  notified     INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Tracks what we last saw, to detect transitions
CREATE TABLE availability_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id     INTEGER REFERENCES watches(id),
  campsite_id  TEXT NOT NULL,
  check_date   TEXT NOT NULL,       -- the camping date
  status       TEXT NOT NULL,       -- "Available", "Reserved", "Not Available"
  captured_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(watch_id, campsite_id, check_date)  -- upsert target
);

-- Log of notifications sent (dedup + history)
CREATE TABLE notification_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id     INTEGER REFERENCES watches(id),
  campsite_id  TEXT,
  check_date   TEXT,
  event_type   TEXT NOT NULL,       -- "cancellation_found", "window_reminder"
  channel      TEXT NOT NULL,       -- "ntfy", "email"
  sent_at      TEXT DEFAULT (datetime('now')),
  payload      TEXT                 -- JSON of what was sent
);
```

---

## Worker Design

### 1. Checker Worker (cron-triggered)

**Cron schedule:** `*/15 * * * *` (every 15 min) — adjustable. Cloudflare free tier gives 100K requests/day; even checking 10 campgrounds every 15 min = ~960 API calls/day, well within limits.

**Flow:**

```
scheduled() handler:
  1. Query D1 for all active watches
  2. Group watches by (provider, facility_id, month) to minimize API calls
     - If watch covers July 4-6, we only need the July month endpoint
     - If watch covers June 28 - July 3, we need both June and July
  3. For each unique (facility_id, month):
     a. fetch() recreation.gov availability API
     b. Parse response
  4. For each watch:
     a. Filter campsites by watch criteria (site_ids, site_types, loop)
     b. For each (campsite, date) in the watch range:
        - Compare current status to availability_snapshots
        - If status changed FROM non-Available TO "Available":
          → This is a cancellation! Queue notification.
        - Upsert availability_snapshots with new status
  5. Check reminders table:
     a. For each un-notified reminder:
        - Calculate: window_open_date = target_date - window_months
        - If today >= window_open_date - remind_days_before:
          → Queue reminder notification, mark notified=1
  6. Send all queued notifications (batch)
  7. Log to notification_log (dedup: don't re-notify same campsite+date+watch within 1 hour)
```

### 2. Provider Abstraction

```typescript
// src/providers/types.ts
interface CampsiteAvailability {
  campsiteId: string;
  siteName: string;
  siteType: string;
  loop: string;
  date: string;           // ISO date
  status: "Available" | "Reserved" | "NotAvailable" | "Unknown";
  minPeople?: number;
  maxPeople?: number;
}

interface AvailabilityProvider {
  name: string;
  fetchAvailability(
    facilityId: string,
    month: Date
  ): Promise<CampsiteAvailability[]>;
  searchFacilities?(query: string): Promise<Facility[]>;
}

// src/providers/recreation-gov.ts
// src/providers/reserve-california.ts  (future)
```

### 3. Notification Module

```typescript
// src/notifications/types.ts
interface NotificationChannel {
  name: string;
  send(message: NotificationMessage): Promise<void>;
}

interface NotificationMessage {
  title: string;
  body: string;
  url?: string;          // deep link to recreation.gov booking page
  priority?: "low" | "default" | "high" | "urgent";
  tags?: string[];       // ntfy emoji tags like "tent", "fire"
}

// src/notifications/ntfy.ts  (Phase 1 — primary channel)
// Uses: POST https://ntfy.sh/{topic}
// Free tier: 250 messages/day — more than enough
// Auth: topic name acts as secret, or use access tokens
// ntfy also supports 5 emails/day on free tier as a fallback

// src/notifications/email.ts  (Phase 2 — add later if needed)
// Uses: Resend API (free tier: 100 emails/day, 3000/month)
// Only add if you find push notifications aren't enough
```

### 4. Management API/UI Worker

A second worker (or same worker with path routing) that provides:

- `GET  /watches` — list active watches
- `POST /watches` — create a watch
- `PUT  /watches/:id` — update
- `DELETE /watches/:id` — deactivate
- `GET  /watches/:id/history` — recent availability changes
- `POST /reminders` — create a reminder
- `GET  /status` — health check, last run time, notification counts

**Auth via Cloudflare Access (free, zero-trust):**

Cloudflare Access sits in front of your worker URL and handles authentication before requests even reach your code. Free for up to 50 users (you only need 1). Setup:

1. In Cloudflare Zero Trust dashboard → Access → Applications → Add an application
2. Set the application domain to your worker URL (e.g., `smoke-signal.yourdomain.workers.dev`)
3. Add a policy: "Allow" → "Emails" → your email address
4. Choose an identity provider: one-time PIN (email OTP), Google, or GitHub

Once configured, visiting your worker URL from any device prompts a Cloudflare login screen. After authenticating, Cloudflare sets a signed JWT cookie (`CF_Authorization`) and proxies the request to your worker. Your worker doesn't need any auth code — Cloudflare blocks unauthenticated requests at the edge.

**Important:** The cron-triggered `scheduled()` handler is internal and bypasses Access — only HTTP requests (the UI/API) go through it. So your checker keeps running without auth issues.

**UI:** A minimal static HTML page served by the worker with forms for adding watches/reminders and a table showing active watches + recent alerts. Accessible from your phone or laptop, anywhere.

---

## Cost Estimate

| Service | Free Tier | Your Usage | Cost |
|---|---|---|---|
| Cloudflare Worker | 100K req/day | ~1K-2K/day (cron + API calls) | **$0** |
| Cloudflare D1 | 5M reads, 100K writes/day | ~10K reads, ~500 writes/day | **$0** |
| Cloudflare Workers (cron) | Included, 3 triggers/worker | 1-2 triggers | **$0** |
| Cloudflare Access | Free up to 50 users | 1 user | **$0** |
| ntfy.sh | 250 messages/day free | ~5-20/day | **$0** |
| RIDB API key | Free | Metadata lookups | **$0** |
| Recreation.gov availability | No key needed | ~50-100 calls/day | **$0** |

**Total estimated monthly cost: $0**

If you later need the $5/mo Cloudflare Workers Paid plan, it's for higher limits (10M requests/month, 30s CPU time) — unlikely to be needed at personal scale.

---

## Project Structure

```
smoke-signal/
├── wrangler.toml              # Cloudflare Worker config + cron triggers + D1 binding
├── .env.example               # Template for local dev secrets (safe to commit)
├── .gitignore
├── LICENSE                    # MIT
├── README.md
├── src/
│   ├── index.ts               # Worker entry: scheduled() + fetch() handlers
│   ├── checker.ts             # Main checking logic
│   ├── providers/
│   │   ├── types.ts           # AvailabilityProvider interface
│   │   ├── recreation-gov.ts  # Recreation.gov implementation
│   │   └── reserve-california.ts  # Stub for future
│   ├── notifications/
│   │   ├── types.ts           # NotificationChannel interface
│   │   └── ntfy.ts            # ntfy.sh push notifications
│   ├── db/
│   │   ├── schema.sql         # D1 migration
│   │   ├── queries.ts         # Typed query helpers
│   │   └── migrations/        # D1 migration files
│   ├── api/
│   │   ├── router.ts          # Hono or itty-router for management endpoints
│   │   └── handlers.ts        # CRUD for watches, reminders
│   └── utils/
│       ├── dates.ts           # Date math helpers
│       └── dedup.ts           # Notification deduplication
├── ui/                        # Optional: static management UI
│   └── index.html
├── test/
│   ├── checker.test.ts
│   ├── providers/recreation-gov.test.ts
│   └── fixtures/              # Sample API responses
├── package.json
└── tsconfig.json
```

---

## Implementation Order (for Claude Code)

### Phase 1: Core checker (MVP)
1. Set up Wrangler project with D1 binding
2. Write D1 schema + migration
3. Implement `recreation-gov.ts` provider (availability API)
4. Implement core `checker.ts` — fetch, diff, detect cancellations
5. Implement `ntfy.ts` notification channel
6. Wire up `scheduled()` handler with cron trigger
7. Test with a real campground (pick one you care about)

### Phase 2: Management UI + reminders
8. Add management API routes (CRUD watches/reminders)
9. Set up Cloudflare Access for auth
10. Build simple management UI (HTML form + table)
11. Add reminder checking logic
12. Add notification deduplication + logging

### Phase 3: Polish + email
13. Add RIDB facility search to make adding watches easier
14. Add `email.ts` via Resend (if you want email alongside push)
15. Add `reserve-california.ts` provider stub
16. Error handling, retry logic, alerting on checker failures

---

## Key Technical Decisions & Gotchas

**Recreation.gov API headers:** Set a reasonable `User-Agent` (e.g., `smoke-signal/1.0 (personal use)`). The API doesn't require auth for availability but may rate-limit aggressively if you look like a bot. Consider adding a small random jitter (0-60s) to cron runs.

**Month boundary handling:** The availability API returns one month at a time. A watch spanning June 28 – July 5 needs two API calls. Group and deduplicate by (facilityId, month) across all watches to minimize calls.

**Timezone handling:** Recreation.gov returns dates in UTC (midnight). Camping dates are effectively date-only. Store everything as ISO date strings, not timestamps.

**Cloudflare Worker CPU limits:** Free tier has 10ms CPU time limit per invocation (wall clock is much more generous since fetch() is async and doesn't count). Processing a few campgrounds should be well within this. If you scale to many watches, consider splitting work across multiple cron invocations.

**ntfy.sh topic security:** The topic name is effectively a password on the free tier. Use something unguessable like `campsite-{random-uuid}`. Or self-host ntfy on a cheap VPS if you want auth.

**Deduplication strategy:** Don't notify for the same (watch, campsite, date) more than once per hour. Use `notification_log` to check recency before sending.

**Recreation.gov booking deep link:** When you detect availability, include a direct link in the notification:
```
https://www.recreation.gov/camping/campsites/{campsiteId}
```
This lets you immediately tap the notification and book.

---

## Environment Variables (wrangler.toml secrets)

```toml
[vars]
NTFY_TOPIC = "campsite-your-secret-topic"
NTFY_SERVER = "https://ntfy.sh"

# Phase 2+: uncomment when adding email
# NOTIFY_EMAIL = "you@gmail.com"
# RESEND_FROM = "campsite-checker@yourdomain.com"

# Set via `wrangler secret put`
# RESEND_API_KEY = "re_..."  (Phase 3, only if adding email)
```

---

## Open Source & Public Repo

This project will be a **public GitHub repo** under the MIT license.

### Why public?

The existing campsite checker tools on GitHub (banool's Python script, etc.) are popular but all require running on a local machine or VPS. A zero-cost, serverless Cloudflare Worker version fills a real gap. The clean provider abstraction (Recreation.gov now, ReserveCalifornia later) also makes it a useful starting point for others.

### Repo hygiene

**Secrets — never commit these:**
- ntfy topic name (effectively a password on the free tier)
- Resend API key (Phase 3)
- Any Cloudflare API tokens

All secrets should be set via `wrangler secret put` and never appear in `wrangler.toml`. Include a `.env.example` showing the shape without real values:
```
NTFY_TOPIC=smoke-signal-change-me-to-something-random
NTFY_SERVER=https://ntfy.sh
```

**.gitignore should include:**
```
.env
.wrangler/
node_modules/
dist/
```

### README structure

- What it does (one paragraph + screenshot of a notification)
- Quick start: fork → `wrangler secret put` your ntfy topic → deploy → add a watch
- How to find campground/campsite IDs on Recreation.gov
- Architecture overview (link to this plan or inline the diagram)
- Configuration reference (env vars, cron frequency)
- Note on responsible API usage (reasonable intervals, jitter, don't abuse the undocumented endpoint)
- Contributing guide (adding new providers, notification channels)
- Credits / built with Claude Code acknowledgment (optional but cool)

### Responsible use note (for README)

Include a section like:
> **Be a good API citizen.** Recreation.gov's availability endpoint is undocumented and provided as-is. This tool defaults to 15-minute check intervals with random jitter. Please don't decrease the interval below 5 minutes or monitor an unreasonable number of campgrounds. If everyone hammers the API, it'll get locked down and nobody wins.
