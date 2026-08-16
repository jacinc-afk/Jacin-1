// Whose turn is it?
//
// Reroof leads rotate Jacin -> Francis -> Alex -> Jacin. Repair leads all go
// to Alex, warranty leads all go to Jacin — those need no pointer, but they go
// through the same function so the caller has one rule to follow.
//
// THE POINTER MOVES ONLY ON AN ACTUAL ASSIGNMENT
//
// A lead that gets flagged for a human decision does not consume a turn: the
// rotation is a fairness mechanism, and skipping someone because a lead was
// ambiguous is not fair to them. A lead that is assigned and then dies also
// does not give the turn back — it was theirs, and it did not work out. That
// is the rule as stated:
//
//   "if it is unflagged and put in, then the next person will get it.
//    if it dies then nothing happens"
//
// So advance() is called after a successful assignment and at no other time.
//
// WHY A FILE IN THE REPO
//
// Unlike dedup — where drift means duplicate customers and AccuLynx has to be
// the source of truth — drift here costs one person one extra lead. That is
// worth a plain committed file rather than machinery. The file is also
// readable and editable by hand, which matters the first time someone joins or
// leaves the rotation.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const STATE_PATH = process.env.ROTATION_STATE_PATH || 'state/rotation.json';

/**
 * Who gets the next lead in this department, given the current pointer.
 *
 * Pure: it decides nothing about whether the lead is assignable, and it does
 * not move the pointer. Returns null for a department with no assignment rule
 * — New Construction has none, and inventing one would put leads in front of
 * someone who is not expecting them.
 */
export function nextAssignee(department, pointer = 0) {
  const rule = department?.assignment;
  if (!rule || rule.people.length === 0) return null;

  if (rule.mode === 'fixed') return rule.people[0];

  // Negative or oversized pointers are survivable — a hand-edited file should
  // not crash the run.
  const index = ((Math.trunc(pointer) % rule.people.length) + rule.people.length) %
    rule.people.length;
  return rule.people[index];
}

/**
 * The pointer after a lead was actually assigned. Fixed-assignment departments
 * have no pointer to move.
 */
export function advance(department, pointer = 0) {
  const rule = department?.assignment;
  if (!rule || rule.mode !== 'rotate' || rule.people.length === 0) return pointer;
  return (Math.trunc(pointer) + 1) % rule.people.length;
}

/**
 * Should this lead be assigned at all, or does a human need to decide?
 *
 * Two things stop an automatic assignment, both of them cases where the
 * machine picking a name would be overriding something a person already
 * decided:
 *
 *   - the intake names a salesperson, because the customer asked for them
 *   - the customer has prior jobs under a different representative, because
 *     that relationship already exists
 *
 * A prior job under the person whose turn it is anyway is not a conflict, and
 * neither is a prior job with no representative on it — an unassigned old lead
 * tells us nothing about who owns the customer.
 */
export function assignmentDecision({ lead, department, pointer = 0, candidates = [] }) {
  const turn = nextAssignee(department, pointer);

  if (!turn) {
    return { assign: null, flag: true, reason: 'no assignment rule for this department' };
  }

  const requested = requestedSalesperson(lead, department);
  if (requested) {
    return {
      assign: null,
      flag: true,
      reason: `intake names ${requested} — confirm before assigning`,
      suggested: requested,
    };
  }

  const priorReps = new Set();
  for (const candidate of candidates) {
    for (const job of candidate.jobs ?? []) {
      // "unknown user <guid>" means someone is in AccuLynx but not in
      // departments.js. That is still a real person owning a real job, so it
      // counts as a conflict rather than being ignored.
      if (job.representative) priorReps.add(job.representative);
    }
  }

  const conflicting = [...priorReps].filter((rep) => rep !== turn);
  if (conflicting.length > 0) {
    return {
      assign: null,
      flag: true,
      reason:
        `prior work under ${conflicting.join(', ')} — ` +
        `rotation would hand this to ${turn}`,
      suggested: conflicting.length === 1 ? conflicting[0] : null,
    };
  }

  return { assign: turn, flag: false, reason: null };
}

/**
 * Did the intake note ask for someone by name?
 *
 * Only names in this department's own user list count. Matching loose text
 * would flag on any stray capitalised word, and a flag nobody trusts gets
 * ignored, which is worse than not flagging.
 */
export function requestedSalesperson(lead, department) {
  const haystack = [lead.rawLeadSource, lead.reason, lead.notes, lead.rawText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack) return null;

  for (const name of Object.keys(department?.users ?? {})) {
    const [first, last] = name.split(' ');
    // Full name, or a surname distinctive enough to stand alone. A bare first
    // name is not enough — "alex" appears in ordinary sentences.
    if (haystack.includes(name.toLowerCase())) return name;
    if (last && haystack.includes(last.toLowerCase())) return name;
  }
  return null;
}

export async function readPointers() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch (err) {
    // No file yet is the normal first run, not a problem.
    if (err.code !== 'ENOENT') {
      console.warn(`Could not read ${STATE_PATH}: ${err.message} — starting from zero`);
    }
    return {};
  }
}

export async function writePointers(pointers) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(pointers, null, 2)}\n`);
}
