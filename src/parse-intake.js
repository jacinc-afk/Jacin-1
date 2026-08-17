// Parses the lead intake forms posted into RingCentral team chat.
//
// A post looks like this, and one post may carry several of them:
//
//   Customer Name: Gregory Barnett
//   Phone: 5613692032
//   Email: Barnett.Greg89@gmail.com
//   Property Address: 1520 S 24th Ct, Riviera Beach, FL 33404
//   Reason for Call: he is looking for a terrace roof
//   Re-roof / Repair / Service / Warranty / Payment
//   Problem or Request: he is asking for somebody to reach out
//   Urgency:
//   Lead Source: previous client
//   Assigned To:
//   Best Callback Time:
//   Notes: looking for an estimate
//
// Trailing fields are frequently left blank, and the channels these arrive in
// also carry ordinary conversation, so "Customer Name:" is what marks a post
// as a lead rather than chatter.

import { LEAD_SOURCES } from './acculynx-ids.js';

const NAME_LABEL = 'customer name';

// Labels seen in the intake template. The bare
// "Re-roof / Repair / Service / Warranty / Payment" line carries no colon and
// so is never read as a field; the work type comes from the channel instead.
const LABELS = new Map([
  ['customer name', 'name'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['property address', 'address'],
  ['reason for call', 'reason'],
  ['problem or request', 'problem'],
  ['urgency', 'urgency'],
  ['lead source', 'leadSource'],
  ['assigned to', 'assignedTo'],
  ['best callback time', 'callbackTime'],
  ['notes', 'notes'],
]);

/**
 * Split a post into one entry per "Customer Name:" and parse each.
 * Returns [] for posts that carry no intake form at all.
 */
export function parseIntakePosts(text) {
  if (!text) return [];

  const lines = stripMarkdownLinks(text).split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (labelOf(line) === NAME_LABEL) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks.map((block) => parseLead(block.join('\n')));
}

/**
 * RingCentral turns email addresses and phone numbers in posts into markdown
 * autolinks, so the text arrives as
 * `[jade@outlook.com](mailto:jade@outlook.com)` rather than the address alone.
 * Sent through as-is, AccuLynx rejects it — the email field is format-checked.
 * Unwrapping to the label recovers the original text for every field at once.
 */
export function stripMarkdownLinks(text) {
  return text.replace(/\[([^\]]+)\]\((?:mailto:|tel:)?[^)]*\)/g, '$1');
}

export function parseLead(text) {
  const fields = {};
  let lastKey = null;

  for (const line of stripMarkdownLinks(text).split(/\r?\n/)) {
    const label = labelOf(line);
    if (label && LABELS.has(label)) {
      lastKey = LABELS.get(label);
      fields[lastKey] = line.slice(line.indexOf(':') + 1).trim();
    } else if (lastKey && line.trim() && !isOptionRow(line)) {
      // A value wrapped onto the following line belongs to the field above it.
      fields[lastKey] = `${fields[lastKey]} ${line.trim()}`.trim();
    }
  }

  const { firstName, lastName } = splitName(fields.name || '');
  const phone = normalizePhone(fields.phone);
  const address = parseAddress(fields.address);

  return {
    firstName,
    lastName,
    phone,
    // Kept so it can go in the notes when it can't be sent as a phone number.
    rawPhone: fields.phone || null,
    email: (fields.email || '').trim() || null,
    address,
    rawAddress: fields.address || null,
    reason: fields.reason || null,
    problem: fields.problem || null,
    urgency: fields.urgency || null,
    leadSourceId: matchLeadSource(fields.leadSource),
    rawLeadSource: fields.leadSource || null,
    assignedTo: fields.assignedTo || null,
    callbackTime: fields.callbackTime || null,
    notes: fields.notes || null,
  };
}

function labelOf(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  return line.slice(0, colon).trim().toLowerCase();
}

/**
 * The template carries an unfilled option row —
 * "Re-roof / Repair / Service / Warranty / Payment" — with no colon, sitting
 * between two real fields. Without this it gets absorbed as a continuation of
 * whichever field precedes it. Two or more " / " separators distinguishes it
 * from prose that merely contains a slash.
 */
function isOptionRow(line) {
  return !line.includes(':') && (line.match(/\s\/\s/g) || []).length >= 2;
}

/**
 * AccuLynx requires exactly 10 digits (^\d{10}$) — no spaces, dashes,
 * parentheses or country code. Returns null when the input can't be reduced
 * to that, so the caller can fall back rather than send something invalid.
 */
export function normalizePhone(raw) {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  // Strip a leading US country code.
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);

  return /^\d{10}$/.test(digits) ? digits : null;
}

