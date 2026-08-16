// Turns lead intake posts in RingCentral team chat into leads in AccuLynx.
//
// Runs in dry-run mode unless SYNC_APPLY=true. Dry runs print exactly what
// would be created and touch nothing, because the failure mode here is writing
// junk into a live CRM that someone then has to clean up by hand.

import { getAccessToken } from './ringcentral.js';
import { fetchPosts } from './ringcentral-posts.js';
import { parseIntakePosts, buildNotes } from './parse-intake.js';
import { LEAD_CHANNELS } from './acculynx-ids.js';
import { createClient } from './acculynx.js';
import { CHANNEL_DEPARTMENT } from './departments.js';
import { findHistory, CONFIDENCE } from './history.js';
import { judgeCandidates, applyVerdicts } from './match-ai.js';

const APPLY = process.env.SYNC_APPLY === 'true';
const LOOKBACK_DAYS = Number(process.env.SYNC_LOOKBACK_DAYS || 7);

// Which company this run writes into. Leads are still routed per channel, but
// while the sync is being proved out everything goes to one target so a bad
// run cannot scatter junk across three live companies.
const TARGET = process.env.ACCULYNX_TARGET || 'test';
//
// There is deliberately no "production" target. ACCULYNX_API_KEY used to serve
// as one, and a fingerprint comparison confirmed it holds the identical key to
// ACCULYNX_KEY_SERVICE — a name that reads like "the live company" while
// actually reaching Service. Pointing a run at it believing otherwise would
// file reroof and warranty leads into the Service company.
const TARGET_KEY_VARS = {
  test: 'ACCULYNX_API_KEY_TEST',
  reroof: 'ACCULYNX_KEY_REROOF',
  service: 'ACCULYNX_KEY_SERVICE',
  warranties: 'ACCULYNX_KEY_WARRANTIES',
};

function writeClient() {
  const keyVar = TARGET_KEY_VARS[TARGET];
  if (!keyVar) throw new Error(`Unknown ACCULYNX_TARGET: ${TARGET}`);
  const apiKey = process.env[keyVar];
  if (!apiKey) throw new Error(`Missing ${keyVar} for target "${TARGET}"`);
  return createClient({ apiKey, label: TARGET });
}

const acculynx = writeClient();

async function main() {
  console.log(APPLY ? 'MODE: APPLY — will create records in AccuLynx' : 'MODE: DRY RUN — nothing will be created');
  console.log(`Looking back ${LOOKBACK_DAYS} day(s)\n`);

  if (APPLY) await preflight();

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const token = await getAccessToken();

  const stats = {
    posts: 0,
    leads: 0,
    skipped: 0,
    duplicates: 0,
    created: 0,
    failed: 0,
    // Jobs that were created but could not be stamped for dedup.
    unstamped: [],
  };

  // Intake re-posts the same lead when chasing it — the same customer appears
  // in two posts days apart, same phone and address. External references only
  // dedup by post, so without this each re-post becomes another customer
  // record for someone to merge by hand later.
  const seen = new Map();

  for (const [chatId, channel] of Object.entries(LEAD_CHANNELS)) {
    const department = CHANNEL_DEPARTMENT[chatId]?.department ?? '(unmapped)';
    console.log('='.repeat(70));
    console.log(`${channel.name}  ->  ${department}  (work type ${channel.workType})`);
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

        const key = identityOf(lead);
        if (key && seen.has(key)) {
          stats.duplicates += 1;
          const who = nameOf(lead);
          console.log(`  DUPE    ${who} — same person already handled from ${seen.get(key)}`);
          continue;
        }
        if (key) seen.set(key, post.creationTime);

        await handleLead({ lead, post, channel, reference, stats });
      }
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(
    `${stats.posts} post(s) read, ${stats.leads} lead(s) found, ` +
      `${stats.duplicates} re-posted, ${stats.skipped} already in AccuLynx, ` +
      `${stats.created} created, ${stats.failed} failed`
  );

  if (stats.unstamped.length > 0) {
    console.log(`\n${'!'.repeat(70)}`);
    console.log('JOBS CREATED WITHOUT DEDUP STAMPS — these will duplicate on the');
    console.log('next run. Delete them in AccuLynx, or fix the stamping and');
    console.log('re-stamp them, before running again:');
    for (const item of stats.unstamped) {
      console.log(`  job ${item.jobId}  ${item.who}  (post ${item.reference})`);
    }
    console.log('!'.repeat(70));
  }

  if (!APPLY && stats.leads > stats.skipped) {
    console.log('\nDry run — set SYNC_APPLY=true to create these for real.');
  }
  if (stats.failed > 0) process.exitCode = 1;
}

/**
 * Identity for spotting the same lead re-posted. Phone plus surname, since
 * phone alone would collide for a household and the name alone is too loose.
 * Leads without a usable phone are never treated as duplicates — better a
 * duplicate than dropping a distinct customer.
 */
function identityOf(lead) {
  if (!lead.phone) return null;
  return `${lead.phone}|${(lead.lastName || '').trim().toLowerCase()}`;
}

function nameOf(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)';
}

