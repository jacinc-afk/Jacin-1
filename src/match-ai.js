// Asking Claude to judge whether a candidate from the history search is really
// the same customer.
//
// WHY THIS IS NOT THE WHOLE MATCHER
//
// The candidates it judges are found deterministically — src/history.js does
// the searching and the phone/address/name comparison. This step only reads
// what came back. That split is deliberate: a model cannot search AccuLynx, so
// letting it "look for" a customer would just be letting it imagine one. It
// gets the same list a person would get, and does the part a person is
// actually better at than a string compare:
//
//   Bob vs Robert, Kathy vs Katherine, Jon vs Jonathan
//   "123 Main St Apt 2" vs "123 Main Street #2"
//   a maiden name, a married name, a misspelling taken down over the phone
//   a company name that is the customer, e.g. "Wurster Properties LLC"
//
// WHAT IT IS NOT ALLOWED TO DO
//
// It cannot skip a lead, merge a contact, or assign anyone. Its output only
// affects whether a human gets asked. And it can only ever add doubt, never
// remove it: a deterministic strong match (phone, email or property address)
// is flagged whether the model agrees or not — enforced in code below, not by
// asking the prompt nicely. The failure this guards against is the model
// talking us out of a real match, which is the one mistake that costs a
// customer two different prices for the same roof.
//
// It is optional. With no ANTHROPIC_API_KEY set, the deterministic result
// stands on its own and nothing here runs.

import Anthropic from '@anthropic-ai/sdk';

import { CONFIDENCE } from './history.js';

const MODEL = process.env.MATCH_MODEL || 'claude-opus-5';

const VERDICT_TOOL = {
  name: 'record_verdicts',
  description: 'Record one verdict per candidate. Every candidate must appear exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            contactId: {
              type: 'string',
              description: 'The candidate contactId being judged, copied exactly.',
            },
            samePerson: {
              type: 'string',
              enum: ['yes', 'no', 'unsure'],
              description: 'Is this the same human being as the new lead?',
            },
            sameProperty: {
              type: 'string',
              enum: ['yes', 'no', 'unsure'],
              description:
                'Is this the same physical building, regardless of whether the person differs? ' +
                'A spouse, partner or relative at one address is "yes" here and likely "no" above.',
            },
            reason: {
              type: 'string',
              description:
                'One sentence a salesperson can act on, naming the specific evidence. ' +
                'No hedging language and no restating the question.',
            },
          },
          required: ['contactId', 'samePerson', 'sameProperty', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
};

const SYSTEM = `You work for SeaBreeze Roofing, a Florida roofing contractor. A new lead has just come in from a phone intake form. You are shown existing customer records that a name search turned up across the company's three AccuLynx databases (reroof, service, warranties).

For each candidate, decide two separate things:

1. samePerson — is this the same human being? Account for nicknames (Bob/Robert, Kathy/Katherine), maiden and married names, misspellings taken down over the phone, and names entered surname-first.

2. sameProperty — is this the same building? Two people at one address are usually a household: a spouse, a partner, an adult child, a landlord. This is the more important question. The company's rule is that one house gets one price, so a second person calling about a roof someone already quoted must be caught even when the names have nothing in common.

Judge only from the evidence shown. Do not assume a match because the surname is common in the area, and do not assume two different people are unrelated just because their surnames differ — check the address first. If the record has no address and no phone, you cannot confirm anything: say unsure rather than guessing.

A human reads every verdict and makes the actual decision. Nothing you write assigns, merges, or discards anything. Being wrong in the direction of "unsure" costs someone thirty seconds; being wrong in the direction of "no" costs a customer.`;

/**
 * Judge the candidates from findHistory.
 *
 * Returns { verdicts, model, skipped } where verdicts is keyed by contactId.
 * Never throws: if the call fails, the deterministic result is what the run
 * uses, which is the same behaviour as not configuring a key at all.
 */
