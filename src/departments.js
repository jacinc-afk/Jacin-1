// Each SeaBreeze department is a separate AccuLynx company, so each has its
// own API key, its own user IDs and its own lead sources. The same person has
// a different user ID in every company — Alex Patapis is 570e29fd… in REROOF
// and 040abed8… elsewhere — so nothing here is portable between them.
//
// Companies, from the AccuLynx switcher:
//   SeaBreeze Roofing REROOF Department
//   SeaBreeze Roofing Service Department
//   SeaBreeze Roofing Warranties
//   SeaBreeze Roofing New Conctruction & Remodels   (sic — no channel mapped)
//   Testing
//
// Work types, job categories and contact types are AccuLynx system defaults
// and came back identical across companies, so those stay in acculynx-ids.js.

// Assignment sets the job's **Company Representative** — the per-job field,
// not the "Company Administrator" permission level shown on the team screen.
//
// Rules name people rather than IDs on purpose: the same name resolves to a
// different ID in each company, so the rule stays correct wherever it runs and
// the lookup happens against the right company.
//
// The `users` maps below are documentation, not the source of truth. Writes
// resolve a name against the live /users list of whichever company is being
// written to, so a person joining or leaving does not need an edit here, and a
// run against Testing assigns to the Testing copy of that person rather than
// to a stranger holding the same GUID. Confirmed correct by src/company-map.js
// — every one of these matches what its company returns.
export const REROOF = {
  key: 'reroof',
  company: 'SeaBreeze Roofing REROOF Department',
  keyVar: 'ACCULYNX_KEY_REROOF',

  // Everything goes to Jacin for now. This was a three-way rotation
  // (Jacin -> Francis -> Alex); the rotation machinery is still in place, so
  // restoring it is a one-line change back to
  //   { mode: 'rotate', people: ['Jacin Carreiro', 'Francis Ferrer', 'Alex Patapis'] }
  // Still skipped when the intake names a salesperson, or the customer has
  // prior jobs under a different rep — those get flagged instead.
  assignment: { mode: 'fixed', people: ['Jacin Carreiro'] },

  users: {
    'Alex Patapis': '570e29fd-a208-4e9e-9c30-873fc2ff95f2',
    'Andrei Smith': '784b74a1-b0d2-47c1-9ee6-d99e37a2849a',
    'Aubrie Parker': '07ddb6ef-fa8b-4377-bed1-f3a3b760a2e6',
    'Francis Ferrer': '488d4b79-6637-40d0-99bd-705da46ff087',
    'Jacin Carreiro': 'f50e11ec-c498-4035-a5f3-6a85a66e9581',
    'Noah Damiani': '2d634725-7e13-4432-a2ac-82f92554095c',
  },

  leadSources: {
    'Advanced Roofing': '3c993241-4abe-4163-ae63-82f34806d3f8',
    'Alesha Jacobs': '6f89e1e1-2fab-43f5-924e-caffd7118210',
    'Alex Patapis': '79c75765-6184-41e4-b2e1-a0a3e04cd843',
    'American Elite': '425c85c7-81c6-436f-b9b9-8ba48949ac0b',
    BBB: '67664334-a40f-47fd-b36c-0a304d665c95',
    'Best Roofing': '24a714a5-af20-4ccf-83b8-61c84ec8a236',
    'Blue Book Network': '754f2637-cfd1-4319-a641-ae4ca67fbf96',
    'BNI Group': '3963a1e8-73fa-4eda-9e99-0c8d71303d91',
    'Building connected': '7e9ce7ce-6881-4247-899d-7b98ed968f3b',
    Craigslist: '566a0615-085a-48ca-8035-00cc1e48d842',
    'Danny Bivins': '1a8c2937-9dae-4185-b12c-17d230f0dd2d',
    'David Steele': '95204402-6426-45fd-9089-2d966c77dd60',
    'Door hanger': 'c97eef70-fe57-ea11-9115-0cc47aa3a68a',
    Facebook: '9020485a-8fcf-49be-b864-70ffe017dd02',
    'Francis Ferrer': '6a7ca160-9351-4ebb-9585-eba40f5b49fa',
    'Giana Perri': 'cec4058f-1b66-4f4c-9fbd-b06e7a4d2015',
    'Google Local Ads': 'e1d57401-8d42-42ad-80b0-5670c962dade',
    'Google search': 'c57eef70-fe57-ea11-9115-0cc47aa3a68a',
    'Home Show': '75613d0a-38ee-446f-9d5b-efd26eecc031',
    'Insurance Express': 'e3a88482-7121-434c-b297-41ca5a938eb7',
    'Internet-Other': '203b5206-4ca7-401f-b607-5b68bf3eceb3',
    'Kairos Roofing': 'a1368548-9040-489e-810a-5bb8ff8e1de2',
    'Live Chat': 'ea49c611-7241-4c2c-b8c6-9acced56681c',
    'Lori Hicks': '0c907f2f-c217-40f5-95ad-5ac5d3c8b080',
    Manychat: '04b26385-d86a-46d0-a23e-f4bdc0eb6a32',
    'My Safe Fl Home': 'ad874f3a-cc2d-4a2a-a842-922c336839db',
    Nextdoor: '36a39c9c-4e4e-40b3-af58-b0c7dcdc744c',
    Other: 'cc7eef70-fe57-ea11-9115-0cc47aa3a68a',
    'Palm Beach Roofing': '9f189b4f-b972-407e-a692-091686f5ce66',
    'Plan Hub': '39e0e760-7119-4bfa-97f4-f4bfa4dceeda',
    'Previous Customer': 'd07eef70-fe57-ea11-9115-0cc47aa3a68a',
    Realtor: '8dfe7f69-cd89-4176-a395-a279b042b3ad',
    Referral: 'c27eef70-fe57-ea11-9115-0cc47aa3a68a',
    'Roof Calculator': '32c658c6-7ed9-4421-9954-e7bb673f2a7b',
    'RoofR Instant Estimator': '439de7d8-c403-406d-bef0-cbf8263bb472',
    'SBR Open house': 'dbc8297c-1702-4c26-8550-b7314e58c753',
    // Already the manual convention for a service customer handed to reroof —
    // worth using when the history check finds prior service work.
    'Sent from service': '72bbf6e2-04f0-48de-9147-5cd6ac7f8de2',
    Truck: 'cb7eef70-fe57-ea11-9115-0cc47aa3a68a',
    'Unknown Forgot to ask': '3cf8b62d-3b15-4912-a28f-4b72edc2ebbf',
    'Web to Lead Form': 'f0586f58-4ff3-432a-9dd3-55cdd7a4ac95',
    Website: '1b3285fa-6c7b-42c9-a3b7-cc7523b56ccb',
    'Working in the neighborhood': 'e722ad76-ee86-4b98-b439-e270c95d95b7',
    'Yard Sign': 'ca7eef70-fe57-ea11-9115-0cc47aa3a68a',
    Yelp: '05885c6b-4b61-4200-b599-91aad2c0c860',
  },
};

