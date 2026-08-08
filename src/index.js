import { getAccessToken, fetchNewVoicemails, getTranscription } from './ringcentral.js';
import { classifyLead } from './classify.js';
import { createLead } from './acculynx.js';
import { loadState, saveState } from './state.js';

// Look back a bit further than the last run to tolerate clock drift / gaps,
// but rely on processedMessageIds to avoid creating duplicate leads.
const LOOKBACK_MS = 60 * 60 * 1000; // 1 hour

async function main() {
  const state = await loadState();
  const processed = new Set(state.processedMessageIds);

  const since = state.lastRunIso
    ? new Date(Math.min(Date.now() - LOOKBACK_MS, new Date(state.lastRunIso).getTime()))
    : new Date(Date.now() - 24 * 60 * 60 * 1000); // first run: last 24h

  const accessToken = await getAccessToken();
  const voicemails = await fetchNewVoicemails(accessToken, since.toISOString());

  let created = 0;
  for (const message of voicemails) {
    if (processed.has(String(message.id))) continue;

    const transcription = await getTranscription(accessToken, message);
    const { type, confident } = classifyLead(transcription);

    const caller = message.from || {};
    const notesLines = [
      `Voicemail received ${message.creationTime}`,
      transcription ? `Transcription: ${transcription}` : 'No transcription available — listen to the recording in RingCentral.',
      confident ? null : 'Auto-classified with low confidence — please verify Reroof vs. Service.',
    ].filter(Boolean);

    try {
      await createLead({
        name: caller.name || null,
        phone: caller.phoneNumber || null,
        email: null, // voicemails don't carry an email address
        type,
        notes: notesLines.join('\n'),
      });
      created += 1;
      console.log(`Created lead for ${caller.phoneNumber || 'unknown number'} (${type})`);
    } catch (err) {
      console.error(`Failed to create lead for message ${message.id}:`, err.message);
      continue; // don't mark as processed — retry next run
    }

    processed.add(String(message.id));
  }

  await saveState({
    lastRunIso: new Date().toISOString(),
    processedMessageIds: [...processed],
  });

  console.log(`Done. ${created} lead(s) created, ${voicemails.length} voicemail(s) checked.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
