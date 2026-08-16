import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextAssignee, advance, assignmentDecision, requestedSalesperson } from '../src/rotation.js';
import { REROOF, SERVICE, WARRANTIES, NEW_CONSTRUCTION } from '../src/departments.js';

test('reroof rotates Jacin, Francis, Alex and back to Jacin', () => {
  assert.equal(nextAssignee(REROOF, 0), 'Jacin Carreiro');
  assert.equal(nextAssignee(REROOF, 1), 'Francis Ferrer');
  assert.equal(nextAssignee(REROOF, 2), 'Alex Patapis');
  assert.equal(nextAssignee(REROOF, 3), 'Jacin Carreiro');
});

test('repairs go to Alex and warranties to Jacin, whatever the pointer says', () => {
  for (const pointer of [0, 1, 2, 7]) {
    assert.equal(nextAssignee(SERVICE, pointer), 'Alex Patapis');
    assert.equal(nextAssignee(WARRANTIES, pointer), 'Jacin Carreiro');
  }
});

test('a department with no rule assigns nobody rather than guessing', () => {
  assert.equal(nextAssignee(NEW_CONSTRUCTION, 0), null);
  assert.equal(assignmentDecision({ lead: {}, department: NEW_CONSTRUCTION }).flag, true);
});

test('a hand-edited pointer that is out of range still resolves', () => {
  assert.equal(nextAssignee(REROOF, -1), 'Alex Patapis');
  assert.equal(nextAssignee(REROOF, 99), nextAssignee(REROOF, 0));
});

test('only rotating departments move the pointer', () => {
  assert.equal(advance(REROOF, 0), 1);
  assert.equal(advance(REROOF, 2), 0);
  assert.equal(advance(SERVICE, 5), 5);
  assert.equal(advance(NEW_CONSTRUCTION, 3), 3);
});

// "if it is unflagged and put in, then the next person will get it.
//  if it dies then nothing happens"
test('a clean lead is assigned to whoever is up, and only then does the turn move', () => {
  const decision = assignmentDecision({ lead: {}, department: REROOF, pointer: 1 });
  assert.equal(decision.assign, 'Francis Ferrer');
  assert.equal(decision.flag, false);
  assert.equal(advance(REROOF, 1), 2);
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
