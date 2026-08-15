# RingCentral team chat → AccuLynx leads

Takes the lead intake forms that get posted into RingCentral team chat and
creates matching leads in AccuLynx.

**Status: working, tested against a separate AccuLynx test company, not yet
run against production.** The full chain — read chat, parse intake, create the
contact, create the job, stamp it for deduplication, skip it on the next run —
has been exercised end to end with live credentials.

## Where the leads come from

Intake gets posted into private RingCentral **team chat** channels as a
structured form:

```
Customer Name: Gregory Barnett
Phone: 5613692032
Email: Barnett.Greg89@gmail.com
Property Address: 1520 S 24th Ct, Riviera Beach, FL 33404
Reason for Call: he is looking for a terrace roof
Problem or Request: he is asking for somebody to reach out for the estimate
Lead Source: previous client
Notes: looking for an estimate
```

The channel determines the work type, so no guessing is needed:

| Channel | Work type |
| --- | --- |
| `SB \| Re Roof` | Reroof |
| `SB \| Sales Leads & Follow-Up` | Reroof |
| `SB \| Repairs & Active Leaks` | Service / Repair |

Those channels also carry ordinary conversation, so only posts containing
`Customer Name:` are treated as leads.

## What has actually been verified

Checked against RingCentral's and AccuLynx's own published specs, not assumed:

**RingCentral**

- Team chat is the Team Messaging API (`/team-messaging/v1/...`), a different
  system from the message store that holds voicemail, SMS and fax.
- The required app scope is **`TeamMessaging`** (legacy name `Glip`).
  `ReadMessages` is the message store and is the wrong scope here.
- An app scope alone is not sufficient: the user whose JWT is used must also
  hold a role with the matching user permission.
- Real-time delivery is possible — webhook subscriptions support the
  `/team-messaging/v1/posts` event filter, emitting `PostAdded`.

**AccuLynx** (API V2, `https://api.acculynx.com/api/v2`, bearer auth)

- There is no create-lead endpoint. A lead is a **job** created in the
  `Lead (Unassigned)` milestone via `POST /jobs`.
- `POST /jobs` requires `contact: { id }` — a reference to an existing
  contact. The contact has to be created first via `POST /contacts`.
- ID types are not uniform. `workType.id` and `jobCategory.id` are
  **integers**; `leadSource.id` and `tradeTypes[].id` are **UUIDs**.
- Addresses differ between the two endpoints. `POST /contacts` takes
  `state: { id: <int> }` and `country: { id: <int> }`; `POST /jobs` takes
  `state: "FL"` and `country: "US"` as plain strings.
- `locationAddress` is all-or-nothing: supply the object and `street1`,
  `city`, `state`, `country` and `zipCode` are all required.
- Phone numbers must be exactly 10 digits (`^\d{10}$`) — no spaces, dashes,
  parentheses or country code.
- `notes` is capped at 1000 characters.
- Writes are rate limited (`company-write:hourly`, `company-write:daily`) and
  return 429 with `Retry-After`.

## Running it

From the Actions tab, **Sync leads**:

| Input | Meaning |
| --- | --- |
| `apply` | `false` (default) prints what would be created and writes nothing |
| `lookback_days` | how far back to read chat |
| `target` | `test` (default) or `production` — which AccuLynx company to write to |

Both defaults are the safe ones. Writing to production takes two deliberate
changes, not one.

An API key is bound to a single AccuLynx company, so the test company has its
own key in `ACCULYNX_API_KEY_TEST`. Contact types, work types and job
categories came back identical from both companies — they are AccuLynx system
defaults — so a test run exercises the production mapping for everything
except lead sources, which are configured per company and held separately.

## Deduplication

Each job is stamped with the RingCentral post that produced it, via
`POST /jobs/external-references`, and every run asks AccuLynx whether a post
already became a job before creating anything. The CRM holds the leads, so it
is the honest place to ask — a tracker kept in this repo could drift from
reality, and drift means duplicate customer records.

Two failure modes are handled deliberately:

- **A failed lookup skips the lead** rather than creating it. Failing open
  would duplicate a lead already in the CRM.
- **A job created but not stamped** is reported loudly with its ID, because it
  is real in AccuLynx yet invisible to dedup and would be recreated on the
  next run.

Separately, intake re-posts a lead while chasing it, so the same customer can
appear in several posts days apart. External references dedup by post, not by
person, so leads are also matched on phone plus surname within a run.

## Still to do

- Run against production.
- Decide polling versus webhooks. Polling runs free on a schedule; webhooks
  are near-instant but need somewhere to receive them, which a scheduled
  Action cannot provide. RingCentral's per-channel Zapier add-in could bridge
  that.
- Optionally assign each lead an owner by department — leads currently land in
  Lead (Unassigned) regardless of which channel they came from.

## Known gaps

- Intake posts do not always fill every field — `Urgency`, `Assigned To` and
  `Best Callback Time` are frequently blank.
- Two different customers were seen sharing one phone number in intake, which
  would produce uncallable leads. Worth checking where that number comes from
  before automating.
- Customers who call and hang up without leaving a voicemail never reach team
  chat at all. They exist only in the RingCentral call log, which nothing here
  reads.
