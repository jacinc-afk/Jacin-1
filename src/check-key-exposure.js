// Which of our stored API keys, if any, is the one that got exposed?
//
// A live AccuLynx key was pasted into a chat transcript. Finding it again by
// eye turned out to be impossible: AccuLynx does not show a key's value after
// it is created, so its API keys page lists names and dates and nothing you
// can match a string against. Checking all five companies by hand found
// nothing, which proves only that you cannot see key values — not that the key
// is gone.
//
// So compare fingerprints instead. This runs in GitHub Actions, where every
// key is already present as a secret, hashes each one, and says which secret —
// if any — is the exposed key. It never prints a key, and a SHA-256 cannot be
// turned back into one.
//
// The answer decides what to do:
//
//   a secret matches  -> rotate that one company's key. Nothing else.
//   nothing matches   -> the exposed key is not one this project uses. It was
//                        either already deleted or belongs somewhere else, and
//                        there is nothing here to rotate.

import { createHash } from 'node:crypto';

// SHA-256 of the key pasted into the transcript. The key itself is deliberately
// not in this file — publishing it in the repo would make a bad situation
// worse.
const EXPOSED_SHA256 = '206a38fae8c477771826c33bf5ef7238e8e907b3710345a67080ee76405133b3';

const SECRETS = [
  'ACCULYNX_API_KEY',
  'ACCULYNX_API_KEY_TEST',
  'ACCULYNX_KEY_REROOF',
  'ACCULYNX_KEY_SERVICE',
  'ACCULYNX_KEY_WARRANTIES',
  'ACCULYNX_KEY_NEWCONSTRUCTION',
];

function fingerprint(value) {
  return createHash('sha256').update(value.trim()).digest('hex');
}

console.log('Comparing stored keys against the exposed one by SHA-256.');
console.log('No key is printed, and a hash cannot be reversed into one.\n');

const present = [];
const matches = [];
const duplicates = new Map();

for (const name of SECRETS) {
  const value = process.env[name];

  if (!value) {
    console.log(`  ${name.padEnd(30)} not set`);
    continue;
  }

  const hash = fingerprint(value);
  present.push(name);

  // Two secrets holding the same key is worth knowing on its own — it means
  // one of them is a misleading alias, and rotating one silently breaks the
  // other.
  if (!duplicates.has(hash)) duplicates.set(hash, []);
  duplicates.get(hash).push(name);

  const isExposed = hash === EXPOSED_SHA256;
  if (isExposed) matches.push(name);

  console.log(
    `  ${name.padEnd(30)} set, fingerprint ${hash.slice(0, 12)}…  ` +
      `${isExposed ? '*** THIS IS THE EXPOSED KEY ***' : 'not the exposed key'}`
  );
}

console.log(`\n${'='.repeat(70)}`);

if (matches.length > 0) {
  console.log('The exposed key is in use, as:');
  for (const name of matches) console.log(`  ${name}`);
  console.log('\nRotate that company\'s key in AccuLynx and update that secret.');
  console.log('The other companies are unaffected and need no action.');
} else if (present.length === 0) {
  console.log('No AccuLynx secrets were readable, so nothing was compared.');
  console.log('This proves nothing — check the workflow passes the secrets in.');
  process.exitCode = 1;
} else {
  console.log(`None of the ${present.length} stored key(s) is the exposed one.`);
  console.log('');
  console.log('So the exposed key is not one this project uses. Since it also');
  console.log('does not appear in any of the five companies, the likeliest');
  console.log('explanation is that it was already deleted or regenerated.');
  console.log('');
  console.log('It is still worth deleting if it can be identified by its');
  console.log('creation date, but no secret here needs changing.');
}

for (const [, names] of duplicates) {
  if (names.length > 1) {
    console.log(`\nNOTE: these secrets hold the SAME key: ${names.join(', ')}`);
    console.log('Rotating one without the other would break whichever is left.');
  }
}
