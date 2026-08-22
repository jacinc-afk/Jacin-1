import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextAssignee, advance, assignmentDecision, requestedSalesperson } from '../src/rotation.js';
import { REROOF, SERVICE, WARRANTIES, NEW_CONSTRUCTION } from '../src/departments.js';

// Every department currently points at Jacin. Reroof used to rotate
// Jacin -> Francis -> Alex; the rotation code is still here and still tested
// below against a stand-in, so switching back is a one-line edit.
test('every live department assigns to Jacin, whatever the pointer says', () => {
  for (const pointer of [0, 1, 2, 7]) {
    assert.equal(nextAssignee(REROOF, pointer), 'Jacin Carreiro');
    assert.equal(nextAssignee(SERVICE, pointer), 'Jacin Carreiro');
    assert.equal(nextAssignee(WARRANTIES, pointer), 'Jacin Carreiro');
  }
});

// The rotation machinery itself, exercised against a stand-in department so
// the test keeps its meaning whoever the live departments point at today.
const ROTATING = {
  assignment: { mode: 'rotate', people: ['Jacin Carreiro', 'Francis Ferrer', 'Alex Patapis'] },
  users: REROOF.users,
};

test('a rotating department goes round in order and wraps', () => {
  assert.equal(nextAssignee(ROTATING, 0), 'Jacin Carreiro');
  assert.equal(nextAssignee(ROTATING, 1), 'Francis Ferrer');
  assert.equal(nextAssignee(ROTATING, 2), 'Alex Patapis');
  assert.equal(nextAssignee(ROTATING, 3), 'Jacin Carreiro');
});

test('a department with no rule assigns nobody rather than guessing', () => {
  assert.equal(nextAssignee(NEW_CONSTRUCTION, 0), null);
  assert.equal(assignmentDecision({ lead: {}, department: NEW_CONSTRUCTION }).flag, true);
});

test('a hand-edited pointer that is out of range still resolves', () => {
  assert.equal(nextAssignee(ROTATING, -1), 'Alex Patapis');
  assert.equal(nextAssignee(ROTATING, 99), nextAssignee(ROTATING, 0));
  // A fixed department ignores the pointer entirely.
  assert.equal(nextAssignee(REROOF, -1), 'Jacin Carreiro');
});

test('only rotating departments move the pointer', () => {
  assert.equal(advance(ROTATING, 0), 1);
  assert.equal(advance(ROTATING, 2), 0);
  assert.equal(advance(REROOF, 5), 5);
  assert.equal(advance(SERVICE, 5), 5);
  assert.equal(advance(NEW_CONSTRUCTION, 3), 3);
});

// "if it is unflagged and put in, then the next person will get it.
//  if it dies then nothing happens"
test('a clean lead is assigned to whoever is up, and only then does the turn move', () => {
  const decision = assignmentDecision({ lead: {}, department: ROTATING, pointer: 1 });
  assert.equal(decision.assign, 'Francis Ferrer');
  assert.equal(decision.flag, false);
  assert.equal(advance(ROTATING, 1), 2);
});

test('a clean lead in a fixed department goes to that person', () => {
  const decision = assignmentDecision({ lead: {}, department: REROOF, pointer: 1 });
  assert.equal(decision.assign, 'Jacin Carreiro');
  assert.equal(decision.flag, false);
});

test('a flagged lead does not consume anyone turn', () => {
  const decision = assignmentDecision({
    lead: { reason: 'Customer asked for Francis Ferrer specifically' },
    department: REROOF,
    pointer: 0,
  });
  assert.equal(decision.assign, null);
  assert.equal(decision.flag, true);
  // The caller only advances on an assignment, so Jacin is still up next.
  assert.equal(nextAssignee(REROOF, 0), 'Jacin Carreiro');
});

test('prior work under a different rep is flagged rather than handed to the next in line', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [{ jobs: [{ representative: 'Alex Patapis' }] }],
  });
  assert.equal(decision.assign, null);
  assert.equal(decision.flag, true);
  assert.equal(decision.suggested, 'Alex Patapis');
  assert.match(decision.reason, /Alex Patapis/);
});

test('prior work under the person whose turn it is anyway is not a conflict', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [{ jobs: [{ representative: 'Jacin Carreiro' }] }],
  });
  assert.equal(decision.assign, 'Jacin Carreiro');
  assert.equal(decision.flag, false);
});

