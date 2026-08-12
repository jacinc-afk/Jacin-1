# RingCentral team chat → AccuLynx leads

Takes the lead intake forms that get posted into RingCentral team chat and
creates matching leads in AccuLynx.

**Status: not built yet.** This repo currently contains a read-only discovery
script and verified notes. The sync itself is blocked on reading the account's
own AccuLynx IDs — see [Next step](#next-step).

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

## Next step

Creating a job means referencing IDs that are specific to this AccuLynx
account. Those have to be read out of the account before the sync can be
written against them.

```bash
ACCULYNX_API_KEY=xxxxx npm run discover
```

Or, to avoid handling the key locally, run the **Discover AccuLynx IDs**
workflow from the Actions tab, which reads it from the `ACCULYNX_API_KEY`
repository secret. Either way the script only issues GET requests and changes
nothing.

Its output supplies the work type IDs for Reroof and Service/Repair, a lead
source ID, and the contact type IDs required by `POST /contacts`.

The lookup paths in `src/discover.js` are inferred from operationIds in
AccuLynx's published OpenAPI index and are not confirmed, so the script tries
each candidate and reports a clean 404 rather than failing silently.

## Then

1. Map the discovered IDs to the three channels.
2. Build the sync: read posts → parse the intake form → `POST /contacts` →
   `POST /jobs` → stamp the RingCentral post ID onto the job as an external
   reference so a post can never produce two leads.
3. Decide polling versus webhooks. Polling runs free on a schedule in Actions;
   webhooks are near-instant but need somewhere to receive them, which a
   scheduled Action cannot provide.

## Known gaps

- Intake posts do not always fill every field — `Urgency`, `Assigned To` and
  `Best Callback Time` are frequently blank.
- Two different customers were seen sharing one phone number in intake, which
  would produce uncallable leads. Worth checking where that number comes from
  before automating.
- Customers who call and hang up without leaving a voicemail never reach team
  chat at all. They exist only in the RingCentral call log, which nothing here
  reads.
