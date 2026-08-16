// Has this customer been here before?
//
// Every department is a separate AccuLynx company, so a repair customer coming
// back for a reroof is invisible from inside the reroof company. This asks all
// of them before a lead is created, for the two reasons that motivated it:
//
//   - knowing a returning customer is returning
//   - not sending a second price to the same house, when the husband calls
//     three weeks after the wife already got a quote
//
// WHAT THIS CAN AND CANNOT FIND
//
// POST /contacts/search matches on first name, last name and company name.
// Phone is not a search criterion, and neither is address — the spec lists
// exactly those three plus contact type. So:
//
//   FOUND      same surname, any first name        (searched by surname)
//   FOUND      same person, name spelled variously (fuzzy-scored below)
//   NOT FOUND  same house, different surname       (nothing to search on)
//
// That last row is a real gap, and it is the husband/wife case in its harder
// form — unmarried partners, or a spouse who kept their own name. There is no
// query that closes it, because address is not searchable. Closing it needs a
// local index built by crawling contacts ahead of time; see the note at the
// bottom of this file. Until then the gap is reported honestly rather than
// papered over.

import { DEPARTMENTS, SEARCH_DEPARTMENTS } from './departments.js';
import { createClient } from './acculynx.js';

// A common surname in a company with years of history returns page after page
// of people who are not this customer. Scoring sorts them, and these caps stop
// one lead from spending hundreds of API calls chasing "Smith".
const MAX_CONTACTS_PER_DEPARTMENT = 25;
const MAX_CONTACTS_INSPECTED = 6;
const MAX_JOBS_PER_CONTACT = 10;

// How many search results are worth expanding to get their phone numbers.
// The search returns phone entries as links with no digits in them, so a
// customer whose only distinguishing evidence is their phone number scores as
// nothing and gets dropped before anyone looks. Expanding costs one GET each,
// so it is bounded — surname first, since those are the plausible ones.
const MAX_CONTACTS_HYDRATED = 10;

/**
 * Candidate scores. A number would invite arithmetic that means nothing; these
 * are named because the caller branches on them, not on how big they are.
 */
export const CONFIDENCE = {
  /** Phone or email matches exactly. Same person, near enough to certain. */
  STRONG: 'strong',
  /** Property address matches. Same house — possibly a different person in it. */
  PROPERTY: 'property',
  /** Names line up but nothing else confirms it. Could easily be a namesake. */
  WEAK: 'weak',
};

/**
 * Look for prior work on this customer across every department.
 *
 * Returns { candidates, errors, searched }. It never throws for a department
 * that failed — a lead should not be lost because one company's key expired —
 * but the failure is returned so the caller can say the search was incomplete
 * rather than pretending it came back clean.
 */
export async function findHistory(lead, { departments = SEARCH_DEPARTMENTS, log = () => {} } = {}) {
  const terms = searchTerms(lead);
  const candidates = [];
  const errors = [];
  const searched = [];

  if (terms.length === 0) {
    return {
      candidates,
      errors: [{ department: null, message: 'lead has no name to search on' }],
      searched,
    };
  }

  for (const key of departments) {
    const department = DEPARTMENTS[key];
    const apiKey = process.env[department.keyVar];

    if (!apiKey) {
      errors.push({ department: key, message: `no key in ${department.keyVar}` });
      continue;
    }

    const client = createClient({ apiKey, label: key });

    try {
      const found = await searchDepartment({ client, department: key, terms, lead, log });
      candidates.push(...found);
      searched.push(key);
    } catch (err) {
      errors.push({ department: key, message: err.message });
    }
  }

  // Strongest first, so a caller that only looks at the head of the list is
  // looking at the most convincing match rather than an arbitrary one.
  const order = { [CONFIDENCE.STRONG]: 0, [CONFIDENCE.PROPERTY]: 1, [CONFIDENCE.WEAK]: 2 };
  candidates.sort((a, b) => order[a.confidence] - order[b.confidence]);

  return { candidates, errors, searched };
}

/**
 * Unassigned leads per department, fetched once per run.
 *
 * GET /jobs/{id} will not return them, so without this every lead still
 * sitting in Lead (Unassigned) is a job we can see the existence of and
 * nothing more. That is the freshest and most dangerous kind of prior work —
 * a quote sent three weeks ago has not moved milestone yet.
 */
const unassignedCache = new Map();

