import { test } from 'node:test';
import assert from 'node:assert/strict';

import { score, searchTerms, addressMatches, normaliseStreet, summariseJob, CONFIDENCE } from '../src/history.js';

const LEAD = {
  firstName: 'Rebecca',
  lastName: 'Wurster',
  phone: '5613334444',
  email: 'rebecca@example.com',
  address: { street1: '123 Main St.', city: 'Boca Raton', state: 'FL', zipCode: '33432' },
};

test('a matching phone is enough on its own', () => {
  const contact = {
    firstName: 'R',
    lastName: 'Wurster',
    phoneNumbers: [{ number: '(561) 333-4444' }],
  };
  const result = score(contact, LEAD);
  assert.equal(result.confidence, CONFIDENCE.STRONG);
  assert.ok(result.reasons.includes('phone matches'));
});

test('a leading 1 on the stored number does not break the phone match', () => {
  const contact = { lastName: 'Wurster', phoneNumbers: [{ number: '15613334444' }] };
  assert.equal(score(contact, LEAD).confidence, CONFIDENCE.STRONG);
});

// The husband/wife case: different first name, same house. The whole reason
// the search exists, so it must not come back as merely "possible".
test('the same property under a different first name is flagged as the property', () => {
  const contact = {
    firstName: 'Daniel',
    lastName: 'Wurster',
    phoneNumbers: [{ number: '5619998888' }],
    mailingAddress: { street1: '123 MAIN STREET', city: 'Boca Raton', zipCode: '33432' },
  };
  const result = score(contact, LEAD);
  assert.equal(result.confidence, CONFIDENCE.PROPERTY);
  assert.ok(result.reasons.includes('property address matches'));
});

// A surname search returns every namesake in the company. Treating those as
// history would flag a large share of incoming leads for no reason.
test('a namesake at a different address is not history', () => {
  const contact = {
    firstName: 'Karen',
    lastName: 'Wurster',
    phoneNumbers: [{ number: '9545551212' }],
    mailingAddress: { street1: '99 Palm Way', city: 'Naples', zipCode: '34102' },
  };
  assert.equal(score(contact, LEAD).confidence, null);
});

test('an exact name match with nothing else is only a weak match', () => {
  const contact = { firstName: 'Rebecca', lastName: 'Wurster' };
  assert.equal(score(contact, LEAD).confidence, CONFIDENCE.WEAK);
});

// The contact search response types phoneNumbers as { id, _link }, while the
// endpoint's own description claims the numbers come back. If it really is
// links only, no phone match can be manufactured out of them.
test('phone links carrying no number produce no phone match', () => {
  const contact = {
    firstName: 'Rebecca',
    lastName: 'Wurster',
    phoneNumbers: [{ id: 'b2830ef6-c5ff-44ca-a3b9-aa767f50a04b', _link: 'https://…' }],
  };
  const result = score(contact, LEAD);
  assert.equal(result.confidence, CONFIDENCE.WEAK);
  assert.ok(!result.reasons.includes('phone matches'));
});

test('street abbreviations and punctuation do not defeat an address match', () => {
  assert.equal(normaliseStreet('123 Main St.'), normaliseStreet('123 MAIN STREET'));
  assert.equal(normaliseStreet('45 N. Ocean Blvd'), normaliseStreet('45 North Ocean Boulevard'));
});

test('a different zip is a different property even on the same street name', () => {
  assert.equal(
    addressMatches(
      { street1: '123 Main St', zipCode: '33432' },
      { street1: '123 Main St', zipCode: '33487' }
    ),
    false
  );
});

test('zip+4 still matches the five-digit form', () => {
  assert.equal(
    addressMatches(
      { street1: '123 Main St', zipCode: '33432' },
      { street1: '123 Main St', zipCode: '33432-1234' }
    ),
    true
  );
});

test('a missing address never counts as a match', () => {
  assert.equal(addressMatches(null, { street1: '123 Main St', zipCode: '33432' }), false);
  assert.equal(addressMatches({ street1: '123 Main St', zipCode: '33432' }, null), false);
});

test('surname is searched first, and the first name only when there is no surname', () => {
  assert.deepEqual(searchTerms(LEAD), ['Wurster']);
  assert.deepEqual(searchTerms({ firstName: 'Rebecca' }), ['Rebecca']);
  assert.deepEqual(
    searchTerms({ lastName: 'Wurster', companyName: 'Ocean Ridge HOA' }),
    ['Wurster', 'Ocean Ridge HOA']
  );
  assert.deepEqual(searchTerms({}), []);
});

// Field names taken from a live GET /jobs/{id}. The representative is
// deliberately null here — it is not on the job payload at all and is filled
// in from /jobs/{id}/representatives/company by the caller.
test('a job summary reads the fields the payload actually has', () => {
  const summary = summariseJob({
    id: 'e591bf22-9828-4144-bca8-42cbb8c6e2c0',
    jobNumber: '1042',
    currentMilestone: { name: 'Lead (Unassigned)' },
    workType: { name: 'Repair' },
    createdDate: '2024-03-01T14:00:00Z',
    locationAddress: { street1: '123 Main St', city: 'Boca Raton', state: 'FL', zipCode: '33432' },
  });
  assert.equal(summary.jobNumber, '1042');
  assert.equal(summary.milestone, 'Lead (Unassigned)');
  assert.equal(summary.workType, 'Repair');
  assert.equal(summary.address, '123 Main St, Boca Raton, FL 33432');
  assert.equal(summary.representative, null);
});

test('a job summary of an unexpected payload reports nothing rather than guessing', () => {
  const summary = summariseJob({ id: 'abc', someUnknownField: 1 });
  assert.equal(summary.representative, null);
  assert.equal(summary.milestone, null);
  assert.deepEqual(summary.keys, ['id', 'someUnknownField']);
});
