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

// Each department is a separate AccuLynx company, and an API key is bound to
// one company, so each needs its own key. IDs — lead sources especially — are
// scoped to the company behind the key.
const KEY_VARS = {
  reroof: 'ACCULYNX_KEY_REROOF',
  service: 'ACCULYNX_KEY_SERVICE',
  warranties: 'ACCULYNX_KEY_WARRANTIES',
  newconstruction: 'ACCULYNX_KEY_NEWCONSTRUCTION',
  test: 'ACCULYNX_API_KEY_TEST',
  production: 'ACCULYNX_API_KEY',
};

// Paths quoted directly in AccuLynx's published documentation, not inferred.
// These are the control: they are expected to work, so a failure here is
// diagnostic rather than just a miss.
const CONTROLS = [
  { path: '/jobs?pageSize=1', note: 'documented as /jobs?pageSize=25&...' },
  { path: '/contacts?pageSize=1', note: 'documented as Get Contacts' },
  { path: '/ping', note: 'documented as Check if the API Server Is Responsive' },
];

// Which company does this key actually reach? With five companies and a key
// per company, inferring it from the user list is guesswork — better to ask.
const IDENTITY_PATHS = ['/company-settings', '/companysettings', '/company'];

// The published path for Get Contact Types is /contacts/contact-types, so
// multi-word segments are kebab-cased — the earlier round of guesses ran them
// together and missed every time. Candidates below apply that convention.
//
// Because routing resolves before authentication, an invalid key still tells
// paths apart: a route that exists answers 401, one that does not answers 404.
// So this survey is meaningful even before the key is fixed.
const LOOKUPS = [
  {
    label: 'Contact Types  (GUID -> required by POST /contacts)',
    // Confirmed from the published spec.
    candidates: ['/contacts/contact-types'],
  },
  {
    // Work types live under job-file-settings, not job-settings, despite the
    // operationId reading getCompanySettingsJobSettingsWorkTypes. The
    // operationIds are not a reliable guide to the paths, so the siblings
    // below are derived from this confirmed one rather than from their names.
    label: 'Work Types     (INTEGER -> jobPost.workType.id)',
    candidates: ['/company-settings/job-file-settings/work-types'],
  },
  {
    label: 'Job Categories (INTEGER -> jobPost.jobCategory.id)',
    candidates: [
      '/company-settings/job-file-settings/job-categories',
      '/company-settings/job-file-settings/categories',
    ],
  },
  {
    label: 'Trade Types    (GUID -> jobPost.tradeTypes[].id)',
    candidates: [
      '/company-settings/job-file-settings/trade-types',
      '/company-settings/job-file-settings/trades',
    ],
  },
  {
    // Lead sources sit under /company-settings/leads/, not job-file-settings
    // — a third prefix shape across these five lookups. Lead sources can also
    // nest: each may carry a `children` array of sub-sources.
    label: 'Lead Sources   (GUID -> jobPost.leadSource.id)',
    candidates: ['/company-settings/leads/lead-sources'],
  },
  {
    // Needed to assign reroof leads in rotation — assignment references a
    // user ID, not a name.
    label: 'Users          (for lead assignment)',
    candidates: ['/users?pageSize=100', '/users'],
  },
  {
    // Setting the Company Representative is a write, so the path is probed
    // rather than assumed. A GET against the collection tells us the route
    // exists; a 400 or 405 is as good a confirmation as a 200 here, and only
    // 404 means the path is wrong. The job ID below is deliberately not a
    // UUID, so a route that exists rejects it on binding instead of touching
    // a real job.
    label: 'Company Rep    (assignment write path — non-404 confirms)',
    candidates: [
      '/jobs/probe/representatives/company',
      '/jobs/probe/company-representative',
      '/jobs/probe/representatives',
    ],
  },
  {
    // Dedup depends on this: each job gets stamped with the RingCentral post
    // that produced it, and the sync asks AccuLynx whether a post has already
    // become a job rather than tracking that itself. A wrong path here means
    // duplicate leads, so the path is probed rather than assumed. `source` is
    // documented as mandatory, so anything other than 404 means the route
    // exists.
    label: 'Job External Refs (dedup — any non-404 confirms the path)',
    candidates: [
      '/jobs/external-references?source=probe',
      '/jobs/externalreferences?source=probe',
      '/job-external-references?source=probe',
      '/jobs/external-reference?source=probe',
    ],
  },
];

async function main() {
  // An API key is bound to one AccuLynx company, so the test company has its
  // own key and its own set of IDs behind it.
  const target = process.env.ACCULYNX_TARGET || 'production';
  const keyVar = KEY_VARS[target] ?? 'ACCULYNX_API_KEY';
  const apiKey = process.env[keyVar];

  if (!apiKey) {
    console.error(`Missing ${keyVar}. Get one at https://my.acculynx.com/apikeys`);
    process.exit(1);
  }

  // Report the shape of the key without revealing it. A key that is far
  // shorter or longer than expected, or that has picked up whitespace or
  // quotes from a copy-paste, shows up here rather than as a mystery 404.
  console.log(`target: ${target} (${keyVar})`);
  console.log(`base: ${BASE}`);
  console.log(`key:  length ${apiKey.length}, prefix "${apiKey.slice(0, 5)}...", ` +
    `${/\s/.test(apiKey) ? 'CONTAINS WHITESPACE' : 'no whitespace'}, ` +
    `${/^["']|["']$/.test(apiKey) ? 'WRAPPED IN QUOTES' : 'unquoted'}\n`);

  console.log('#'.repeat(70));
  console.log('WHICH COMPANY DOES THIS KEY REACH?');
  console.log('#'.repeat(70));
  for (const path of IDENTITY_PATHS) {
    const res = await get(path, apiKey);
    console.log(`  ${path} -> ${res.status}`);
    if (res.status === 200) {
      console.log(`    ${truncate(JSON.stringify(res.json), 600)}`);
      break;
    }
  }

  console.log(`\n${'#'.repeat(70)}`);
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

      // 401 means the route matched and only the credential was rejected, so
      // the path is right even though no data came back. Stop here rather
      // than trying the remaining candidates.
      if (res.status === 401) {
        console.log('    PATH CONFIRMED (401 = route exists, key rejected)');
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
    // Users carry first/last rather than a single name field.
    const name =
      item?.name ||
      [item?.firstName, item?.lastName].filter(Boolean).join(' ') ||
      item?.description ||
      item?.title ||
      '';
    const extra = item?.emailAddress ?? item?.email ?? '';
    console.log(`    ${String(id).padEnd(38)} ${name}${extra ? `  <${extra}>` : ''}`);
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
