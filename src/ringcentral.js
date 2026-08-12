// RingCentral JWT authentication.
//
// This is the only piece of the original voicemail implementation that
// survives the switch to Team Messaging — the token exchange is the same
// regardless of which API the token is then used against.
//
// Not yet exercised against the live API; it has never run with real
// credentials.

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export { getAccessToken };
