const RC_SERVER = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

async function getAccessToken() {
  const clientId = requireEnv('RC_CLIENT_ID');
  const clientSecret = requireEnv('RC_CLIENT_SECRET');
  const jwt = requireEnv('RC_JWT');

  const res = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`RingCentral auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Voicemail messages newer than `sinceIso`, oldest first.
async function fetchNewVoicemails(accessToken, sinceIso) {
  const url = new URL(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store`);
  url.searchParams.set('messageType', 'VoiceMail');
  url.searchParams.set('dateFrom', sinceIso);
  url.searchParams.set('perPage', '100');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`RingCentral message-store fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const records = data.records || [];
  return records.sort((a, b) => new Date(a.creationTime) - new Date(b.creationTime));
}

// Voicemail transcription text, if the account has voicemail-to-text enabled.
// RingCentral exposes this either directly on the message record (subject) or
// as a separate AudioTranscription attachment that has to be fetched.
async function getTranscription(accessToken, message) {
  if (message.subject && !/^voicemail from/i.test(message.subject.trim())) {
    return message.subject.trim();
  }

  const transcriptionAttachment = (message.attachments || []).find(
    (a) => a.type === 'AudioTranscription'
  );
  if (!transcriptionAttachment) return null;

  const res = await fetch(transcriptionAttachment.uri, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.text()).trim();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export { getAccessToken, fetchNewVoicemails, getTranscription };
