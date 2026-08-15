// Turns lead intake posts in RingCentral team chat into leads in AccuLynx.
//
// Runs in dry-run mode unless SYNC_APPLY=true. Dry runs print exactly what
// would be created and touch nothing, because the failure mode here is writing
// junk into a live CRM that someone then has to clean up by hand.

import { getAccessToken } from './ringcentral.js';
import { fetchPosts } from './ringcentral-posts.js';
import { parseIntakePosts, buildNotes } from './parse-intake.js';
import { LEAD_CHANNELS } from './acculynx-ids.js';
import { createContact, createJob, findJobForPost, stampPostReference } from './acculynx.js';

const APPLY = process.env.SYNC_APPLY === 'true';
const LOOKBACK_DAYS = Number(process.env.SYNC_LOOKBACK_DAYS || 7);

async function main() {
  console.log(APPLY ? 'MODE: APPLY — will create records in AccuLynx' : 'MODE: DRY RUN — nothing will be created');
  console.log(`Looking back ${LOOKBACK_DAYS} day(s)\n`);

  if (APPLY) await preflight();

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const token = await getAccessToken();

  const stats = { posts: 0, leads: 0, skipped: 0, created: 0, failed: 0 };

  for (const [chatId, channel] of Object.entries(LEAD_CHANNELS)) {
    console.log('='.repeat(70));
    console.log(`${channel.name}  (work type ${channel.workType})`);
    console.log('='.repeat(70));

    let posts;
    try {
      posts = await fetchPosts(token, chatId, { since });
    } catch (err) {
      // One unreadable channel shouldn't stop the others.
      console.error(`  FAILED to read channel: ${err.message}`);
      stats.failed += 1;
      continue;
    }

    stats.posts += posts.length;
    console.log(`  ${posts.length} post(s) in the window\n`);

    for (const post of posts) {
      const leads = parseIntakePosts(post.text);
      // Posts without "Customer Name:" are ordinary conversation, which all
      // three channels carry.
      if (leads.length === 0) continue;

      for (const [index, lead] of leads.entries()) {
        stats.leads += 1;
        // A single post can carry several intake forms, so the reference has
        // to identify the lead, not just the post.
        const reference = leads.length > 1 ? `${post.id}#${index}` : String(post.id);
        await handleLead({ lead, post, channel, reference, stats });
      }
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(
    `${stats.posts} post(s) read, ${stats.leads} lead(s) found, ` +
      `${stats.skipped} already in AccuLynx, ${stats.created} created, ${stats.failed} failed`
  );

  if (!APPLY && stats.leads > stats.skipped) {
    console.log('\nDry run — set SYNC_APPLY=true to create these for real.');
  }
  if (stats.failed > 0) process.exitCode = 1;
}

async function handleLead({ lead, post, channel, reference, stats }) {
  const who = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)';
  const notes = buildNotes(lead, { channel: channel.name, postedAt: post.creationTime });

  try {
    const existing = await findJobForPost(reference);
    if (existing) {
      stats.skipped += 1;
      console.log(`  SKIP    ${who} — already synced`);
      return;
    }
  } catch (err) {
    // Failing open here would risk duplicating a lead already in the CRM.
    stats.failed += 1;
    console.error(`  FAILED  ${who} — could not check for an existing job: ${err.message}`);
    return;
  }

  if (!APPLY) {
    console.log(`  WOULD CREATE  ${who}`);
    console.log(`      phone     ${lead.phone ?? '(none usable)'}`);
    console.log(`      email     ${lead.email ?? '(none)'}`);
    console.log(`      address   ${lead.address ? formatAddress(lead.address) : '(unparsed — see notes)'}`);
    console.log(`      workType  ${channel.workType}`);
    console.log(`      source    ${lead.leadSourceId ?? '(unmatched — see notes)'}`);
    console.log(`      notes     ${notes.split('\n')[0]}...`);
    return;
  }

  try {
    const contactId = await createContact(lead);
    const jobId = await createJob({
      contactId,
      workType: channel.workType,
      address: lead.address,
      leadSourceId: lead.leadSourceId,
      notes,
    });
    // Immediately, so an interruption leaves at most one duplicate rather than
    // recreating this lead on every future run.
    await stampPostReference(jobId, reference);

    stats.created += 1;
    console.log(`  CREATED ${who} — job ${jobId}`);
  } catch (err) {
    stats.failed += 1;
    console.error(`  FAILED  ${who} — ${err.message}`);
  }
}

/**
 * Refuse to write unless dedup is known to work. If the external-reference
 * lookup is broken, every run would recreate every lead, and the mess lands in
 * a live CRM. Better to stop.
 */
async function preflight() {
  try {
    await findJobForPost('preflight-check-no-such-post');
    console.log('Preflight: dedup lookup responding\n');
  } catch (err) {
    console.error(`Preflight FAILED: ${err.message}`);
    console.error('Refusing to create anything without working duplicate detection —');
    console.error('every run would otherwise recreate every lead.');
    process.exit(1);
  }
}

function formatAddress(a) {
  return `${a.street1}, ${a.city}, ${a.state} ${a.zipCode}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
