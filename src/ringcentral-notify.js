// Posting back into the RingCentral channel a lead came from.
//
// Leads that need a human decision — the intake names a salesperson, or the
// customer already has jobs under a different rep — are flagged here rather
// than assigned automatically. Replying in the same channel puts the flag
// where intake and the sales team already are, which beats anywhere else they
// would have to remember to check.

const RC_SERVER = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

// The docs show posting at /team-messaging/v1/groups/{groupId}/posts, while
// chats are read from /team-messaging/v1/chats/{chatId}/posts. Whether both
// accept a write is not something I have confirmed, so try in order and report
// what happened rather than assuming.
const POST_PATHS = [
  (id) => `/team-messaging/v1/chats/${id}/posts`,
  (id) => `/team-messaging/v1/groups/${id}/posts`,
];

/**
 * Post a message into a chat. Returns the created post, or throws with every
 * path's status so a failure is diagnosable rather than just "didn't work".
 */
export async function postMessage(token, chatId, text) {
  const failures = [];

  for (const buildPath of POST_PATHS) {
    const path = buildPath(chatId);
    const res = await fetch(`${RC_SERVER}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    const body = await res.text();
    if (res.ok) {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
    failures.push(`${path} -> ${res.status} ${truncate(body, 150)}`);
  }

  throw new Error(`Could not post to chat ${chatId}: ${failures.join(' | ')}`);
}

/**
 * The message for a lead that needs a decision. Kept short — this lands in a
 * working channel, and a wall of text gets scrolled past. Says what was found,
 * what was done, and what is needed.
 */
export function buildFlagMessage({ lead, reason, jobId, department, matches = [] }) {
  const who = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'this lead';
  const lines = [`⚠️ **${who}** needs a decision before assignment — ${reason}`];

  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (jobId) lines.push(`Created in ${department} as job ${jobId}, currently unassigned.`);

  for (const match of matches.slice(0, 5)) {
    const parts = [match.department, match.workType, match.rep && `rep: ${match.rep}`]
      .filter(Boolean)
      .join(' · ');
    lines.push(`Prior work — ${parts}`);
  }
  if (matches.length > 5) {
    lines.push(`…and ${matches.length - 5} more prior job(s).`);
  }

  return lines.join('\n');
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}