// An old lead nobody ever picked up says nothing about who owns the customer.
test('a prior job with no representative is not a conflict', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [{ jobs: [{ representative: null }, { representative: null }] }],
  });
  assert.equal(decision.assign, 'Jacin Carreiro');
  assert.equal(decision.flag, false);
});

// Someone in AccuLynx but not yet in departments.js still owns a real job.
test('an unrecognised representative GUID still counts as a conflict', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [{ jobs: [{ representative: 'unknown user 1234-abcd' }] }],
  });
  assert.equal(decision.flag, true);
});

test('two different prior reps are flagged without suggesting either one', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [
      { jobs: [{ representative: 'Alex Patapis' }] },
      { jobs: [{ representative: 'Francis Ferrer' }] },
    ],
  });
  assert.equal(decision.flag, true);
  assert.equal(decision.suggested, null);
});

test('a full name in the notes is a request', () => {
  assert.equal(requestedSalesperson({ reason: 'wants Francis Ferrer' }, REROOF), 'Francis Ferrer');
});

test('a surname counts only next to something that reads as a request', () => {
  assert.equal(requestedSalesperson({ notes: 'ask for Patapis' }, REROOF), 'Alex Patapis');
  // No cue — could be anything, including the caller's own surname.
  assert.equal(requestedSalesperson({ notes: 'Patapis Road, third house' }, REROOF), null);
});

// Two of the salespeople are called Smith and Parker. Matching a bare surname
// meant a customer named Christopher Smith flagged as "the intake names Andrei
// Smith", on every lead, forever. A flag that fires on the customer's own name
// trains people to ignore flags.
test("the customer's own surname is never read as a request", () => {
  assert.equal(
    requestedSalesperson(
      { lastName: 'Smith', reason: 'Christopher Smith wants an estimate' },
      REROOF
    ),
    null
  );
  assert.equal(
    requestedSalesperson({ lastName: 'Parker', notes: 'ask for a callback' }, REROOF),
    null
  );
});

// A flag nobody trusts gets ignored.
test('an ordinary sentence is not a request', () => {
  assert.equal(requestedSalesperson({ reason: 'roof leaking over the deck' }, REROOF), null);
  assert.equal(requestedSalesperson({}, REROOF), null);
});

// From a real run: a lead from Maria Hernandez in Hobe Sound matched two other
// Maria Hernandezes forty miles away under a different rep, and that blocked
// the assignment — while the strongest match, on phone and email, was under
// the person it was going to anyway. Left alone, every common surname flags
// forever and the rotation stops working.
test('a name-only candidate the judgment rejected does not block assignment', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [
      {
        confidence: 'weak',
        judgment: { samePerson: 'no', sameProperty: 'no', reason: 'different county' },
        jobs: [{ representative: 'Francis Ferrer' }],
      },
    ],
  });
  assert.equal(decision.assign, 'Jacin Carreiro');
  assert.equal(decision.flag, false);
});

// The safety property: the judgment can never talk us out of a proven match.
test('a proven match still blocks assignment even if the judgment disagrees', () => {
  for (const confidence of ['strong', 'property']) {
    const decision = assignmentDecision({
      lead: {},
      department: REROOF,
      pointer: 0,
      candidates: [
        {
          confidence,
          judgment: { samePerson: 'no', sameProperty: 'no', reason: 'not the same' },
          jobs: [{ representative: 'Francis Ferrer' }],
        },
      ],
    });
    assert.equal(decision.flag, true, `${confidence} should still flag`);
  }
});

test('an unsure judgment still counts as a conflict', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [
      {
        confidence: 'weak',
        judgment: { samePerson: 'unsure', sameProperty: 'no', reason: 'cannot tell' },
        jobs: [{ representative: 'Francis Ferrer' }],
      },
    ],
  });
  assert.equal(decision.flag, true);
});

// With no judgment at all — no ANTHROPIC_API_KEY — nothing is discounted.
test('without a judgment every candidate still counts', () => {
  const decision = assignmentDecision({
    lead: {},
    department: REROOF,
    pointer: 0,
    candidates: [{ confidence: 'weak', jobs: [{ representative: 'Francis Ferrer' }] }],
  });
  assert.equal(decision.flag, true);
});
