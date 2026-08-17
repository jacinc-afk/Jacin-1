// Parses the lead intake forms posted into RingCentral team chat.
//
// THERE IS MORE THAN ONE TEMPLATE, and that cost real leads.
//
// This was written against the Repairs channel's form and gated on the exact
// string "Customer Name:". The Re Roof channel uses different labels, and
// every one of its leads was being read as ordinary chatter and skipped in
// silence — the run log said "0 leads found", which looks identical to a quiet
// channel. Three shapes are known:
//
//   A. Repairs               B. Re Roof, inline        C. Re Roof, stacked
//   Customer Name: Greg      Name: Nicole Reyes        Name
//   Phone: 5613692032        Best Callback: 9544711838 Nicole Reyes
//   Property Address:        Address: 1215 Nw 8th Ct   Best Callback
//     1520 S 24th Ct,        Zip Code: 33426           9544711838
//     Riviera Beach,         City: Boynton Beach       Address
//     FL 33404               State: FL                 1215 Nw 8th Ct
//   Reason for Call: ...     Reason: ...               Zip Code
//   Lead Source: ...         Referred By: Neighborhood 33426
//
// So: labels are matched through an alias table, the address is assembled from
// separate parts when it arrives that way, and a label whose value sits on the
// following line is read too. The gate is no longer one magic string — a post
// counts as a lead when it has a name AND at least one other intake field,
// which is what actually distinguishes a form from someone typing "name?".

import { LEAD_SOURCES } from './acculynx-ids.js';

// Every label seen across the three templates, mapped to one field. Aliases
// are listed rather than guessed at with fuzzy matching: a wrong guess here
// puts a phone number in the notes and an address nowhere.
const LABELS = new Map([
  ['customer name', 'name'],
  ['name', 'name'],
  ['client name', 'name'],

  ['phone', 'phone'],
  ['phone number', 'phone'],
  ['best callback', 'phone'],
  ['callback', 'phone'],
  ['best callback number', 'phone'],

  ['email', 'email'],
  ['email address', 'email'],

  // One-line form.
  ['property address', 'address'],
  // Separate-parts form. Assembled below.
  ['address', 'street'],
  ['street address', 'street'],
  ['city', 'city'],
  ['state', 'state'],
  ['zip code', 'zip'],
  ['zip', 'zip'],
  ['zipcode', 'zip'],

  ['reason for call', 'reason'],
  ['reason', 'reason'],
  ['problem or request', 'problem'],
  ['problem', 'problem'],
  ['urgency', 'urgency'],

  ['lead source', 'leadSource'],
  ['referred by', 'leadSource'],
  ['referral source', 'leadSource'],
  ['how did you hear about us', 'leadSource'],

  ['assigned to', 'assignedTo'],
  ['best callback time', 'callbackTime'],
  ['notes', 'notes'],

  // Carried into the notes rather than dropped — "Homeowner: No" changes who
  // can sign, and "Call Type: New Client" is worth a salesperson knowing.
  ['call type', 'callType'],
  ['homeowner', 'homeowner'],
  ['mailing address', 'mailingAddress'],
]);

const NAME_FIELDS = new Set(['name']);

/**
 * Split a post into one entry per name field and parse each.
 * Returns [] for posts that carry no intake form at all.
 */
export function parseIntakePosts(text) {
  if (!text) return [];

  const lines = stripMarkdownLinks(text).split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const field = fieldOf(line);
    if (field && NAME_FIELDS.has(field)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  // A block that names somebody and says nothing else about them is
  // conversation, not a form.
  return blocks.map((block) => parseLead(block.join('\n'))).filter((lead) => lead !== null);
}

/**
 * Which field this line declares, if any.
 *
 * Handles both `Label: value` and a bare `Label` on its own line with the
 * value beneath it. The bare form is only accepted for labels in the table —
 * otherwise every line of a customer's description of their leak would look
 * like a field name.
 */
function fieldOf(line) {
  const colon = line.indexOf(':');
  if (colon !== -1) {
    const label = line.slice(0, colon).trim().toLowerCase();
    if (LABELS.has(label)) return LABELS.get(label);
    return null;
  }

  const bare = line.trim().toLowerCase();
  return LABELS.has(bare) ? LABELS.get(bare) : null;
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
    const field = fieldOf(line);

    if (field) {
      lastKey = field;
      const colon = line.indexOf(':');
      // A bare label carries no value on its own line; the next line has it.
      const value = colon === -1 ? '' : line.slice(colon + 1).trim();
      // "Call Type:| New Client |" — the template's own pipes are not data.
      fields[field] = value.replace(/^\|\s*|\s*\|$/g, '').trim();
    } else if (lastKey && line.trim() && !isOptionRow(line)) {
      // Either a wrapped value, or the value under a bare label.
      fields[lastKey] = `${fields[lastKey] ?? ''} ${line.trim()}`.trim();
    }
  }

  if (!isLead(fields)) return null;

  const { firstName, lastName } = splitName(fields.name || '');
  const phone = normalizePhone(fields.phone);

  // One-line "Property Address" if present, otherwise assembled from the
  // separate parts the Re Roof template uses.
  const rawAddress = fields.address || joinAddressParts(fields);
  const address = parseAddress(rawAddress);

  return {
    firstName,
    lastName,
    phone,
    // Kept so it can go in the notes when it can't be sent as a phone number.
    rawPhone: fields.phone || null,
    email: (fields.email || '').trim() || null,
    address,
    rawAddress: rawAddress || null,
    reason: fields.reason || null,
    problem: fields.problem || null,
    urgency: fields.urgency || null,
    leadSourceId: matchLeadSource(fields.leadSource),
    rawLeadSource: fields.leadSource || null,
    assignedTo: fields.assignedTo || null,
    callbackTime: fields.callbackTime || null,
    notes: fields.notes || null,
    callType: fields.callType || null,
    homeowner: fields.homeowner || null,
  };
}

/**
 * A name plus any other filled-in field from the template.
 *
 * Deliberately easy to satisfy. The first version of this required a phone,
 * email or address, on the reasoning that a lead without contact details is
 * useless — but that is the wrong trade. A junk record is deleted in five
 * seconds; a dropped lead is a customer nobody ever calls back, and nothing in
 * the output would say it happened. This whole file exists because a gate that
 * was too strict silently ate an entire channel's leads.
 *
 * The name alone is still not enough — that would match somebody typing
 * "Name?" mid-conversation — but one more field of any kind is.
 */
function isLead(fields) {
  if (!(fields.name || '').trim()) return false;
  return Object.entries(fields).some(([key, value]) => key !== 'name' && (value || '').trim());
}

/**
 * Rebuild "street, city, ST zip" from the separate fields the Re Roof template
 * uses. Returns '' unless all four are present — parseAddress needs a complete
 * address, and half of one is worse than none because it would be filed under
 * the wrong property.
 */
function joinAddressParts({ street, city, state, zip }) {
  const parts = [street, city, state, zip].map((part) => (part || '').trim());
  if (parts.some((part) => !part)) return '';
  const [streetPart, cityPart, statePart, zipPart] = parts;
  return `${streetPart}, ${cityPart}, ${statePart} ${zipPart}`;
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
    neighborhood: 'Working in the neighborhood',
    neighbor: 'Working in the neighborhood',
    'working in the neighborhood': 'Working in the neighborhood',
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
  if (lead.callType) lines.push(`Call type: ${lead.callType}`);
  // "Homeowner: No" changes who is able to sign, so it belongs in front of
  // whoever picks the lead up.
  if (lead.homeowner) lines.push(`Homeowner: ${lead.homeowner}`);

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