async function handleLead({ lead, post, channel, reference, stats }) {
  const who = nameOf(lead);
  const notes = buildNotes(lead, { channel: channel.name, postedAt: post.creationTime });

  try {
    const existing = await acculynx.findJobForPost(reference);
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

  // Every department, every lead. "Obviously a new customer" is exactly the
  // case this is here to disprove, and it costs one search per company.
  const history = await lookupHistory(lead, who);

  if (!APPLY) {
    console.log(`  WOULD CREATE  ${who}`);
    console.log(`      phone     ${lead.phone ?? '(none usable)'}`);
    console.log(`      email     ${lead.email ?? '(none)'}`);
    // Show the raw text behind anything that didn't convert, so a dry run
    // explains *why* rather than just reporting that it failed.
    console.log(
      `      address   ${lead.address ? formatAddress(lead.address) : `UNPARSED <- ${lead.rawAddress ?? '(field absent)'}`}`
    );
    console.log(`      workType  ${channel.workType}`);
    console.log(
      `      source    ${lead.leadSourceId ?? `UNMATCHED <- ${lead.rawLeadSource ?? '(field absent)'}`}`
    );
    console.log(`      notes     ${notes.split('\n')[0]}...`);
    reportHistory(history);
    return;
  }

  let jobId = null;
  try {
    const contactId = await acculynx.createContact(lead);
    jobId = await acculynx.createJob({
      contactId,
      workType: channel.workType,
      address: lead.address,
      leadSourceId: lead.leadSourceId,
      notes,
    });

    // Immediately, so an interruption leaves at most one duplicate rather than
    // recreating this lead on every future run.
    await acculynx.stampPostReference(jobId, reference);

    stats.created += 1;
    console.log(`  CREATED ${who} — job ${jobId}`);
    reportHistory(history);
  } catch (err) {
    stats.failed += 1;
    console.error(`  FAILED  ${who} — ${err.message}`);

    // A job created but left unstamped is worse than one never created: it is
    // real in the CRM yet invisible to dedup, so it silently duplicates on the
    // next run. Count and surface it separately from a clean failure.
    if (jobId) {
      stats.unstamped.push({ who, jobId, reference });
    }
  }
}

/**
 * Search every department for prior work on this customer.
 *
 * Never throws. A history search that fails is a lead that goes in without
 * context, which is what happens today anyway; a history search that fails and
 * takes the lead down with it is strictly worse. The failure is carried
 * forward so the output can say the search was incomplete instead of implying
 * it came back clean.
 */
async function lookupHistory(lead, who) {
  const log = (message) => console.log(message);

  let history;
  try {
    history = await findHistory(lead, { log });
  } catch (err) {
    console.error(`      history search failed for ${who}: ${err.message}`);
    return { candidates: [], errors: [{ department: null, message: err.message }], searched: [] };
  }

  // Claude reads the candidates the search already found — it cannot search,
  // and it cannot lower a match the data proved. See src/match-ai.js.
  const { verdicts, skipped } = await judgeCandidates(lead, history.candidates, { log });
  if (skipped && skipped !== 'no candidates' && skipped !== 'no ANTHROPIC_API_KEY') {
    log(`      match: not judged — ${skipped}`);
  }

  return { ...history, candidates: applyVerdicts(history.candidates, verdicts) };
}

function reportHistory(history) {
  const { candidates, errors, searched } = history;

  if (errors.length > 0) {
    for (const error of errors) {
      console.log(`      history: ${error.department ?? 'search'} NOT CHECKED — ${error.message}`);
    }
  }

  if (candidates.length === 0) {
    if (searched.length === 0) {
      // Not the same statement as "no prior work found", and the difference
      // matters: nobody looked.
      console.log('      history: NOT SEARCHED — no department answered');
      return;
    }
    const missed = errors.length > 0 ? ' — and see the NOT CHECKED lines above' : '';
    console.log(`      history: no prior work found (searched ${searched.join(', ')})${missed}`);
    return;
  }

  for (const candidate of candidates) {
    const label = candidate.confidence === CONFIDENCE.STRONG ? 'MATCH' :
      candidate.confidence === CONFIDENCE.PROPERTY ? 'SAME PROPERTY' : 'possible';
    console.log(
      `      history: ${label} in ${candidate.department} — ${candidate.name}` +
        `${candidate.address ? ` (${candidate.address})` : ''} [${candidate.reasons.join('; ')}]`
    );
    if (candidate.judgment) {
      const { samePerson, sameProperty, reason, promoted } = candidate.judgment;
      console.log(
        `        judged: same person ${samePerson}, same property ${sameProperty}` +
          `${promoted ? ' (promoted from a name-only match)' : ''} — ${reason}`
      );
    }
    for (const job of candidate.jobs) {
      const parts = [job.workType, job.milestone, job.representative && `rep: ${job.representative}`]
        .filter(Boolean)
        .join(' · ');
      console.log(`        prior job ${job.id} — ${parts || '(no detail)'}`);
      // First run only: names the fields the job payload really has, so the
      // guesses in summariseJob can be replaced with the actual keys.
      if (process.env.SYNC_DUMP_JOB_KEYS === 'true') {
        console.log(`          fields: ${job.keys.join(', ')}`);
      }
    }
  }
}

/**
 * Refuse to write unless dedup is known to work. If the external-reference
 * lookup is broken, every run would recreate every lead, and the mess lands in
 * a live CRM. Better to stop.
 */
async function preflight() {
  try {
    await acculynx.findJobForPost('preflight-check-no-such-post');
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