async function unassignedByContact(client, department, log) {
  if (unassignedCache.has(department)) return unassignedCache.get(department);

  const byContact = new Map();
  try {
    const { jobs, complete } = await client.listUnassignedJobs();
    if (!complete) {
      log(`      ${department}: unassigned lead list truncated — older ones not read`);
    }
    for (const job of jobs) {
      for (const contact of job.contacts ?? []) {
        const contactId = contact?.contact?.id ?? contact?.id;
        if (!contactId) continue;
        if (!byContact.has(contactId)) byContact.set(contactId, []);
        byContact.get(contactId).push(job);
      }
    }
  } catch (err) {
    log(`      ${department}: unassigned leads not readable — ${err.message}`);
  }

  unassignedCache.set(department, byContact);
  return byContact;
}

async function searchDepartment({ client, department, terms, lead, log }) {
  const byContactId = new Map();

  for (const term of terms) {
    let contacts;
    try {
      contacts = await client.searchContacts(term, { pageSize: MAX_CONTACTS_PER_DEPARTMENT });
    } catch (err) {
      // A single term failing is not the whole department failing — surname
      // may work where "First Last" does not.
      log(`      ${department}: search "${term}" failed — ${err.message}`);
      continue;
    }

    for (const contact of contacts) {
      if (contact?.id && !byContactId.has(contact.id)) byContactId.set(contact.id, contact);
    }
  }

  const contacts = await hydrate([...byContactId.values()], { client, department, lead, log });

  // Score everything, then only pay for job lookups on the ones worth it.
  const scored = contacts
    .map((contact) => ({ contact, ...score(contact, lead) }))
    .filter((entry) => entry.confidence !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_CONTACTS_INSPECTED);

  log(
    `      ${department}: ${byContactId.size} contact(s) matched by name, ` +
      `${scored.length} worth inspecting`
  );

  const results = [];

  for (const entry of scored) {
    let jobs = [];
    try {
      jobs = await client.getContactJobs(entry.contact.id, { pageSize: MAX_JOBS_PER_CONTACT });
    } catch (err) {
      log(`      ${department}: jobs for ${entry.contact.id} failed — ${err.message}`);
    }

    // Only { id, _link } comes back, so each job has to be fetched to learn
    // who owns it and what it was. Capped: a contact with 40 jobs is a
    // property manager, and the first few are enough to see the pattern.
    const unassigned = await unassignedByContact(client, department, log);
    const unassignedForContact = new Map(
      (unassigned.get(entry.contact.id) ?? []).map((job) => [job.id, job])
    );

    const details = [];
    for (const job of jobs.slice(0, MAX_JOBS_PER_CONTACT)) {
      if (!job?.id) continue;
      try {
        const full = await client.getJob(job.id);

        // GET /jobs/{id} refuses unassigned leads. Fall back to the listing,
        // which does return them, before concluding there is nothing here.
        if (full?.unreadable) {
          const fromListing = unassignedForContact.get(job.id);
          if (fromListing) {
            const summary = summariseJob(fromListing);
            summary.unassigned = true;
            details.push(summary);
          } else {
            // Known to exist, readable by neither route. Reporting it as an
            // opaque prior job beats dropping it — it is still evidence this
            // customer has been here.
            details.push({
              id: job.id,
              jobNumber: null,
              representative: null,
              milestone: null,
              workType: null,
              createdDate: null,
              address: null,
              unreadable: true,
              keys: [],
            });
          }
          continue;
        }

        const summary = summariseJob(full);
        // Who owns this job is the whole point of looking at it — a returning
        // customer whose last job was Francis's should not be handed to Alex
        // by rotation. It costs one more GET because the job payload does not
        // carry it.
        summary.representative = await representativeName(client, department, job.id, log);
        details.push(summary);
      } catch (err) {
        log(`      ${department}: job ${job.id} failed — ${err.message}`);
      }
    }

    results.push({
      department,
      confidence: entry.confidence,
      reasons: entry.reasons,
      contactId: entry.contact.id,
      name: [entry.contact.firstName, entry.contact.lastName].filter(Boolean).join(' '),
      companyName: entry.contact.companyName || null,
      address: formatAddress(entry.contact.mailingAddress) || formatAddress(entry.contact.billingAddress),
      jobs: details,
    });
  }

  return results;
}

