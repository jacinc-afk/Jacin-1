// Reading posts out of RingCentral team chat.
//
// Chats are addressed by internal ID, not by the name shown in the app; see
// src/discover-ringcentral.js for how those were resolved.

const RC_SERVER = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

/**
 * Posts in a chat, newest first as the API returns them, reversed here to
 * oldest first so leads are created in the order they were called in.
 *
 * `since` filters client-side: the posts endpoint has no documented date
 * filter, so a page is fetched and old posts dropped. Dedup does not depend on
 * this being exact — it is a way to avoid paging back through years of chat,
 * not the thing that prevents duplicates.
 */
export async function fetchPosts(token, chatId, { since, limit = 100 } = {}) {
  const url = `${RC_SERVER}/team-messaging/v1/chats/${chatId}/posts?recordCount=${limit}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Fetching posts for chat ${chatId} failed (${res.status}): ${truncate(text, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Unparseable response for chat ${chatId}: ${truncate(text, 200)}`);
  }

  const records = data.records ?? [];
  const cutoff = since ? new Date(since).getTime() : null;

  return records
    .filter((post) => {
      if (!post.text) return false;
      if (!cutoff) return true;
      const created = new Date(post.creationTime).getTime();
      return Number.isFinite(created) && created >= cutoff;
    })
    .reverse();
}

function truncate(text, max) {
  return (text || '').length > max ? `${text.slice(0, max)}...` : text || '';
}
