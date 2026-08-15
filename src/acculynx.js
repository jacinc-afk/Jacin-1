// AccuLynx API V2 client, covering just what the lead sync needs.
//
// Shapes here come from the published OpenAPI specs, not from inference:
//
//   POST /contacts  -> { id }        contactTypeIds is required, minItems 1
//   POST /jobs      -> { id }        contact: { id } is required; creates the
//                                    job in the Lead (Unassigned) milestone,
//                                    which is what AccuLynx calls a lead
//
// There is no create-lead endpoint. A lead *is* a job in that milestone.

import { CONTACT_TYPES, JOB_CATEGORIES } from './acculynx-ids.js';

const BASE = process.env.ACCULYNX_API_BASE || 'https://api.acculynx.com/api/v2';

// Identifies rows this sync created, so a post can be traced to its job and
// vice versa.
export const EXTERNAL_SOURCE = 'ringcentral-team-messaging';

// Confirmed by probing; see src/discover.js.
const EXTERNAL_REFS_PATH = process.env.AL_EXTERNAL_REFS_PATH || '/jobs/external-references';

/**
 * Has this RingCentral post already produced a job?
 *
 * Dedup lives in AccuLynx rather than in a file this repo keeps: the CRM is
 * the thing that actually holds the leads, so it is the honest place to ask.
 * A local tracker can drift from reality — restored from an old commit, or
 * written after a crash — and drift there means duplicate customer records.
 */
export async function findJobForPost(postId) {
  const res = await request(
    `${EXTERNAL_REFS_PATH}${EXTERNAL_REFS_PATH.includes('?') ? '&' : '?'}` +
      `source=${encodeURIComponent(EXTERNAL_SOURCE)}&projectId=${encodeURIComponent(postId)}`
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`External reference lookup failed (${res.status}): ${truncate(res.body, 300)}`);
  }

  const items = res.json?.items ?? [];
  return items.length > 0 ? items[0] : null;
}

/**
 * Record which RingCentral post produced this job. Done immediately after the
 * job is created so a crash in between leaves at most one duplicate rather
 * than repeating on every subsequent run.
 */
export async function stampPostReference(jobId, postId) {
  const res = await request(`/jobs/${jobId}/external-references`, {
    method: 'POST',
    body: { source: EXTERNAL_SOURCE, projectId: String(postId) },
  });

  if (!res.ok) {
    throw new Error(`Stamping external reference failed (${res.status}): ${truncate(res.body, 300)}`);
  }
}

export async function createContact(lead) {
  const body = {
    contactTypeIds: [CONTACT_TYPES.Customer],
    firstName: lead.firstName || 'Unknown',
    lastName: lead.lastName || 'Caller',
  };

  // Exactly 10 digits or omitted — the parser returns null for anything that
  // can't be reduced to that, and a rejected contact loses the whole lead.
  if (lead.phone) {
    body.phoneNumbers = [{ number: lead.phone, type: 'Mobile', primary: true }];
  }
  if (lead.email) {
    body.emailAddresses = [{ address: lead.email, type: 'Personal', primary: true }];
  }

  // No mailingAddress: contacts take state and country as integer IDs, which
  // would need two more lookups, while the job's locationAddress takes them as
  // plain strings and is where the property address belongs anyway.

  const res = await request('/contacts', { method: 'POST', body });

  if (!res.ok) {
    throw new Error(`Contact creation failed (${res.status}): ${truncate(res.body, 300)}`);
  }
  return res.json.id;
}

export async function createJob({ contactId, workType, address, leadSourceId, notes }) {
  const body = {
    contact: { id: contactId },
    jobCategory: { id: JOB_CATEGORIES.Residential },
    workType: { id: workType },
    priority: 'Normal',
  };

  // locationAddress is all-or-nothing: supply the object and street1, city,
  // state, country and zipCode are all required. The parser returns a complete
  // address or null, never a partial one, so this is safe to spread.
  if (address) body.locationAddress = address;
  if (leadSourceId) body.leadSource = { id: leadSourceId };
  if (notes) body.notes = notes.slice(0, 1000);

  const res = await request('/jobs', { method: 'POST', body });

  if (!res.ok) {
    throw new Error(`Job creation failed (${res.status}): ${truncate(res.body, 300)}`);
  }
  return res.json.id;
}

/**
 * Writes are rate limited per hour and per day. On a 429 the response says how
 * long to wait, so wait rather than dropping the lead — a dropped lead is a
 * customer nobody calls back.
 */
async function request(path, { method = 'GET', body, attempt = 0 } = {}) {
  const apiKey = requireEnv('ACCULYNX_API_KEY');

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after')) || 60;
    const policy = res.headers.get('ratelimit-policy') || 'unknown';
    console.warn(`  rate limited (${policy}); waiting ${retryAfter}s before retry`);
    await sleep(retryAfter * 1000);
    return request(path, { method, body, attempt: attempt + 1 });
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 429s come back as text/plain; the caller reports via `body`.
  }

  return { ok: res.ok, status: res.status, body: text, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}
