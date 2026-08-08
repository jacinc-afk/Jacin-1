# RingCentral → AccuLynx lead sync

Watches your RingCentral voicemail box and automatically creates a lead in
AccuLynx for each new voicemail, with the caller's info and a transcription
(when available) pre-filled into the notes.

## How it works

Every 15 minutes a GitHub Action (`.github/workflows/sync-leads.yml`) runs
`src/index.js`, which:

1. Logs in to RingCentral and fetches voicemail messages received since the
   last run (`src/ringcentral.js`).
2. Pulls each voicemail's transcription, if your account has voicemail-to-text
   enabled.
3. Guesses **Reroof** vs. **Service** from keywords in the transcription
   (`src/classify.js`) — defaults to Service and flags the lead as
   low-confidence in the notes when it can't tell.
4. Creates the lead in AccuLynx with name/phone (from caller ID), type, and
   notes (`src/acculynx.js`).
5. Records which voicemail IDs it already processed in `state/processed.json`
   so the same voicemail never creates two leads, then commits that file back
   to the repo.

## One-time setup

### 1. RingCentral app

1. Go to [developers.ringcentral.com](https://developers.ringcentral.com) →
   create an app using the **JWT auth flow**.
2. Grant it the **Read Messages** permission (and make sure voicemail-to-text
   is turned on for the extension you're reading, if you want transcriptions —
   Settings → Voicemail in RingCentral).
3. Generate a JWT credential for the extension whose voicemail you want to
   read.

### 2. AccuLynx API key

Generate an API key in AccuLynx under Settings → API, and confirm the lead
field names AccuLynx expects for your account — `src/acculynx.js` uses the
commonly documented field names (`firstName`, `phoneNumbers`, `projectType`,
etc.) as a starting point, but you should check these against your account's
API reference before relying on this in production, and adjust
`src/acculynx.js` if they differ.

### 3. Add repo secrets

In this repo's Settings → Secrets and variables → Actions, add:

- `RC_CLIENT_ID`, `RC_CLIENT_SECRET`, `RC_JWT` (and `RC_SERVER_URL` only if
  you're testing against the RingCentral sandbox)
- `ACCULYNX_API_KEY` (and `ACCULYNX_API_BASE` only if it differs from the
  default)

Once the secrets are set, the workflow starts running automatically on its
15-minute schedule. You can also trigger it manually from the Actions tab
("Run workflow").

## Local testing

```bash
cp .env.example .env   # fill in your credentials
npm run sync
```

## Known limitations

- Voicemails rarely include an email address, so leads are created without
  one — add it manually in AccuLynx once you have it.
- Reroof vs. Service classification is a simple keyword match, not a
  transcription-quality analysis — check the notes on low-confidence leads.
- If your RingCentral account doesn't have voicemail-to-text enabled, leads
  are still created (from caller ID) but with a note to go listen to the
  recording in RingCentral.
