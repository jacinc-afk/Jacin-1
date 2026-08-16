# RingCentral team chat → AccuLynx leads

Takes the lead intake forms that get posted into RingCentral team chat, creates
matching leads in AccuLynx, checks whether the customer has been here before,
and either assigns the lead or asks a human to decide.

## Why

Intake posts a form into a channel. Today somebody reads it and retypes it into
AccuLynx by hand. A live 30-day window measured **97 posts, 36 of them leads** —
about nine a week being retyped.

The retyping is the smaller half. The larger half is the check nobody does:

- **Has this customer worked with us before?** A repair customer coming back
  for a reroof is invisible from inside the reroof company, because each
  department is a *separate AccuLynx company* with its own database.
- **Have we already quoted this house?** The husband calling three weeks after
  the wife got a price, and getting a different number.

Doing that by hand means three logins per lead, nine times a week. So it does
not happen. This does it on every lead.

## What it does, in order

1. Reads posts from four RingCentral team channels since a cutoff.
2. Keeps the ones containing `Customer Name:` — the channels carry ordinary
   conversation too.
3. Parses the form: name, phone, email, address, reason, lead source, notes.
4. Asks AccuLynx whether this post already became a job. If so, skips.
5. **Searches all three departments** for prior work on this customer.
6. Optionally has Claude judge whether the candidates are really the same
   person or the same property.
7. Creates the contact and the job (a lead *is* a job in the
   `Lead (Unassigned)` milestone — there is no create-lead endpoint).
8. Stamps the job with the post ID, so it is never created twice.
9. **Assigns it**, or **flags it** in a private RingCentral thread.

## Assignment

Sets the job's **Company Representative**.

| Department | Rule |
| --- | --- |
| Reroof | Rotates Jacin → Francis → Alex → Jacin |
| Repairs | Alex |
| Warranties | Jacin |

Two things stop an automatic assignment, both cases where picking a name would
override a decision a person already made:

- the intake names a salesperson
- the customer has prior jobs under a different representative

Those get flagged instead. A prior job under whoever is up anyway is not a
conflict, and neither is a prior job with nobody on it.

**The rotation pointer moves only on a real assignment.** A flagged lead does
not consume anyone's turn — the rotation exists to be fair, and skipping
someone because a lead was ambiguous is not fair to them. A lead that is
assigned and then dies does not give the turn back.

The pointer lives in `state/rotation.json` and is meant to be edited by hand
when that is the right answer.

## What the history search can and cannot find

`POST /contacts/search` matches on first name, last name and company name.
**Phone is not a search criterion, and neither is address.** So the search goes
out by surname, and the phone and address that come back are used to *confirm
or reject* a match rather than to find one.

| Case | Found |
| --- | --- |
| Same surname, different first name | yes |
| Same person, name spelled differently | yes |
| Same phone, different name | yes — via expansion, bounded to 10 per department |
| **Same house, different surname** | **no** |

That last row is a real gap and it is documented in `src/history.js` rather
than papered over. Closing it needs a locally-built address index; it has not
been built, because the flags this produces will show how often it actually
matters.

## Things AccuLynx's documentation gets wrong

Every one of these was found by running it and reading the error.

| Documented | Actually |
| --- | --- |
| `startDate` is a `date-time`, e.g. `2023-01-01T00:00:00Z` | Rejected. Wants `YYYY-MM-DD` |
| `POST /leads` creates a lead | No such endpoint. A lead is a job |
| operationIds suggest paths | They do not. Paths are kebab-case and grouped differently |
| Contact search returns phone numbers | Returns `{id, _link}`. Expand the contact for digits |
| `GET /jobs/{id}` returns a job | Not unassigned ones — exactly the leads that matter |
| `POST /jobs/{id}/external-references` | The job ID goes in the **body** |

The last one mattered most: it left a real job in the CRM that dedup could not
see, so the next run recreated it.

## Running it

Everything runs in GitHub Actions, because this environment cannot reach
`api.acculynx.com`.

| Workflow | What it does |
| --- | --- |
| **Sync leads** | The thing itself. Dry run unless `apply` is ticked |
| **Discover AccuLynx IDs** | Read-only. Dumps the IDs a company uses |
| **Discover RingCentral** | Read-only. Lists chats and checks the lead channels |
| **Check key exposure** | Which stored key, if any, matches a given fingerprint |

`Sync leads` defaults to a **dry run**, which prints every lead with its
history and the assignment it would make, and writes nothing. `max_creates`
caps how many leads one run may create — worth setting to 3 the first time it
points at a live company.

## Secrets

| Secret | For |
| --- | --- |
| `RC_CLIENT_ID`, `RC_CLIENT_SECRET`, `RC_JWT` | RingCentral. The JWT acts as the person who minted it, so it only sees channels they belong to |
| `ACCULYNX_KEY_REROOF` | Reroof company |
| `ACCULYNX_KEY_SERVICE` | Service company |
| `ACCULYNX_KEY_WARRANTIES` | Warranties company |
| `ACCULYNX_API_KEY_TEST` | Testing company |
| `ANTHROPIC_API_KEY` | Optional. Without it, the match judgment is skipped and the deterministic matching stands alone |
| `RC_FLAG_CHAT_ID` | Optional. Overrides where flags are posted |

An API key is bound to **one** AccuLynx company. Every ID behind it — users,
lead sources — is scoped to that company, and the same person has a different
user GUID in each. Nothing is portable between them.

## Layout

```
src/parse-intake.js    the intake form -> a lead
src/history.js         has this customer been here before
src/match-ai.js        Claude judging the candidates the search found
src/rotation.js        whose turn it is, and when to flag instead
src/acculynx.js        API client, one per company key
src/sync.js            the orchestrator
src/discover*.js       read-only ID discovery
```

## Tests

```
npm test
```

51 tests, no dependencies beyond the Anthropic SDK. The fixtures are real posts
from the channels, and they have caught real defects — an option row in the
template being absorbed into the field above it, and RingCentral rewriting
email addresses as markdown autolinks that AccuLynx then rejects.