// Awaiting their own API keys and a discovery run. Deliberately left empty
// rather than filled with another company's IDs, which would attach the wrong
// person or reject the write outright.
// The original ACCULYNX_API_KEY turned out to point here — this company
// returns identical user IDs and lead source GUIDs to that first discovery
// run, which is how it was identified rather than guessed.
export const SERVICE = {
  key: 'service',
  company: 'SeaBreeze Roofing Service Department',
  keyVar: 'ACCULYNX_KEY_SERVICE',
  // Was Alex Patapis; everything goes to Jacin for now.
  assignment: { mode: 'fixed', people: ['Jacin Carreiro'] },

  users: {
    'Alex Patapis': '040abed8-78e8-49ff-942f-40c99f36055b',
    'Andrei Smith': 'a79ad21e-4c29-462c-ae72-bc79b417ea2e',
    'Aubrie Parker': '43c6df95-ad18-445d-9667-c124c7acde9f',
    'Francis Ferrer': '2141584c-179b-486c-ac9d-d0e39ac9a96f',
    'Jacin Carreiro': 'c7e7553b-49ea-4499-826a-c2765fda6de3',
    'Noah Damiani': '370525c2-e310-4889-8271-9e4d1b411ee8',
  },

  leadSources: {
    'Google Local Services Ad': 'bef198c1-7079-40b7-8997-47bb43fdbdad',
    'Google Search': 'a6176ea9-0634-4649-8524-d9203e44efc0',
    'Insurance Express': '8ee68d19-47e2-477f-b219-d63a6bddd2cb',
    'Internet-Other': '6a0b7284-282e-4401-9d9b-5f8fb1eb0871',
    'Johnny Cagle': '72044331-894d-4d7d-bc45-7c4f90b331a2',
    'Jonathan Avila': 'f2bc1114-6c06-4aa3-affd-97393b3c09e4',
    'Kiaros Roofing': '00fb1fbd-c56a-4df5-a0f3-b23ce8f1af7c',
    'Live Chat': 'c4710769-c5f0-447d-a261-64f07ee9b88c',
    Other: '5d853662-bcfc-4d4a-ba5e-dd148584b866',
    'Previous Customer': '6907f009-1057-457c-b0c6-5ce0e8b3878b',
    Realtor: 'd8c2ac3d-a0c9-49b7-a91f-bbc931244dbc',
    Referral: '474a64d8-c55a-4607-a5c5-ab88ce90dc26',
    'Roof Calculator': '2baaba36-91f0-45ff-8d19-cabba1d4882e',
    'Scott Dacunha': 'd077135c-97a6-4545-bdb0-6e44ee0d5eca',
    Truck: 'd646abcf-343f-4a36-ac6b-8154c183900f',
    Website: '0e5411c1-9553-42fa-8ff6-36aaff81cd03',
    'Working in the neighborhood': '3b8cc022-b853-4c69-8640-07553a0c86a8',
    'Yard Sign': '1dab06f7-b122-40f5-8c9b-9451a1d270e9',
    Yelp: '58eab576-5307-4df1-b0e8-bd0c6c16cbd2',
  },
};