/**
 * Fill in the phone numbers and email addresses the search left as links.
 *
 * Skipped entirely when there is nothing to compare against, or when the
 * search already returned real digits — the endpoint's description claims it
 * does, and its schema says otherwise, so this checks rather than assuming
 * either way.
 */
async function hydrate(contacts, { client, department, lead, log }) {
  if (!lead.phone && !lead.email) return contacts;

  const needsExpanding = (contact) =>
    [...(contact.phoneNumbers ?? []), ...(contact.emailAddresses ?? [])].some(
      (entry) => entry && typeof entry === 'object' && !entry.number && !entry.address
    );

  const targets = contacts.filter(needsExpanding).slice(0, MAX_CONTACTS_HYDRATED);
  if (targets.length === 0) return contacts;

  if (contacts.filter(needsExpanding).length > MAX_CONTACTS_HYDRATED) {
    log(
      `      ${department}: ${contacts.length} name matches, only ${MAX_CONTACTS_HYDRATED} ` +
        `expanded for phone — a phone-only match beyond that would be missed`
    );
  }

  const expanded = new Map();
  for (const contact of targets) {
    try {
      const full = await client.getContact(contact.id);
      if (full) expanded.set(contact.id, full);
    } catch (err) {
      log(`      ${department}: contact ${contact.id} not expanded — ${err.message}`);
    }
  }

  return contacts.map((contact) => expanded.get(contact.id) ?? contact);
}

/**
 * What to type into the search box. Surname alone is deliberately first and
 * broadest: it is what catches a different first name at the same household,
 * which is half the point of searching at all.
 */
export function searchTerms(lead) {
  const terms = [];
  const last = (lead.lastName || '').trim();
  const first = (lead.firstName || '').trim();

  if (last) terms.push(last);
  // Company name is searchable too, and a commercial lead is far more likely
  // to be matched on it than on whoever happened to call.
  if (lead.companyName) terms.push(lead.companyName.trim());
  // Only worth a second call when there is no surname to have searched on.
  if (!last && first) terms.push(first);

  return [...new Set(terms.filter(Boolean))];
}

/**
 * How much this contact looks like this lead.
 *
 * Returns { confidence, reasons, rank } or confidence null for contacts that
 * matched the search term but agree with the lead on nothing else — a surname
 * search returns every namesake in the company, and treating those as history
 * would flag half the leads that come in.
 */
export function score(contact, lead) {
  const reasons = [];

  const leadPhone = normaliseDigits(lead.phone);
  const contactPhones = extractPhones(contact).map(normaliseDigits).filter(Boolean);
  if (leadPhone && contactPhones.includes(leadPhone)) {
    reasons.push('phone matches');
  }

  const leadEmail = (lead.email || '').trim().toLowerCase();
  const contactEmails = extractEmails(contact).map((e) => e.toLowerCase());
  if (leadEmail && contactEmails.includes(leadEmail)) {
    reasons.push('email matches');
  }

  const addressHit = addressMatches(lead.address, contact.mailingAddress) ||
    addressMatches(lead.address, contact.billingAddress);
  if (addressHit) reasons.push('property address matches');

  const sameLast = equalish(lead.lastName, contact.lastName);
  const sameFirst = equalish(lead.firstName, contact.firstName);
  if (sameLast && sameFirst) reasons.push('same first and last name');
  else if (sameLast) reasons.push('same last name');

  if (reasons.includes('phone matches') || reasons.includes('email matches')) {
    return { confidence: CONFIDENCE.STRONG, reasons, rank: 0 };
  }
  if (addressHit) {
    return { confidence: CONFIDENCE.PROPERTY, reasons, rank: 1 };
  }
  if (sameLast && sameFirst) {
    return { confidence: CONFIDENCE.WEAK, reasons, rank: 2 };
  }

  // Matched the search term but nothing else lines up. Not history.
  return { confidence: null, reasons, rank: 99 };
}

/**
 * Field names confirmed from a live GET /jobs/{id}, not guessed. The payload
 * carries exactly:
 *
 *   _link, contacts, createdDate, currentMilestone, geoLocation, id,
 *   jobCategory, jobName, jobNumber, leadDeadReason, leadSource,
 *   locationAddress, milestoneDate, modifiedDate, priority, tradeTypes,
 *   workType
 *
 * Note what is absent: nothing about people. The representative is a separate
 * resource and is filled in by the caller — see attachRepresentative.
 */
