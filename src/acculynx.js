// AccuLynx "Create New Lead" — mirrors the UI form fields visible at
// apidocs.acculynx.com. The exact API endpoint path and JSON field names
// may need adjustment once tested against the live API; the shape here
// matches the UI form and the HomeAdvisor-lead reference endpoint pattern.

const AL_BASE = process.env.ACCULYNX_API_BASE || 'https://api.acculynx.com/api/v2';

// Configurable defaults for dropdown fields that voicemails can't provide.
// Override via env vars to match the values in your AccuLynx account.
const DEFAULTS = {
  jobCategory: process.env.AL_JOB_CATEGORY || 'Residential',
  tradeType: process.env.AL_TRADE_TYPE || 'Roofing',
  leadSource: process.env.AL_LEAD_SOURCE || 'Phone Call',
  country: 'USA',
};

async function createLead({ firstName, lastName, phone, email, workType, notes }) {
  const apiKey = requireEnv('ACCULYNX_API_KEY');

  const body = {
    // Primary Contact
    firstName: firstName || 'Unknown',
    lastName: lastName || 'Caller',
    phone: phone || '',
    phoneType: 'Mobile',
    email: email || '',
    emailType: 'Other',

    // Location Information — voicemails don't carry an address, so we use
    // placeholders. Fill in the real address inside AccuLynx after the lead
    // is created.
    street: 'TBD',
    city: 'TBD',
    state: 'FL',
    zip: '00000',
    country: DEFAULTS.country,

    // Job classification
    jobCategory: DEFAULTS.jobCategory,
    workType: workType || 'Reroof',   // "Reroof" or "Service"
    tradeType: DEFAULTS.tradeType,
    leadSource: DEFAULTS.leadSource,

    // Notes
    notes: (notes || '').slice(0, 1000),
    priorityLevel: 'Normal',
  };

  const res = await fetch(`${AL_BASE}/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AccuLynx lead creation failed (${res.status}): ${text}`);
  }

  return res.json();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export { createLead };
