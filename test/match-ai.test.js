import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyVerdicts } from '../src/match-ai.js';
import { CONFIDENCE } from '../src/history.js';

const STRONG = {
  contactId: 'c1',
  department: 'service',
  confidence: CONFIDENCE.STRONG,
  reasons: ['phone matches'],
  jobs: [],
};

const PROPERTY = {
  contactId: 'c2',
  department: 'reroof',
  confidence: CONFIDENCE.PROPERTY,
  reasons: ['property address matches'],
  jobs: [],
};

const WEAK = {
  contactId: 'c3',
  department: 'reroof',
  confidence: CONFIDENCE.WEAK,
  reasons: ['same first and last name'],
  jobs: [],
};

// The one mistake that costs a customer two prices for the same roof is the
// model talking us out of a match the data already proved. It must not be
// able to.
test('a strong match survives the model disagreeing with it', () => {
  const [result] = applyVerdicts(
    [STRONG],
    { c1: { samePerson: 'no', sameProperty: 'no', reason: 'different people' } }
  );
  assert.equal(result.confidence, CONFIDENCE.STRONG);
  assert.equal(result.judgment.samePerson, 'no');
  assert.equal(result.judgment.promoted, false);
});

test('a property match survives the model disagreeing with it', () => {
  const [result] = applyVerdicts(
    [PROPERTY],
    { c2: { samePerson: 'no', sameProperty: 'no', reason: 'unrelated' } }
  );
  assert.equal(result.confidence, CONFIDENCE.PROPERTY);
});

// Bob/Robert, a maiden name, a misspelling — the case a string compare cannot
// see, and the only direction the model is allowed to move a candidate.
test('a weak name-only candidate is promoted when the model recognises the person', () => {
  const [result] = applyVerdicts(
    [WEAK],
    { c3: { samePerson: 'yes', sameProperty: 'unsure', reason: 'Bob is Robert' } }
  );
  assert.equal(result.confidence, CONFIDENCE.STRONG);
  assert.equal(result.judgment.promoted, true);
});

test('a weak candidate promotes on the property alone, not just the person', () => {
  const [result] = applyVerdicts(
    [WEAK],
    { c3: { samePerson: 'no', sameProperty: 'yes', reason: 'same house, spouse' } }
  );
  assert.equal(result.confidence, CONFIDENCE.STRONG);
});

test('a weak candidate the model rejects stays weak rather than disappearing', () => {
  const [result] = applyVerdicts(
    [WEAK],
    { c3: { samePerson: 'no', sameProperty: 'no', reason: 'different city entirely' } }
  );
  assert.equal(result.confidence, CONFIDENCE.WEAK);
  assert.equal(result.judgment.promoted, false);
});

test('candidates with no verdict are returned untouched', () => {
  const [result] = applyVerdicts([WEAK], {});
  assert.equal(result.confidence, CONFIDENCE.WEAK);
  assert.equal(result.judgment, undefined);
});

test('unsure on both counts does not promote', () => {
  const [result] = applyVerdicts(
    [WEAK],
    { c3: { samePerson: 'unsure', sameProperty: 'unsure', reason: 'no address on file' } }
  );
  assert.equal(result.confidence, CONFIDENCE.WEAK);
});
