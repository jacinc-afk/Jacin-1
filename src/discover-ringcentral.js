// Read-only discovery script for RingCentral Team Messaging.
//
// Posts are read per chat, and the API identifies chats by an internal ID, not
// by the name shown in the app. So the three lead channels have to be resolved
// to their IDs before the sync can read them.
//
// This script only issues GET requests (plus the token exchange). It posts
// nothing and changes nothing. Run it with the RingCentral credentials set:
//
//   RC_CLIENT_ID=... RC_CLIENT_SECRET=... RC_JWT=... node src/discover-ringcentral.js
//
// As with the AccuLynx discovery, endpoint paths are tried as candidates and
// failures are reported rather than swallowed — the same approach that turned
// a wall of undifferentiated 404s into a diagnosis over there.

import { getAccessToken } from './ringcentral.js';

const RC_SERVER = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

// The channels lead intake is posted into. Matched case-insensitively, since
// the display name may not be typed exactly as it appears here.
const WANTED = [
  'SB | Re Roof',
  'SB | Sales Leads & Follow-Up',
  'SB | Repairs & Active Leaks',
];

// /team-messaging/v1 is the current namespace; /restapi/v1.0/glip is the older
// one it replaced. Accounts vary in which they answer on.
const CHAT_PATHS = [
  '/team-messaging/v1/chats?recordCount=250',
  '/restapi/v1.0/glip/chats?recordCount=250',
];

async function main() {
  for (const name of ['RC_CLIENT_ID', 'RC_CLIENT_SECRET', 'RC_JWT']) {
    if (!process.env[name]) {
      console.error(`Missing ${name}. See README for creating the RingCentral app.`);
      process.exit(1);
    }
  }

  console.log(`server: ${RC_SERVER}\n`);

  let token;
  try {
    token = await getAccessToken();
    console.log('token exchange -> OK\n');
  } catch (err) {
    // A failure here is the app or the JWT, not the chat endpoints, and there
    // is no point going further.
    console.error(`token exchange -> FAILED\n  ${err.message}\n`);
    console.error('Check that the app uses the JWT auth flow, has the');
    console.error('TeamMessaging scope, and is graduated to production.');
    process.exit(1);
  }

  const chats = await listChats(token);
  if (!chats) process.exit(1);

  console.log(`${chats.length} chat(s) visible to this credential\n`);

  const teams = chats.filter((c) => c.type === 'Team');
  console.log('='.repeat(70));
  console.log('TEAMS');
  console.log('='.repeat(70));
  for (const team of teams) {
    console.log(`  ${String(team.id).padEnd(20)} ${team.name ?? '(unnamed)'}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('LEAD CHANNELS');
  console.log('='.repeat(70));

  let missing = 0;
  for (const wanted of WANTED) {
    const match = chats.find(
      (c) => (c.name ?? '').trim().toLowerCase() === wanted.toLowerCase()
    );
    if (match) {
      console.log(`  FOUND    ${String(match.id).padEnd(20)} ${wanted}`);
    } else {
      missing += 1;
      console.log(`  MISSING                       ${wanted}`);
    }
  }

  if (missing) {
    console.log(`\n${'!'.repeat(70)}`);
    console.log(`${missing} lead channel(s) not visible to this credential.`);
    console.log('These are private teams, and the API only sees teams the');
    console.log('JWT\'s user belongs to. Confirm the JWT was created by a');
    console.log('member of every channel above, and that the names match');
    console.log('exactly as they appear in the RingCentral app.');
    console.log('!'.repeat(70));
  }
}

async function listChats(token) {
  for (const path of CHAT_PATHS) {
    const url = `${RC_SERVER}${path}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();

    console.log(`GET ${path} -> ${res.status}`);

    if (res.status === 200) {
      const data = safeJson(body);
      // Paginate so a long channel list isn't silently truncated.
      const records = data?.records ?? [];
      let next = data?.navigation?.nextPageToken;
      let guard = 0;

      while (next && guard < 20) {
        const pageUrl = `${url}&pageToken=${encodeURIComponent(next)}`;
        const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!pageRes.ok) break;
        const page = safeJson(await pageRes.text());
        records.push(...(page?.records ?? []));
        next = page?.navigation?.nextPageToken;
        guard += 1;
      }

      return records;
    }

    console.log(`  ${truncate(body, 400)}`);

    if (res.status === 401 || res.status === 403) {
      console.log('  -> the token is valid but lacks permission for this call.');
      console.log('     Check the app has the TeamMessaging scope, and that the');
      console.log("     JWT user's role carries the matching user permission.");
      return null;
    }
  }

  console.log('\nNo chats endpoint answered. Neither namespace is available.');
  return null;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