export function splitName(raw) {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * jobPost.locationAddress is all-or-nothing: supply the object and street1,
 * city, state, country and zipCode are all required. So this returns a
 * complete address or null — never a partial one. Intake sometimes omits the
 * comma before the city ("1136 NW 7th Terrace Fort Lauderdale, FL 33311"),
 * which is not reliably separable, and those fall back to null so the raw text
 * can be carried in the notes instead of a guessed street and city.
 */
// Street suffixes, used only to recover a missing comma. Kept explicit rather
// than matched loosely: splitting on any lowercase-then-uppercase boundary
// would cut "McDonald" and "DeSoto" in half.
const STREET_SUFFIXES = [
  'St', 'Street', 'Ave', 'Avenue', 'Rd', 'Road', 'Dr', 'Drive', 'Ln', 'Lane',
  'Ct', 'Court', 'Cir', 'Circle', 'Blvd', 'Boulevard', 'Way', 'Ter', 'Terrace',
  'Pl', 'Place', 'Trl', 'Trail', 'Pkwy', 'Parkway', 'Hwy', 'Highway',
];

/**
 * Split an address into its comma-separated parts, recovering the one comma
 * intake most often drops.
 *
 * Real example from the channel:
 *
 *   8792 SE Duncan StHobe Sound, FL 33455
 *
 * The comma between street and city is missing, so "St" and "Hobe" are welded
 * together and the whole address is unparseable — which loses the property,
 * which is the strongest signal for catching a second quote to one house.
 *
 * The recovery is deliberately narrow: a known street suffix immediately
 * followed by an uppercase letter, and only when the address is otherwise one
 * comma short. Anything looser starts cutting up surnames.
 */
export function splitAddress(raw) {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return parts;

  const suffixes = STREET_SUFFIXES.join('|');
  const match = parts[0].match(new RegExp(`^(.*\\b(?:${suffixes}))([A-Z][a-z].*)$`));
  if (!match) return parts;

  return [match[1].trim(), match[2].trim(), parts[1]];
}

export function parseAddress(raw) {
  if (!raw) return null;

  const parts = splitAddress(raw);
  if (parts.length < 3) return null;

  const stateZip = parts[parts.length - 1].match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!stateZip) return null;

  const city = parts[parts.length - 2];
  const street = parts.slice(0, parts.length - 2);
  if (!city || street.length === 0) return null;

  return {
    street1: street[0],
    ...(street.length > 1 ? { street2: street.slice(1).join(', ') } : {}),
    city,
    state: stateZip[1].toUpperCase(),
    zipCode: stateZip[2],
    country: 'US',
  };
}

/**
 * Intake types the lead source freehand ("previous client"), so match it to
 * the account's configured sources rather than sending unrecognised text.
 * Returns null when nothing matches, leaving the field unset.
 */
export function matchLeadSource(raw) {
  if (!raw) return null;

  const needle = raw.trim().toLowerCase();
  if (!needle) return null;

  for (const [name, id] of Object.entries(LEAD_SOURCES)) {
    if (name.toLowerCase() === needle) return id;
  }

  // "previous client" is the phrase intake actually uses for the source
  // configured in AccuLynx as "Previous Customer".
  const aliases = {
    'previous client': 'Previous Customer',
    'previous customer': 'Previous Customer',
    'past customer': 'Previous Customer',
    'repeat customer': 'Previous Customer',
    referral: 'Referral',
    'word of mouth': 'Referral',
    google: 'Google Search',
    web: 'Website',
    website: 'Website',
  };

  const alias = aliases[needle];
  return alias ? LEAD_SOURCES[alias] ?? null : null;
}

/**
 * Build the AccuLynx notes field, folding in anything that couldn't be sent as
 * a structured value so nothing from the intake form is silently dropped.
 * Capped at the documented 1000 characters.
 */
export function buildNotes(lead, { channel, postedAt } = {}) {
  const lines = [];

  if (channel) lines.push(`From RingCentral ${channel}${postedAt ? ` on ${postedAt}` : ''}`);
  if (lead.reason) lines.push(`Reason for call: ${lead.reason}`);
  if (lead.problem) lines.push(`Problem or request: ${lead.problem}`);
  if (lead.urgency) lines.push(`Urgency: ${lead.urgency}`);
  if (lead.callbackTime) lines.push(`Best callback time: ${lead.callbackTime}`);
  if (lead.assignedTo) lines.push(`Assigned to: ${lead.assignedTo}`);
  if (lead.notes) lines.push(`Notes: ${lead.notes}`);

  // Surface what had to be dropped, so it's visible in AccuLynx rather than
  // lost between here and the CRM.
  if (!lead.address && lead.rawAddress) {
    lines.push(`Address (could not be parsed): ${lead.rawAddress}`);
  }
  if (!lead.phone && lead.rawPhone) {
    lines.push(`Phone (not a valid 10-digit number): ${lead.rawPhone}`);
  }
  if (!lead.leadSourceId && lead.rawLeadSource) {
    lines.push(`Lead source (unrecognised): ${lead.rawLeadSource}`);
  }

  return lines.join('\n').slice(0, 1000);
}
