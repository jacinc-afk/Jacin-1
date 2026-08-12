// Read-only discovery script for AccuLynx API V2.
//
// Creating a job requires referencing this company's own IDs (lead sources,
// work types, job categories, trade types, contact types). Those IDs are
// account-specific, so they have to be read out of the account before any
// lead-creation code can be written against them.
//
// This script only issues GET requests. It creates nothing and changes
// nothing. Run it with:
//
//   ACCULYNX_API_KEY=xxxxx node src/discover.js
//
// The first run of this returned 404 on every path, including ones taken
// straight from AccuLynx's own docs. Six wrong guesses in a row points at
// something systemic rather than six bad paths, so the script now starts with
// a control phase: it calls paths that appear verbatim in the published
// examples. If those 404 too, the problem is the key, the base URL or the
// host — not the guessed paths — and there is no point reading further down
// the output.

const BASE = process.env.ACCULYNX_API_BASE || 'https://api.acculynx.com/api/v2';

// Paths quoted directly in AccuLynx's published documentation, not inferred.
// These are the control: they are expected to work, so a failure here is
// diagnostic rather than just a miss.
const CONTROLS = [
  { path: '/jobs?pageSize=1', note: 'documented as /jobs?pageSize=25&...' },
  { path: '/contacts?pageSize=1', note: 'documented as Get Contacts' },
  { path: '/ping', note: 'documented as Check if the API Server Is Responsive' },
];

// Paths inferred from operationIds in the OpenAPI index, e.g.
// getCompanySettingsJobSettingsWorkTypes -> /companysettings/jobsettings/worktypes.
// Unconfirmed, hence multiple candidates each.
const LOOKUPS = [
  {
    label: 'Contact Types  (GUID -> required by POST /contacts)',
    candidates: ['/contacts/types', '/contacttypes', '/companysettings/contacttypes'],
  },
  {
    label: 'Lead Sources   (GUID -> jobPost.leadSource.id)',
    candidates: [
      '/leadsources',
      '/companysettings/leadsources',
      '/companysettings/jobsettings/leadsources',
      '/companysettings/leadsettings/leadsources',
    ],
  },
  {
    label: 'Work Types     (INTEGER -> jobPost.workType.id)',
    candidates: ['/companysettings/jobsettings/worktypes', '/worktypes'],
  },
  {
    label: 'Job Categories (INTEGER -> jobPost.jobCategory.id)',
    candidates: ['/companysettings/jobsettings/jobcategories', '/jobcategories'],
  },
  {
    label: 'Trade Types    (GUID -> jobPost.tradeTypes[].id)',
    candidates: ['/companysettings/jobsettings/tradetypes', '/tradetypes'],
  },
];

async function main() {
  const apiKey = process.env.ACCULYNX_API_KEY;
  if (!apiKey) {
    console.error('Missing ACCULYNX_API_KEY. Get one at https://my.acculynx.com/apikeys');
    process.exit(1);
  }

  // Report the shape of the key without revealing it. A key that is far
  // shorter or longer than expected, or that has picked up whitespace or
  // quotes from a copy-paste, shows up here rather than as a mystery 404.
  console.log(`base: ${BASE}`);
  console.log(`key:  length ${apiKey.length}, prefix "${apiKey.slice(0, 5)}...", ` +
    `${/\s/.test(apiKey) ? 'CONTAINS WHITESPACE' : 'no whitespace'}, ` +
    `${/^["']|["']$/.test(apiKey) ? 'WRAPPED IN QUOTES' : 'unquoted'}\n`);

  console.log('#'.repeat(70));
  console.log('CONTROL - documented paths, expected to work');
  console.log('#'.repeat(70));

  let anyControlWorked = false;
  for (const control of CONTROLS) {
    const res = await get(control.path, apiKey);
    console.log(`\n  GET ${control.path}  (${control.note})`);
    console.log(`    -> ${res.status}`);
    report(res);
    if (res.status === 200) anyControlWorked = true;
  }

  if (!anyControlWorked) {
    console.log(`\n${'!'.repeat(70)}`);
    console.log('Every documented path failed. The guessed paths below are not');
    console.log('the problem - the key, the base URL or the host is. Read the');
    console.log('control output above, not the lookups.');
    console.log('!'.repeat(70));
  }

  console.log(`\n${'#'.repeat(70)}`);
  console.log('LOOKUPS - inferred paths');
  console.log('#'.repeat(70));

  for (const lookup of LOOKUPS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(lookup.label);

    for (const path of lookup.candidates) {
      const res = await get(path, apiKey);
      console.log(`  ${path} -> ${res.status}`);

      if (res.status === 200) {
        printItems(res.json);
        break;
      }
      report(res, '  ');
      if (res.status === 429) break;
    }
  }
}

// Show whatever the server said. The previous version swallowed 404 bodies,
// which is exactly where an explanation would have been.
function report(res, indent = '    ') {
  if (res.status === 200) return;

  if (res.json?.title || res.json?.detail) {
    console.log(`${indent}${res.json.title ?? ''} ${res.json.detail ?? ''}`.trimEnd());
    if (res.json.traceId) console.log(`${indent}traceId: ${res.json.traceId}`);
  } else if (res.body) {
    console.log(`${indent}body: ${truncate(res.body, 300)}`);
  } else {
    console.log(`${indent}(empty body)`);
  }

  // RateLimit-* headers are set by AccuLynx itself, so their presence proves
  // the request reached the API rather than dying at a CDN or proxy in front
  // of it. Their absence on a 404 is a strong hint the 404 isn't AccuLynx's.
  if (res.rateLimitSeen) {
    console.log(`${indent}(RateLimit headers present - reached AccuLynx)`);
  }
  if (res.server) {
    console.log(`${indent}server: ${res.server}`);
  }
}

function printItems(json) {
  const items = json?.items ?? json;
  if (!Array.isArray(items)) {
    console.log(`    (unexpected shape) ${truncate(JSON.stringify(json), 400)}`);
    return;
  }
  if (items.length === 0) {
    console.log('    (empty)');
    return;
  }
  for (const item of items) {
    const id = item?.id ?? '(no id)';
    const name = item?.name ?? item?.description ?? item?.title ?? '';
    console.log(`    ${String(id).padEnd(38)} ${name}`);
  }
}

async function get(path, apiKey) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
  } catch (err) {
    return { status: 'NETWORK ERROR', body: err.message, json: null };
  }

  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Non-JSON bodies (e.g. the text/plain 429) are reported via `body`.
  }

  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    rateLimitSeen: Boolean(res.headers.get('ratelimit-limit') || res.headers.get('ratelimit-policy')),
    server: res.headers.get('server'),
    body,
    json,
  };
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