export async function judgeCandidates(lead, candidates, { log = () => {} } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return { verdicts: {}, model: null, skipped: 'no ANTHROPIC_API_KEY' };
  if (candidates.length === 0) return { verdicts: {}, model: null, skipped: 'no candidates' };

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Names, addresses and nicknames are exactly the kind of thing worth a
      // moment's reasoning rather than a reflex.
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools: [VERDICT_TOOL],
      messages: [{ role: 'user', content: buildPrompt(lead, candidates) }],
    });

    const call = message.content.find(
      (block) => block.type === 'tool_use' && block.name === VERDICT_TOOL.name
    );

    if (!call) {
      // No tool call means no structured answer. Prose is not something to
      // parse loosely here — a misread verdict is worse than none.
      log('      match: model returned no verdicts');
      return { verdicts: {}, model: MODEL, skipped: 'no tool call in response' };
    }

    const verdicts = {};
    for (const verdict of call.input?.verdicts ?? []) {
      // Only verdicts about candidates we actually sent. A contactId that was
      // not in the prompt is a hallucinated record, and attaching it to a lead
      // would put a fictional prior job in front of a salesperson.
      if (candidates.some((candidate) => candidate.contactId === verdict.contactId)) {
        verdicts[verdict.contactId] = verdict;
      } else {
        log(`      match: ignoring verdict for unknown contact ${verdict.contactId}`);
      }
    }

    return { verdicts, model: MODEL, skipped: null };
  } catch (err) {
    // A lead must not be lost because this was down.
    log(`      match: judgment unavailable — ${err.message}`);
    return { verdicts: {}, model: MODEL, skipped: err.message };
  }
}

function buildPrompt(lead, candidates) {
  const lines = [
    'NEW LEAD',
    `  name:    ${[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(none given)'}`,
    `  phone:   ${lead.phone ?? '(none)'}`,
    `  email:   ${lead.email ?? '(none)'}`,
    `  address: ${formatAddress(lead.address) ?? lead.rawAddress ?? '(none)'}`,
    '',
    `EXISTING RECORDS (${candidates.length})`,
  ];

  for (const candidate of candidates) {
    lines.push('');
    lines.push(`  contactId: ${candidate.contactId}`);
    lines.push(`  database:  ${candidate.department}`);
    lines.push(`  name:      ${candidate.name || '(none)'}`);
    if (candidate.companyName) lines.push(`  company:   ${candidate.companyName}`);
    lines.push(`  address:   ${candidate.address ?? '(none on record)'}`);
    // What the deterministic comparison already established, so the model is
    // not re-deriving it and can spend its attention on what a string compare
    // could not see.
    lines.push(`  already matched on: ${candidate.reasons.join('; ') || 'name only'}`);

    if (candidate.jobs.length === 0) {
      lines.push('  prior jobs: none on file');
    } else {
      lines.push('  prior jobs:');
      for (const job of candidate.jobs) {
        const parts = [job.workType, job.milestone, job.createdDate, job.address]
          .filter(Boolean)
          .join(' · ');
        lines.push(`    - ${parts || '(no detail available)'}`);
      }
    }
  }

  lines.push('');
  lines.push('Record a verdict for every contactId listed above.');

  return lines.join('\n');
}

/**
 * Fold the verdicts back into the candidates.
 *
 * The deterministic confidence is never lowered here. A phone, email or
 * address match stays a match even if the model disagrees — the model is
 * allowed to add a reason, and nothing else. What it can do is promote a weak
 * name-only candidate that it recognises as the same person, which is the case
 * the string compare genuinely cannot see.
 */
export function applyVerdicts(candidates, verdicts) {
  return candidates.map((candidate) => {
    const verdict = verdicts[candidate.contactId];
    if (!verdict) return candidate;

    const promote =
      candidate.confidence === CONFIDENCE.WEAK &&
      (verdict.samePerson === 'yes' || verdict.sameProperty === 'yes');

    return {
      ...candidate,
      confidence: promote ? CONFIDENCE.STRONG : candidate.confidence,
      judgment: {
        samePerson: verdict.samePerson,
        sameProperty: verdict.sameProperty,
        reason: verdict.reason,
        promoted: promote,
      },
    };
  });
}

function formatAddress(address) {
  if (!address) return null;
  return [address.street1, address.city, [address.state, address.zipCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}
