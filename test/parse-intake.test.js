import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseIntakePosts, parseLead, normalizePhone, parseAddress, matchLeadSource, buildNotes, splitAddress } from '../src/parse-intake.js';
import { LEAD_SOURCES } from '../src/acculynx-ids.js';

// Taken from real posts in SB | Re Roof.
const GREGORY = `Customer Name: Gregory Barnett
Phone: 5613692032
Email: Barnett.Greg89@gmail.com
Property Address: 1520 S 24th Ct, Riviera Beach, FL 33404
Reason for Call: he is looking for a terrace roof
Re-roof / Repair / Service / Warranty / Payment
Problem or Request: he is asking for somebody to reach out for the estimate
Urgency:
Lead Source: previous client
Assigned To:
Best Callback Time:
Notes: looking for an estimate`;

const TOM = `Customer Name: Tom Firth
Phone: 5613692032
Email: tpfirth@msn.com
Property Address: 4717 Dolphin Dr, Greenacres, FL 33463
Reason for Call: he is looking for someone to retrofit his roof
Problem or Request: he is asking for somebody to reach out for the estimate
Lead Source: previous client
Notes: looking for an estimate`;

// This one is posted without a comma between street and city.
const REBECCA = `Customer Name: Rebecca Wurster
Phone: 248 568 8724
Email: rebecca.wurster@wayne.edu
Property Address: 1136 NW 7th Terrace Fort Lauderdale, FL 33311
Reason for Call: Re-roofing and remove all the solar panel.
Problem or Request: She is asking for somebody to reach out for the estimate`;

test('parses a complete intake form', () => {
  const lead = parseLead(GREGORY);

  assert.equal(lead.firstName, 'Gregory');
  assert.equal(lead.lastName, 'Barnett');
  assert.equal(lead.phone, '5613692032');
  assert.equal(lead.email, 'Barnett.Greg89@gmail.com');
  assert.deepEqual(lead.address, {
    street1: '1520 S 24th Ct',
    city: 'Riviera Beach',
    state: 'FL',
    zipCode: '33404',
    country: 'US',
  });
  assert.equal(lead.leadSourceId, LEAD_SOURCES['Previous Customer']);
  assert.equal(lead.notes, 'looking for an estimate');
});

test('a field left blank reads the same as one that is absent', () => {
  const lead = parseLead(GREGORY);

  // Urgency, Assigned To and Best Callback Time are present in the template
  // but routinely left empty. Callers should not have to tell "" apart from
  // a field that was never typed.
  assert.equal(lead.urgency, null);
  assert.equal(lead.assignedTo, null);
  assert.equal(lead.callbackTime, null);
});

test('splits several leads posted in one message', () => {
  const leads = parseIntakePosts(`${GREGORY}\n\n${TOM}`);

  assert.equal(leads.length, 2);
  assert.equal(leads[0].firstName, 'Gregory');
  assert.equal(leads[1].firstName, 'Tom');
  assert.equal(leads[1].email, 'tpfirth@msn.com');
});

test('ignores posts that are ordinary conversation', () => {
  assert.deepEqual(parseIntakePosts("Hey who's supposed to call this guy back?"), []);
  assert.deepEqual(parseIntakePosts(''), []);
  assert.deepEqual(parseIntakePosts(null), []);
});

test('the option line without a colon is not read as a field', () => {
  const lead = parseLead(GREGORY);

  // "Re-roof / Repair / Service / Warranty / Payment" sits between two real
  // fields; it must not leak into the one above it.
  assert.equal(lead.reason, 'he is looking for a terrace roof');
});

