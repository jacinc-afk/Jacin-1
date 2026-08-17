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
 * The message for a lead that needs a decision.
 *
 * Kept short and specific: it lands in a private thread that gets read on a
 * phone, and the reader needs three things — who the customer is, why the
 * machine would not decide, and what it would have done. A wall of text gets
 * scrolled past, and a flag that gets scrolled past is the same as no flag.
 */
export function buildFlagMessage({ lead, who, reason, jobId, department, suggested, matches = [] }) {
  const name = who || [lead?.firstName, lead?.lastName].filter(Boolean).join(' ') || 'this lead';
  const lines = [`**${name}** needs a decision — ${reason}`];

  const contact = [lead?.phone, lead?.email].filter(Boolean).join('  ');
  if (contact) lines.push(contact);
  if (lead?.address) {
    lines.push(`${lead.address.street1}, ${lead.address.city} ${lead.address.zipCode}`);
  }

  if (jobId) {
    lines.push(`In ${department}: job ${jobId}, currently unassigned.`);
  }
  if (suggested) {
    lines.push(`Looks like it should be ${suggested}.`);
  }

  // The prior work is the evidence behind the flag. Without it the reader has
  // to go and find it themselves, which is the work the flag was meant to save.
  for (const match of matches.slice(0, 4)) {
    const label =
      match.confidence === 'strong' ? 'Same customer' :
      match.confidence === 'property' ? 'Same property' : 'Possibly';
    lines.push(`${label} in ${match.department}: ${match.name}${match.address ? ` — ${match.address}` : ''}`);

    for (const job of (match.jobs ?? []).slice(0, 3)) {
      const detail = [job.workType, job.milestone, job.representative && `rep ${job.representative}`]
        .filter(Boolean)
        .join(' · ');
      lines.push(`   ${job.jobNumber ? `#${job.jobNumber} ` : ''}${detail || 'no detail available'}`);
    }

    if (match.judgment) {
      lines.push(`   judged: ${match.judgment.reason}`);
    }
  }

  if (matches.length > 4) {
    lines.push(`…and ${matches.length - 4} more match(es).`);
  }

  return lines.join('\n');
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}
