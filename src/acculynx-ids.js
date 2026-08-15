// AccuLynx IDs for this account, read from the live API by src/discover.js.
//
// POST /jobs and POST /contacts reference these rather than accepting names,
// and the ID types are not uniform — work types and job categories are
// integers, everything else is a GUID.
//
// Re-run `npm run discover` after changing settings in AccuLynx; anything
// added there (a new lead source, a new work type) will not appear here until
// this file is updated.
//
// Confirmed lookup paths:
//   /contacts/contact-types
//   /company-settings/job-file-settings/work-types
//   /company-settings/job-file-settings/job-categories
//   /company-settings/job-file-settings/trade-types
//   /company-settings/leads/lead-sources

// Required by POST /contacts as contactTypeIds (minItems 1).
export const CONTACT_TYPES = {
  Customer: '52ba94c5-3ecf-4e7f-90cd-a91de12a72f5',
  'General Contact': '64fac10a-95c0-46b0-b521-3422bbf77154',
};

// jobPost.workType.id — INTEGER.
// Note there is no "Reroof" work type in this account.
export const WORK_TYPES = {
  Insurance: 1,
  Repair: 2,
  Retail: 3,
  Warranty: 4,
  New: 5,
  Inspection: 6,
  Service: 7,
  Maintenance: 3230,
};

// jobPost.jobCategory.id — INTEGER.
export const JOB_CATEGORIES = {
  Residential: 1,
  Commercial: 2,
  'Property Management': 3,
};

// jobPost.tradeTypes[].id — GUID.
export const TRADE_TYPES = {
  Other: '43f09021-a23d-4a07-9c3c-02e174c8e1f2',
  'Repair Metal': 'e83b8827-54db-4bec-98ec-04eea03d62fc',
  'Maint Shingle': '48c99b53-98ba-489c-99dc-144ec59e25d4',
  'Repair tile': 'fab06a6a-a901-4d1d-82f6-148b43e0e375',
  'Maint metal': '65502865-62a9-4849-8963-289bf8322318',
  'Repair flat': '3cfb4e28-7a7b-44e9-ae0a-2d478df31ffd',
  Gutters: '516f42d9-f80e-4061-9f6e-37cbaf5f3004',
  'Repair shingle': '0fcd9f55-2971-41ee-a80b-5ee17fe1c3ab',
  'Solar Repair': '33257114-e20b-4f8a-b168-7a589d59eb5f',
};

// jobPost.leadSource.id — GUID, and the one lookup that genuinely differs
// between the two companies. Everything above (contact types, work types, job
// categories) came back with identical IDs from both, being AccuLynx system
// defaults, so a test-company run still exercises the production mapping for
// them. Lead sources are configured per company, so they need their own set.
const LEAD_SOURCES_BY_TARGET = {
  production: {
    'Previous Customer': '6907f009-1057-457c-b0c6-5ce0e8b3878b',
    Referral: '474a64d8-c55a-4607-a5c5-ab88ce90dc26',
    Website: '0e5411c1-9553-42fa-8ff6-36aaff81cd03',
    'Google Search': 'a6176ea9-0634-4649-8524-d9203e44efc0',
    'Google Local Services Ad': 'bef198c1-7079-40b7-8997-47bb43fdbdad',
    'Live Chat': 'c4710769-c5f0-447d-a261-64f07ee9b88c',
    Realtor: 'd8c2ac3d-a0c9-49b7-a91f-bbc931244dbc',
    'Roof Calculator': '2baaba36-91f0-45ff-8d19-cabba1d4882e',
    'Working in the neighborhood': '3b8cc022-b853-4c69-8640-07553a0c86a8',
    'Yard Sign': '1dab06f7-b122-40f5-8c9b-9451a1d270e9',
    Yelp: '58eab576-5307-4df1-b0e8-bd0c6c16cbd2',
    Truck: 'd646abcf-343f-4a36-ac6b-8154c183900f',
    'Internet-Other': '6a0b7284-282e-4401-9d9b-5f8fb1eb0871',
    Other: '5d853662-bcfc-4d4a-ba5e-dd148584b866',
  },
  test: {
    'Previous Customer': '6837676b-1e1e-4618-8e96-87ed6def83c7',
    Referral: '1af00be0-1c41-4fab-817f-3851de35f0e4',
    Internet: '7447b0a3-bf1e-48a7-a111-20f4f22ca0ea',
    Canvasser: '8affad74-5de3-4f6e-a869-ade2322a5d59',
    'Direct Mailings': '2442cb0a-4cec-41c8-82a7-0f38f1ae07ea',
    'Door hanger': 'cee5eece-17d4-46ad-b57e-c38d9ca173e7',
    'Door Knocking': '51a08370-cd43-4394-a632-70b1c43f0e19',
    Newspaper: '421b3fad-9c58-44ef-af43-5efa695386a4',
    Phonebook: '286374f9-5716-403c-b84b-4efab7366d56',
    Radio: 'c9621698-9961-4ca5-bdda-0d0a4380ce9a',
    Telemarketing: '072dd8f6-31c2-413b-a045-afe0265ed7a5',
    Truck: '81cd8f58-7e30-478a-8505-b17e80cc5584',
    'Yard Sign': 'dba5a2f4-f502-4472-ad53-030ec7bf1bc7',
    Other: '2491a574-2d75-4c9b-8f15-1b4644abf4e1',
  },
};

