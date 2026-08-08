// AccuLynx's exact API field names should be confirmed against your account's
// API docs (Settings > API in AccuLynx) before going live — this uses the
// commonly documented Leads endpoint/fields as a starting point.
const AL_BASE = process.env.ACCULYNX_API_BASE || 'https://api.acculynx.com/api/v2';

async function createLead({ name, phone, email, type, notes }) {
  const apiKey = requireEnv('ACCULYNX_API_KEY');

  const [firstName, ...rest] = (name || 'Unknown Caller').split(' ');
  const lastName = rest.join(' ') || '-';

  const body = {
    firstName,
    lastName,
    phoneNumbers: phone ? [{ number: phone, type: 'Mobile' }] : [],
    emailAddresses: email ? [{ address: email }] : [],
    leadSource: 'RingCentral Voicemail',
    projectType: type, // "Reroof" or "Service"
    notes,
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
    throw new Error(`AccuLynx lead creation failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export { createLead };
