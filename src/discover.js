// Read-only discovery script for AccuLynx API V2.
//
// Creating a job requires referencing your company's own IDs (lead sources,
// work types, job categories, trade types, contact types). Those IDs are
// account-specific, so they have to be read out of your account before any
// lead-creation code can be written against them.
//
// This script only issues GET requests. It creates nothing and changes
// nothing. Run it with:
//
//   ACCULYNX_API_KEY=xxxxx node src/discover.js
//
// Endpoint paths below are INFERRED from the operationIds in AccuLynx's
// OpenAPI index (e.g. getCompanySettingsJobSettingsWorkTypes ->
// /companysettings/jobsettings/worktypes). They are not confirmed. Rather
// than assume, the script tries each candidate and reports exactly which one
// answered, so a wrong guess shows up as a clean 404 instead of silently
// producing nothing.

const BASE = process.env.ACCULYNX_API_BASE || 'https://api.acculynx.com/api/v2';

const LOOKUPS = [
  {
    label: 'Contact Types  (GUID -> required by POST /contacts)',
    candidates: ['/contacts/types', '/contacttypes'],
  },
  {
    label: 'Lead Sources   (GUID -> jobPost.leadSource.id)',
    candidates: [
      '/companysettings/leadsources',
      '/leadsources',
      '/companysettings/jobsettings/leadsources',
    ],
  },
  {
    label: 'Work Types     (INTEGER -> jobPost.workType.id)',
    candidates: ['/companysettings/jobsettings/worktypes'],
  },
  {
    label: 'Job Categories (INTEGER -> jobPost.jobCategory.id)',
    candidates: ['/companysettings/jobsettings/jobcategories'],
  },
  {
    label: 'Trade Types    (GUID -> jobPost.tradeTypes[].id)',
    candidates: ['/companysettings/jobsettings/tradetypes'],
  },
];

async function main() {
  const apiKey = process.env.ACCULYNX_API_KEY;
  if (!apiKey) {
    console.error('Missing ACCULYNX_API_KEY. Get one at https://my.acculynx.com/apikeys');
    process.exit(1);
  }

  // Confirm the key works before anything else, so a bad key reads as a bad
  // key rather than as five mysterious failures.
  const ping = await get('/ping', apiKey);
  if (ping.status === 401) {
    console.error('API key rejected (401). Check the key at https://my.acculynx.com/apikeys');
    process.exit(1);
  }
  console.log(`ping -> ${ping.status}\n`);

  for (const lookup of LOOKUPS) {
    console.log('='.repeat(70));
    console.log(lookup.label);

    let found = false;
    for (const path of lookup.candidates) {
      const res = await get(path, apiKey);

      if (res.status === 404) {
        console.log(`  ${path} -> 404 (wrong path guess, trying next)`);
        continue;
      }
      if (res.status === 429) {
        console.log(`  ${path} -> 429 rate limited; retry after ${res.retryAfter}s`);
        found = true;
        break;
      }
      if (res.status !== 200) {
        console.log(`  ${path} -> ${res.status} ${truncate(res.body, 200)}`);
        found = true;
        break;
      }

      console.log(`  ${path} -> 200`);
      printItems(res.json);
      found = true;
      break;
    }

    if (!found) {
      console.log('  !! every candidate path 404ed - need the real path from the docs');
    }
    console.log();
  }
}

// Print just id + name for each item, which is all the mapping needs. The
// shape of these collections isn't documented in the pages read so far, so
// fall back to raw JSON when the guess at the shape doesn't fit.
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
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

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