export const LEAD_SOURCES =
  LEAD_SOURCES_BY_TARGET[process.env.ACCULYNX_TARGET] ?? LEAD_SOURCES_BY_TARGET.production;

// AccuLynx users, for assigning a lead's company administrator.
export const USERS = {
  'Alex Patapis': '040abed8-78e8-49ff-942f-40c99f36055b',
  'Andrei Smith': 'a79ad21e-4c29-462c-ae72-bc79b417ea2e',
  'Aubrie Parker': '43c6df95-ad18-445d-9667-c124c7acde9f',
  'Francis Ferrer': '2141584c-179b-486c-ac9d-d0e39ac9a96f',
  'Jacin Carreiro': 'c7e7553b-49ea-4499-826a-c2765fda6de3',
  'Noah Damiani': '370525c2-e310-4889-8271-9e4d1b411ee8',
};

// Reroof leads are assigned in rotation. Warranty leads all go to Jacin.
// Repair leads are not assigned.
export const REROOF_ROTATION = [
  USERS['Jacin Carreiro'],
  USERS['Francis Ferrer'],
  USERS['Alex Patapis'],
];

export const WARRANTY_OWNER = USERS['Jacin Carreiro'];

// Which RingCentral team channel maps to which AccuLynx work type.
//
// Keyed by chat ID rather than name, since that is what the API returns and
// renaming a channel in RingCentral would otherwise silently stop its leads
// from syncing. IDs read from the live account by src/discover-ringcentral.js.
//
// The channels are named for reroof and service/repair, but this account has
// no "Reroof" work type and keeps Service and Repair as separate ones, so the
// names do not map across directly. These pairings were chosen deliberately:
// reroof work is booked as New, and leak/repair work as Repair rather than
// Service.
//
// Only posts containing "Customer Name:" are treated as leads — all three
// channels also carry ordinary conversation.
// Names here are display labels only — they appear in run output and in the
// AccuLynx notes. Renaming a channel in RingCentral keeps its ID, so the sync
// follows it and only these labels go stale. Deleting and recreating a channel
// does not: that produces a new ID and needs updating here.
export const LEAD_CHANNELS = {
  164521648134: { name: 'SB | Re Roof', workType: WORK_TYPES.New },
  163119448070: { name: 'SB | Sales Leads & Follow-Up', workType: WORK_TYPES.New },
  163119546374: { name: 'SB | Repairs & Active Leaks', workType: WORK_TYPES.Repair },
  163119579142: { name: 'SB | Waranty', workType: WORK_TYPES.Warranty },
};
