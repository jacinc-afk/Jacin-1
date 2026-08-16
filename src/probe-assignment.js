// Does POST /jobs/{id}/representatives/company work, and what body does it want?
//
// Everything else about assignment is confirmed. OPTIONS on that path answered
// `Allow: GET, POST`, and the GET returns
//
//   { id, type: "CompanyRepresentative", user: { id, _link }, _link }
//
// The request body is the last thing still inferred: `{ user: { id } }`,
// mirroring the read and matching how every other reference on this API is
// written. An apply run against the Testing company was supposed to settle it
// and did not — all three leads it created were flagged rather than assigned,
// so the call was never made.
//
// So make the call on purpose. This picks a real unassigned lead and a real
// user from whichever company the key reaches, assigns one to the other, and
// reads it back to check it stuck. If the inferred body is wrong, the error
// says so and the alternatives below get tried in turn.
//
// It WRITES. Point it at the Testing company and nowhere else.

import { createClient } from './acculynx.js';

const TARGET = process.env.ACCULYNX_TARGET || 'test';

const KEY_VARS = {
  test: 'ACCULYNX_API_KEY_TEST',
  reroof: 'ACCULYNX_KEY_REROOF',
  service: 'ACCULYNX_KEY_SERVICE',
  warranties: 'ACCULYNX_KEY_WARRANTIES',
};

// Tried in order. The first is the one the code already believes; the rest are
// the shapes it would be if that belief is wrong.
const BODIES = [
  { label: 'user object      { user: { id } }', build: (id) => ({ user: { id } }) },
  { label: 'bare id          { userId }', build: (id) => ({ userId: id }) },
  { label: 'id field         { id }', build: (id) => ({ id }) },
  { label: 'typed            { type, user: { id } }',
    build: (id) => ({ type: 'CompanyRepresentative', user: { id } }) },
];

async function main() {
  if (TARGET !== 'test' && process.env.ALLOW_NON_TEST !== 'true') {
    console.error(`Refusing to run against "${TARGET}". This writes.`);
    console.error('Set ALLOW_NON_TEST=true only if you mean it.');
    process.exit(1);
  }

  const apiKey = process.env[KEY_VARS[TARGET]];
  if (!apiKey) {
    console.error(`Missing ${KEY_VARS[TARGET]}`);
    process.exit(1);
  }

  const client = createClient({ apiKey, label: TARGET });

  const users = await client.listUsers();
  if (users.length === 0) {
    console.error('This company has no users, so there is nobody to assign to.');
    process.exit(1);
  }

  console.log(`Users in the ${TARGET} company:`);
  for (const user of users) console.log(`  ${user.id}  ${user.name}`);

  // An unassigned lead is the honest subject: it is what the sync will be
  // assigning, and setting a representative on one changes nothing a person
  // was relying on.
  const { jobs } = await client.listUnassignedJobs({ pageSize: 10, maxPages: 1 });
  if (jobs.length === 0) {
    console.error('\nNo unassigned leads to probe with. Create one and re-run.');
    process.exit(1);
  }

  const job = jobs[0];
  const user = users[0];
  console.log(`\nProbing job ${job.id} -> ${user.name}\n`);

  const before = await client.getCompanyRepresentative(job.id);
  console.log(`  before: ${before ?? '(unassigned)'}`);

  for (const candidate of BODIES) {
    const body = candidate.build(user.id);
    const res = await client.request(`/jobs/${job.id}/representatives/company`, {
      method: 'POST',
      body,
    });

    console.log(`\n  ${candidate.label}`);
    console.log(`    ${JSON.stringify(body)}`);
    console.log(`    -> ${res.status}`);

    if (!res.ok) {
      console.log(`    ${truncate(res.body, 300)}`);
      continue;
    }

    // A 2xx is not proof on its own — an API can accept a body, ignore the
    // part it did not understand, and change nothing. Reading it back is what
    // makes this a test rather than a hope.
    const after = await client.getCompanyRepresentative(job.id);
    console.log(`    after: ${after ?? '(still unassigned)'}`);

    if (after === user.id) {
      console.log(`\n${'='.repeat(70)}`);
      console.log('CONFIRMED. The body is:');
      console.log(`  ${JSON.stringify(body)}`);
      console.log('='.repeat(70));
      return;
    }

    console.log('    accepted the request but did not change the representative');
  }

  console.log(`\n${'!'.repeat(70)}`);
  console.log('No body shape worked. Assignment cannot be trusted until this is');
  console.log('resolved — leads would be created and left unassigned.');
  console.log('!'.repeat(70));
  process.exitCode = 1;
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