export const WARRANTIES = {
  key: 'warranties',
  company: 'SeaBreeze Roofing Warranties',
  keyVar: 'ACCULYNX_KEY_WARRANTIES',
  assignment: { mode: 'fixed', people: ['Jacin Carreiro'] },

  users: {
    'Alex Patapis': '84eaa673-6042-4305-8ab2-1c09dcd533b3',
    'Andrei Smith': '108cb50c-722d-499f-b5e2-5a4d0ceeb29f',
    'Aubrie Parker': '1f10cbfd-69c6-41eb-ae30-6a80f6e4a60f',
    'Francis Ferrer': 'aeccab67-0b27-4dbc-90b7-f8ce9992fe8f',
    'Jacin Carreiro': 'd81cc87d-a5e0-4d24-a32f-42b57760eb50',
    'Noah Damiani': '9e453fca-f05a-4375-b564-2880b2d3e8e9',
  },

  // Not yet captured. Warranty leads go to Jacin regardless of source, and
  // leadSource is optional on a job, so an empty map leaves the field unset
  // rather than blocking anything — the raw text still reaches the notes.
  leadSources: {},
};

// No channel feeds this one and it is not being searched yet, so it has no key
// and stays out of SEARCH_DEPARTMENTS. Listed for completeness.
export const NEW_CONSTRUCTION = {
  key: 'newconstruction',
  company: 'SeaBreeze Roofing New Conctruction & Remodels',
  keyVar: 'ACCULYNX_KEY_NEWCONSTRUCTION',
  assignment: null,
  users: {},
  leadSources: {},
};

export const DEPARTMENTS = {
  reroof: REROOF,
  service: SERVICE,
  warranties: WARRANTIES,
  newconstruction: NEW_CONSTRUCTION,
};

// Which RingCentral channel feeds which department. Keyed by chat ID, since
// renaming a channel keeps its ID.
export const CHANNEL_DEPARTMENT = {
  164521648134: { name: 'SB | Re Roof', department: 'reroof' },
  163119448070: { name: 'SB | Sales Leads & Follow-Up', department: 'reroof' },
  163119546374: { name: 'SB | Repairs & Active Leaks', department: 'service' },
  163119579142: { name: 'SB | Waranty', department: 'warranties' },
};

// Every department is searched for prior work on a customer before a lead is
// created — a service customer returning for a reroof, or a second quote to
// the same household, only shows up by looking across all of them.
export const SEARCH_DEPARTMENTS = ['reroof', 'service', 'warranties'];

// Leads that need a human decision are reported here rather than in the
// working channel. This is the Personal chat — RingCentral's note-to-self
// thread, one member — so it is private to Jacin, whose JWT the sync runs as.
//
// Overridable, because whether a Personal chat actually raises a phone
// notification is not something I have confirmed. If these flags turn out to
// sit there unseen, set RC_FLAG_CHAT_ID to a direct-message chat instead; the
// discovery script lists the candidates.
export const FLAG_CHAT_ID = process.env.RC_FLAG_CHAT_ID || '1586419228674';
