// AccuLynx API V2 client, covering just what the lead sync needs.
//
// Shapes here come from the published OpenAPI specs, not from inference:
//
//   POST /contacts             -> { id }   contactTypeIds required, minItems 1
//   POST /jobs                 -> { id }   contact:{id} required; creates the
//                                          job in Lead (Unassigned), which is
//                                          what AccuLynx calls a lead
//   POST /contacts/search      -> collection; startDate, endDate, sort are all
//                                          REQUIRED, and it filters on the
//                                          contact's CreationDate
//   GET  /contacts/{id}/jobs   -> collection of { id, _link } and nothing else
//
// There is no create-lead endpoint. A lead *is* a job in that milestone.
//
// Every call is made through a client bound to one API key, because a key is
// bound to one AccuLynx company and each department is a separate company.
// Searching a customer's history means asking all three, so the key can no
// longer be a module-level global.

import { CONTACT_TYPES, JOB_CATEGORIES } from './acculynx-ids.js';

const BASE = process.env.ACCULYNX_API_BASE || 'https://api.acculynx.com/api/v2';

// Identifies rows this sync created, so a post can be traced to its job and
// vice versa.
export const EXTERNAL_SOURCE = 'ringcentral-team-messaging';

// Confirmed by probing; see src/discover.js.
const EXTERNAL_REFS_PATH = process.env.AL_EXTERNAL_REFS_PATH || '/jobs/external-references';

// Search filters on CreationDate and both bounds are mandatory, so "all of
// history" has to be spelled out. AccuLynx did not exist in 2000; anything
// earlier than this is not a real record.
const EPOCH = '2000-01-01T00:00:00Z';

/**
 * A client bound to one company's API key.
 *
 * `label` is only used in error messages — when three departments are being
 * searched at once, "search failed" without saying which one is useless.
 */