test('normalises phone numbers to the required 10 digits', () => {
  assert.equal(normalizePhone('5613692032'), '5613692032');
  assert.equal(normalizePhone('248 568 8724'), '2485688724');
  assert.equal(normalizePhone('(561) 369-2032'), '5613692032');
  assert.equal(normalizePhone('+1 561 369 2032'), '5613692032');
  assert.equal(normalizePhone('561-369-2032 ext 4'), null, 'extension makes it 11 digits');
  assert.equal(normalizePhone('555'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('parses an address only when every required part is present', () => {
  assert.deepEqual(parseAddress('1520 S 24th Ct, Riviera Beach, FL 33404'), {
    street1: '1520 S 24th Ct',
    city: 'Riviera Beach',
    state: 'FL',
    zipCode: '33404',
    country: 'US',
  });

  assert.deepEqual(parseAddress('123 Main St, Apt 2, Peoria, IL 61603'), {
    street1: '123 Main St',
    street2: 'Apt 2',
    city: 'Peoria',
    state: 'IL',
    zipCode: '61603',
    country: 'US',
  });

  assert.equal(parseAddress('9 Elm St, Boca Raton, FL 33431-1234').zipCode, '33431-1234');
});

test('returns null rather than guessing at an unparseable address', () => {
  // AccuLynx requires street1, city, state, country and zipCode together, so a
  // partial parse cannot be sent. Missing the comma before the city is not
  // reliably separable.
  assert.equal(parseAddress('1136 NW 7th Terrace Fort Lauderdale, FL 33311'), null);
  assert.equal(parseAddress('Riviera Beach, FL'), null);
  assert.equal(parseAddress('no idea'), null);
  assert.equal(parseAddress(''), null);
});

test('matches freehand lead sources to the account, case-insensitively', () => {
  assert.equal(matchLeadSource('previous client'), LEAD_SOURCES['Previous Customer']);
  assert.equal(matchLeadSource('Previous Customer'), LEAD_SOURCES['Previous Customer']);
  assert.equal(matchLeadSource('  REFERRAL '), LEAD_SOURCES.Referral);
  assert.equal(matchLeadSource('Yelp'), LEAD_SOURCES.Yelp);
  assert.equal(matchLeadSource('carrier pigeon'), null);
  assert.equal(matchLeadSource(''), null);
});

test('notes carry over anything that could not be sent structurally', () => {
  const lead = parseLead(REBECCA);
  const notes = buildNotes(lead, { channel: 'SB | Re Roof' });

  assert.equal(lead.address, null);
  assert.match(notes, /could not be parsed/);
  assert.match(notes, /1136 NW 7th Terrace Fort Lauderdale, FL 33311/);
  assert.match(notes, /SB \| Re Roof/);
  assert.match(notes, /remove all the solar panel/);

  // Her number does normalise, so it should not be reported as a problem.
  assert.equal(lead.phone, '2485688724');
  assert.doesNotMatch(notes, /not a valid 10-digit number/);
});

test('unwraps the markdown autolinks RingCentral adds', () => {
  // RingCentral rewrites addresses and numbers in posts as markdown links, so
  // this is how the text actually arrives — sent through raw, AccuLynx rejects
  // the email as malformed.
  const lead = parseLead(`Customer Name: Jade Friedensohn
Phone: [917 301 4721](tel:9173014721)
Email: [jadefriedensohn@outlook.com](mailto:jadefriedensohn@outlook.com)
Property Address: 8239 Tailshot Ct, Lake Worth, FL 33467`);

  assert.equal(lead.email, 'jadefriedensohn@outlook.com');
  assert.equal(lead.phone, '9173014721');
  assert.equal(lead.address.city, 'Lake Worth');
});

test('leaves ordinary text with brackets or parens alone', () => {
  const lead = parseLead(`Customer Name: Ann Lee
Notes: call after 5 (she works days) [urgent]`);

  assert.equal(lead.notes, 'call after 5 (she works days) [urgent]');
});

test('notes stay within the 1000 character limit', () => {
  const lead = parseLead(`Customer Name: Long Winded
Notes: ${'x'.repeat(2000)}`);

  assert.ok(buildNotes(lead).length <= 1000);
});

// Real address from the Repairs channel. Intake dropped the comma between
// street and city, welding "St" and "Hobe" together. Losing this loses the
// property, which is the strongest evidence for catching a second quote to
// one house.
test('a missing comma between street and city is recovered', () => {
  assert.deepEqual(parseAddress('8792 SE Duncan StHobe Sound, FL 33455'), {
    street1: '8792 SE Duncan St',
    city: 'Hobe Sound',
    state: 'FL',
    zipCode: '33455',
    country: 'US',
  });
});

// The recovery must not start cutting up names that merely contain a capital.
test('the comma recovery leaves well-formed addresses alone', () => {
  assert.deepEqual(splitAddress('45 McDonald Way, Naples, FL 34102'), [
    '45 McDonald Way',
    'Naples',
    'FL 34102',
  ]);
  assert.equal(parseAddress('123 DeSoto Blvd, Coral Gables, FL 33134').city, 'Coral Gables');
});

test('a two-part address with no street suffix stays unparsed rather than guessed', () => {
  assert.equal(parseAddress('some place over there, FL 33455'), null);
});
