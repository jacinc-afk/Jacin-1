// Whose turn is it?
//
// Every department currently assigns to Jacin, so nothing uses a pointer right
// now. The rotation is still implemented and still tested, because turning it
// back on is a one-line edit in departments.js — reroof was Jacin -> Francis
// -> Alex -> Jacin, and repairs went to Alex. Fixed and rotating departments
// go through the same function so the caller has one rule to follow.
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
    if (discounted(candidate)) continue;
    for (const job of candidate.jobs ?? []) {
      // A GUID that resolved to nobody is still a real person owning a real
      // job, so it counts as a conflict rather than being ignored.
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
        `this would otherwise go to ${turn}`,
      suggested: conflicting.length === 1 ? conflicting[0] : null,
    };
  }

  return { assign: turn, flag: false, reason: null };
}

/**
 * Should this candidate be left out of the conflict check?
 *
 * Only ever a name-only candidate that the judgment rejected on both counts.
 * A real run showed why this is needed: a lead from Maria Hernandez in Hobe
 * Sound matched two other Maria Hernandezes forty miles away, under a
 * different representative, and that blocked the assignment — even though the
 * strongest match, on phone and email and address, was under the person it was
 * going to anyway. Left alone, every common surname flags forever and the
 * rotation stops working.
 *
 * The safety property is kept: a phone, email or address match is never
 * discounted, whatever the judgment says. Only a candidate matched on name
 * alone, and only when the judgment says it is neither the same person nor the
 * same property. Anything unsure still counts as a conflict.
 */
function discounted(candidate) {
  if (candidate?.confidence !== 'weak') return false;
  const judgment = candidate.judgment;
  if (!judgment) return false;
  return judgment.samePerson === 'no' && judgment.sameProperty === 'no';
}

/**
 * Did the intake note ask for someone by name?
 *
 * Deliberately hard to trigger. A surname on its own is not enough: the
 * salespeople here are called Smith and Parker, and a customer named
 * Christopher Smith would otherwise flag as "the intake names Andrei Smith"
 * forever. A flag that fires on the customer's own name is worse than no flag,
 * because people stop reading them.
 *
 * So a match needs either the full name, or a surname next to a phrase that
 * actually asks for someone. And the customer's own surname never counts,
 * whatever it is next to.
 */
const REQUEST_CUES = [
  'ask for', 'asked for', 'asking for', 'wants', 'wanted', 'requested',
  'requesting', 'spoke to', 'spoke with', 'dealt with', 'dealing with',
  'worked with', 'referred by', 'sent by', 'talk to', 'talked to',
  'his guy', 'her guy', 'their guy', 'rep is', 'salesman',
];

export function requestedSalesperson(lead, department) {
  const haystack = [lead?.rawLeadSource, lead?.reason, lead?.problem, lead?.notes, lead?.rawText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack) return null;

  const customerSurname = (lead?.lastName || '').trim().toLowerCase();

  for (const name of Object.keys(department?.users ?? {})) {
    const full = name.toLowerCase();
    const surname = full.split(' ').slice(-1)[0];

    // The customer sharing a name with a salesperson tells us nothing.
    if (surname && surname === customerSurname) continue;

    if (haystack.includes(full)) return name;

    // A surname alone only counts next to something that reads as a request.
    if (surname && haystack.includes(surname)) {
      if (REQUEST_CUES.some((cue) => haystack.includes(cue))) return name;
    }
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