export function createClient({ apiKey, label = 'acculynx' }) {
  if (!apiKey) throw new Error(`createClient(${label}): no API key`);

  async function request(path, { method = 'GET', body, attempt = 0 } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    // Writes are rate limited per hour and per day. On a 429 the response says
    // how long to wait, so wait rather than dropping the lead — a dropped lead
    // is a customer nobody calls back.
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after')) || 60;
      const policy = res.headers.get('ratelimit-policy') || 'unknown';
      console.warn(`  [${label}] rate limited (${policy}); waiting ${retryAfter}s`);
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

  /**
   * Has this RingCentral post already produced a job?
   *
   * Dedup lives in AccuLynx rather than in a file this repo keeps: the CRM is
   * the thing that actually holds the leads, so it is the honest place to ask.
   * A local tracker can drift from reality — restored from an old commit, or
   * written after a crash — and drift there means duplicate customer records.
   */
  async function findJobForPost(postId) {
    const res = await request(
      `${EXTERNAL_REFS_PATH}?source=${encodeURIComponent(EXTERNAL_SOURCE)}` +
        `&projectId=${encodeURIComponent(postId)}`
    );

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `[${label}] External reference lookup failed (${res.status}): ${truncate(res.body, 300)}`
      );
    }

    // The read endpoint's response schema is not something I have seen. The
    // write returns a bare object rather than a collection, and assuming
    // { items: [...] } here silently found nothing — which reads exactly like
    // "no duplicate" and recreated a lead that already existed. So accept any
    // of the plausible shapes, and require a jobId before believing a match,
    // so an error body can never be mistaken for one.
    const matches = normaliseReferences(res.json).filter((r) => r?.jobId);

    if (matches.length === 0 && res.json != null) {
      console.log(`      (no match; response shape: ${describeShape(res.json)})`);
    }

    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Record which RingCentral post produced this job. Done immediately after
   * the job is created so a crash in between leaves at most one duplicate
   * rather than repeating on every subsequent run.
   */
  async function stampPostReference(jobId, postId) {
    // The job is identified in the body, not the path — posting to
    // /jobs/{jobId}/external-references returns 404.
    const res = await request(EXTERNAL_REFS_PATH, {
      method: 'POST',
      body: { jobId, source: EXTERNAL_SOURCE, projectId: String(postId) },
    });

    if (!res.ok) {
      // The job already exists at this point, so name it — an unstamped job is
      // invisible to dedup and will be recreated on the next run unless
      // someone deletes it or stamps it by hand.
      throw new Error(
        `[${label}] Stamping external reference failed (${res.status}) for job ${jobId}, ` +
          `post ${postId}. The job EXISTS but is not deduped. ${truncate(res.body, 200)}`
      );
    }
  }

  /**
   * Contacts whose first name, last name or company name match `searchTerm`.
   *
   * Phone number is NOT a search criterion — the spec lists first name, last
   * name, company name and contact type, and nothing else. So a returning
   * customer is found by name, and the phone and address that come back are
   * used to confirm or reject the match, not to find it.
   */
  async function searchContacts(searchTerm, { pageSize = 25, pageStartIndex = 0 } = {}) {
    // A day of slack on the upper bound: the runner's clock and AccuLynx's
    // need not agree, and a contact created "in the future" relative to us
    // would silently fall outside the window.
    const endDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await request(
      `/contacts/search?pageSize=${pageSize}&pageStartIndex=${pageStartIndex}`,
      {
        method: 'POST',
        body: {
          searchTerm,
          startDate: EPOCH,
          endDate,
          // Required, so it may as well be useful: most recent first means the
          // first page holds the contacts most likely to be relevant.
          sort: { sortDirection: 'Descending', sortColumn: 'CreatedDate' },
        },
      }
    );

    if (!res.ok) {
      throw new Error(
        `[${label}] Contact search failed (${res.status}) for "${searchTerm}": ` +
          `${truncate(res.body, 300)}`
      );
    }
    return res.json?.items ?? [];
  }

  /**
   * Jobs this contact is attached to. The response carries only { id, _link }
   * per job — no milestone, no representative, no address — so anything worth
   * knowing about a prior job needs a separate getJob call.
   */
  async function getContactJobs(contactId, { pageSize = 50 } = {}) {
    const res = await request(`/contacts/${contactId}/jobs?pageSize=${pageSize}`);

    // A contact with no jobs answers 200 with an empty array; 404 means the
    // contact itself is gone, which is not an error worth failing a lead over.
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(
        `[${label}] Contact jobs lookup failed (${res.status}) for ${contactId}: ` +
          `${truncate(res.body, 300)}`
      );
    }
    return res.json?.items ?? [];
  }

  /**
   * Who the job is assigned to. This is not on the job payload — GET /jobs/{id}
   * returns _link, contacts, createdDate, currentMilestone, geoLocation, id,
   * jobCategory, jobName, jobNumber, leadDeadReason, leadSource,
   * locationAddress, milestoneDate, modifiedDate, priority, tradeTypes and
   * workType, and nothing about people. The representative is its own
   * sub-resource, confirmed live:
   *
   *   GET /jobs/{id}/representatives/company
   *     -> { id, type: "CompanyRepresentative", user: { id, _link }, _link }
   *
   * Returns the user's GUID, or null when the job has no representative — an
   * unassigned lead is exactly that, and it is not an error.
   */
  async function getCompanyRepresentative(jobId) {
    const res = await request(`/jobs/${jobId}/representatives/company`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `[${label}] Representative lookup failed (${res.status}) for ${jobId}: ` +
          `${truncate(res.body, 200)}`
      );
    }
    return res.json?.user?.id ?? null;
  }

  /**
   * Assign the job. OPTIONS on this route answered `Allow: GET, POST`, so POST
   * is the method — not a guess, and not a PUT.
   *
   * The body is the one thing still inferred: it mirrors the shape the GET
   * returns, `{ user: { id } }`, which is also how every other reference on
   * this API is written (contact, leadSource, workType, jobCategory are all
   * `{ id }`). Verified against the Testing company before it is pointed at a
   * live one.
   *
   * The user GUID must come from the same company as the key. The same person
   * has a different ID in each, and sending another company's would either be
   * rejected or, worse, match somebody else.
   */
  async function setCompanyRepresentative(jobId, userId) {
    const res = await request(`/jobs/${jobId}/representatives/company`, {
      method: 'POST',
      body: { user: { id: userId } },
    });

    if (!res.ok) {
      throw new Error(
        `[${label}] Assigning job ${jobId} to user ${userId} failed (${res.status}): ` +
          `${truncate(res.body, 300)}`
      );
    }
    return res.json;
  }

  async function getJob(jobId) {
    const res = await request(`/jobs/${jobId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `[${label}] Job lookup failed (${res.status}) for ${jobId}: ${truncate(res.body, 300)}`
      );
    }
    return res.json;
  }

  async function createContact(lead) {
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
    // would need two more lookups, while the job's locationAddress takes them
    // as plain strings and is where the property address belongs anyway.

    const res = await request('/contacts', { method: 'POST', body });

    if (!res.ok) {
      throw new Error(`[${label}] Contact creation failed (${res.status}): ${truncate(res.body, 300)}`);
    }
    return res.json.id;
  }

  async function createJob({ contactId, workType, address, leadSourceId, notes }) {
    const body = {
      contact: { id: contactId },
      jobCategory: { id: JOB_CATEGORIES.Residential },
      workType: { id: workType },
      priority: 'Normal',
    };

    // locationAddress is all-or-nothing: supply the object and street1, city,
    // state, country and zipCode are all required. The parser returns a
    // complete address or null, never a partial one, so this is safe to spread.
    if (address) body.locationAddress = address;
    if (leadSourceId) body.leadSource = { id: leadSourceId };
    if (notes) body.notes = notes.slice(0, 1000);

    const res = await request('/jobs', { method: 'POST', body });

    if (!res.ok) {
      throw new Error(`[${label}] Job creation failed (${res.status}): ${truncate(res.body, 300)}`);
    }
    return res.json.id;
  }

  return {
    label,
    request,
    findJobForPost,
    stampPostReference,
    searchContacts,
    getContactJobs,
    getJob,
    getCompanyRepresentative,
    setCompanyRepresentative,
    createContact,
    createJob,
  };
}

function normaliseReferences(json) {
  if (json == null) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.records)) return json.records;
  if (typeof json === 'object' && 'jobId' in json) return [json];
  return [];
}

function describeShape(json) {
  if (Array.isArray(json)) return `array(${json.length})`;
  if (typeof json === 'object') return `object{${Object.keys(json).join(',')}}`;
  return typeof json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}
