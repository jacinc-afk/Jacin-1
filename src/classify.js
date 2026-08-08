const REROOF_KEYWORDS = [
  'reroof', 're-roof', 'new roof', 'roof replacement', 'replace my roof',
  'replace the roof', 'roof estimate', 'roof quote', 'full roof',
];

const SERVICE_KEYWORDS = [
  'leak', 'repair', 'fix', 'service call', 'patch', 'missing shingle',
  'storm damage', 'maintenance', 'inspection',
];

// Best-effort classification from voicemail transcription text. Falls back to
// "Service" (the safer default for a small job) and flags low-confidence
// guesses in the notes so a human can double check.
function classifyLead(transcription) {
  const text = (transcription || '').toLowerCase();

  const hasReroof = REROOF_KEYWORDS.some((k) => text.includes(k));
  const hasService = SERVICE_KEYWORDS.some((k) => text.includes(k));

  if (hasReroof && !hasService) return { type: 'Reroof', confident: true };
  if (hasService && !hasReroof) return { type: 'Service', confident: true };
  return { type: 'Service', confident: false };
}

export { classifyLead };