export function summariseJob(job) {
  return {
    id: job.id ?? null,
    jobNumber: job.jobNumber ?? null,
    representative: null,
    milestone: nameOf(job.currentMilestone),
    workType: nameOf(job.workType),
    createdDate: job.createdDate ?? null,
    address: formatAddress(job.locationAddress),
    // Kept so an unexpected payload shows up as a changed field list rather
    // than as silently empty output.
    keys: Object.keys(job),
  };
}

/**
 * The representative comes back as a user GUID, and GUIDs are per-company —
 * the same person is a different ID in each. So it is resolved against that
 * department's own user map rather than looked up globally.
 *
 * An unresolved GUID is reported as-is rather than dropped: it means someone
 * was added in AccuLynx and departments.js has not caught up, and a visible
 * GUID prompts that fix where a silent null would not.
 */
async function representativeName(client, department, jobId, log) {
  let userId;
  try {
    userId = await client.getCompanyRepresentative(jobId);
  } catch (err) {
    log(`      ${department}: representative for job ${jobId} failed — ${err.message}`);
    return null;
  }
  if (!userId) return null;

  const users = DEPARTMENTS[department]?.users ?? {};
  for (const [name, id] of Object.entries(users)) {
    if (id === userId) return name;
  }
  return `unknown user ${userId}`;
}

function nameOf(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return (
      value.name ||
      [value.firstName, value.lastName].filter(Boolean).join(' ') ||
      value.description ||
      null
    );
  }
  return String(value);
}

/**
 * The contact search response types phoneNumbers and emailAddresses as links —
 * { id, _link } — even though the endpoint description claims the numbers
 * themselves come back. Both readings are handled: whichever is true, this
 * finds the value if it is there and reports nothing if it is not, rather than
 * inventing a match from an object that has no number in it.
 */
function extractPhones(contact) {
  return (contact.phoneNumbers ?? [])
    .map((entry) =>
      typeof entry === 'string' ? entry : entry?.number ?? entry?.phoneNumber ?? null
    )
    .filter(Boolean);
}

function extractEmails(contact) {
  return (contact.emailAddresses ?? [])
    .map((entry) =>
      typeof entry === 'string' ? entry : entry?.address ?? entry?.emailAddress ?? null
    )
    .filter(Boolean);
}

/**
 * Same house? Street line plus zip, both loosened — "123 Main St." and
 * "123 MAIN STREET" are the same address, and a full string compare says they
 * are not.
 */
export function addressMatches(leadAddress, contactAddress) {
  if (!leadAddress || !contactAddress) return false;

  const leadZip = String(leadAddress.zipCode ?? '').slice(0, 5);
  const contactZip = String(contactAddress.zipCode ?? '').slice(0, 5);
  if (!leadZip || leadZip !== contactZip) return false;

  const a = normaliseStreet(leadAddress.street1);
  const b = normaliseStreet(contactAddress.street1);
  return Boolean(a) && a === b;
}

const STREET_WORDS = {
  street: 'st',
  road: 'rd',
  avenue: 'ave',
  drive: 'dr',
  lane: 'ln',
  court: 'ct',
  circle: 'cir',
  boulevard: 'blvd',
  place: 'pl',
  terrace: 'ter',
  trail: 'trl',
  parkway: 'pkwy',
  highway: 'hwy',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
};

export function normaliseStreet(street) {
  if (!street) return '';
  return String(street)
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_WORDS[word] ?? word)
    .join(' ');
}

function equalish(a, b) {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  return Boolean(left) && left === right;
}

function normaliseDigits(value) {
  if (!value) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function formatAddress(address) {
  if (!address) return null;
  const state = address.state?.abbreviation ?? address.state?.name ?? address.state ?? '';
  const parts = [address.street1, address.city, [state, address.zipCode].filter(Boolean).join(' ')];
  const text = parts.filter(Boolean).join(', ').trim();
  return text || null;
}

// CLOSING THE DIFFERENT-SURNAME GAP
//
// Address is not searchable, so the only way to match on it is to already hold
// the addresses locally. A nightly crawl would do it: POST /contacts/search
// takes a CreationDate range, so each night asks for contacts created since
// the last crawl and appends them to an index keyed by normalised street plus
// zip. Steady-state that is a handful of pages per department per night, and
// the lookup then costs nothing at lead time.
//
// Not built yet. It is a real amount of machinery for one case, and the case
// is worth measuring first — the flags this produces will show how often a
// property comes back under a name we could not have searched for.
