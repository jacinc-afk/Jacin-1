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

// jobPost.leadSource.id — GUID. Partial: these are the sources the intake
// template's "Lead Source:" line is most likely to name. The account has more,
// including individual salespeople; run `npm run discover` for the full list.
export const LEAD_SOURCES = {
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
};

// Which RingCentral team channel maps to which AccuLynx work type.
//
// UNRESOLVED: the channels are named for reroof and service/repair, but this
// account has no "Reroof" work type, and "Service" and "Repair" are two
// separate ones. Awaiting a decision on which work type each channel should
// produce before this is filled in.
export const CHANNEL_WORK_TYPE = {
  // 'SB | Re Roof': WORK_TYPES.???,
  // 'SB | Sales Leads & Follow-Up': WORK_TYPES.???,
  // 'SB | Repairs & Active Leaks': WORK_TYPES.???,
};
