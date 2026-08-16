// Which company does each key actually reach?
//
// A run triggered with target=reroof came back with the same user GUIDs the
// Testing company returns. Either two keys reach one company, or a key is
// filed under the wrong name. Both are serious: the history search would be
// asking the same database twice and never asking the real one, and a live run
// would file leads into a company nobody is watching.
//
// Guessing from a name is what got us here, so this asks. Every key is read
// side by side and fingerprinted by what it can see — the set of user IDs, and
// the set of lead source IDs. Those are configured per company, so two keys
// that agree on both are looking at the same company, whatever they are called.
//
// Read-only.

import { createHash } from 'node:crypto';

import { createClient } from './acculynx.js';

const KEYS = {
  test: 'ACCULYNX_API_KEY_TEST',
  reroof: 'ACCULYNX_KEY_REROOF',
  service: 'ACCULYNX_KEY_SERVICE',
  warranties: 'ACCULYNX_KEY_WARRANTIES',
};

function fingerprint(values) {
  // Sorted, so two keys listing the same things in a different order still
  // agree. Truncated because it only has to be comparable, not secure.
  return createHash('sha256').update([...values].sort().join('|')).digest('hex').slice(0, 12);
}

async function describe(name, apiKey) {
  const client = createClient({ apiKey, label: name });
  const result = { name, users: [], userPrint: null, sourcePrint: null, sources: 0, error: null };

  try {
    const users = await client.listUsers();
    result.users = users;
    result.userPrint = fingerprint(users.map((user) => user.id));
  } catch (err) {
    result.error = err.message;
    return result;
  }

  try {
    const res = await client.request('/company-settings/leads/lead-sources?pageSize=100');
    const items = res.json?.items ?? [];
    result.sources = items.length;
    result.sourcePrint = fingerprint(items.map((item) => item.id));
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function main() {
  const results = [];

  for (const [name, keyVar] of Object.entries(KEYS)) {
    const apiKey = process.env[keyVar];
    if (!apiKey) {
      console.log(`${name.padEnd(12)} ${keyVar} not set`);
      continue;
    }
    results.push(await describe(name, apiKey));
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('WHAT EACH KEY CAN SEE');
  console.log('='.repeat(78));
  console.log(`${'target'.padEnd(14)}${'users'.padEnd(8)}${'user set'.padEnd(15)}${'sources'.padEnd(10)}source set`);

  for (const r of results) {
    if (r.error && !r.userPrint) {
      console.log(`${r.name.padEnd(14)}ERROR  ${r.error}`);
      continue;
    }
    console.log(
      `${r.name.padEnd(14)}${String(r.users.length).padEnd(8)}${String(r.userPrint).padEnd(15)}` +
        `${String(r.sources).padEnd(10)}${r.sourcePrint}`
    );
  }

  // The point of the whole script.
  console.log(`\n${'='.repeat(78)}`);
  const byPrint = new Map();
  for (const r of results) {
    if (!r.userPrint) continue;
    const combined = `${r.userPrint}/${r.sourcePrint}`;
    if (!byPrint.has(combined)) byPrint.set(combined, []);
    byPrint.get(combined).push(r.name);
  }

  let collision = false;
  for (const [combined, names] of byPrint) {
    if (names.length > 1) {
      collision = true;
      console.log(`SAME COMPANY: ${names.join(', ')}  (${combined})`);
    }
  }

  if (collision) {
    console.log('');
    console.log('Two or more keys reach the same AccuLynx company. The history');
    console.log('search is therefore asking one database twice and never asking');
    console.log('the other, and a run targeting the misfiled name would write');
    console.log('into a company nobody expects.');
    process.exitCode = 1;
  } else {
    console.log('Every key reaches a distinct company.');
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('USERS PER TARGET (names and IDs, so a mismatch is visible)');
  console.log('='.repeat(78));
  for (const r of results) {
    console.log(`\n${r.name}:`);
    for (const user of r.users) console.log(`  ${user.id}  ${user.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
