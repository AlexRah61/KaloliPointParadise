// Single source of truth for every property fact, label and URL used on the site.
// Facts come from the public listing (MLS 733498) and the CubiCasa floor plans in assets/.

export const SITE_URL = 'https://kalolipointparadisehawaii.com';

export const property = {
  name: 'Kaloli Point Residence',
  status: 'For Sale',
  mls: '733498',
  // The public Zillow listing, as the owners share it.
  zillowUrl: 'https://www.zillow.com/homedetails/15-1077-Amau-Rd-Keaau-HI-96749/138288853_zpid/?utm_campaign=zillowwebmessage&utm_medium=referral&utm_source=txtshare',
  price: 679_000,
  priceDisplay: '$679,000',

  address: {
    street: '15-1077 Amau Rd',
    streetDisplay: '15–1077 Amau Rd',
    lineOne: '15–1077',
    lineTwo: 'Amau Rd',
    city: 'Keaau',
    cityDisplay: 'Keaʻau',
    state: 'HI',
    stateName: 'Hawaii',
    stateDisplay: 'Hawaiʻi',
    zip: '96749',
    neighborhood: 'Kaloli Point',
    subdivision: 'Hawaiian Paradise Park',
    district: 'Puna',
    island: 'Island of Hawaiʻi',
    full: '15-1077 Amau Rd, Keaau, HI 96749',
  },
  // Centre of the octagonal roof on Google's satellite imagery (Google has no address point for 15-1077).
  geo: { lat: 19.61513, lng: -154.95389 },

  facts: {
    beds: 2,
    baths: 3,
    fullBaths: 3,
    sqft: 1968,
    acres: 0.5,
    yearBuilt: 2005,
    levels: 3,
    lanais: 3,
    renovated: 2023,
    rockWallFeet: 450,
  },
  factsLine: '2 Bed · 3 Bath · 1,968 SF · 0.50 Acre',

  campaign: {
    title: 'Island Living',
    tagline: 'at Kaloli Point',
    addressLine: '15–1077 Amau Rd · Keaʻau, Hawaiʻi',
  },

  details: [
    { label: 'Living area', value: '1,968 sq ft' },
    { label: 'Lot', value: '0.50 acre' },
    { label: 'Year built', value: '2005' },
    { label: 'Renovated', value: '2023' },
    { label: 'Flooring', value: 'Ceramic tile, vinyl' },
    { label: 'Appliances', value: 'Range, refrigerator, freezer, washer, dryer' },
    { label: 'Parking', value: 'Detached' },
    { label: 'Sewer', value: 'Septic tank' },
    { label: 'Utilities', value: 'Electricity available' },
    { label: 'Zoning', value: 'A-1A' },
    { label: 'Property tax', value: '$2,384 / yr' },
    { label: 'MLS®', value: '733498' },
  ],

  levels: [
    {
      id: 'level-1',
      number: '01',
      name: 'Garden level',
      rooms: ['Bedroom · 23′10″ × 13′11″', 'Living room · 19′9″ × 14′5″', 'Full bath', 'Laundry', 'Covered lanai · 34′0″ × 31′6″'],
      summary: 'A generous bedroom and a second living room open to the covered lanai and lawn, with a full bath and laundry alongside.',
    },
    {
      id: 'level-2',
      number: '02',
      name: 'Living level',
      rooms: ['Eat-in kitchen · 19′8″ × 13′9″', 'Family room · 26′8″ × 13′11″', 'Pantry', 'Full bath', 'Wraparound lanai'],
      summary: 'Kitchen and family room share the middle floor, with French doors out to the expansive wraparound lanai.',
    },
    {
      id: 'level-3',
      number: '03',
      name: 'Primary retreat',
      rooms: ['Primary bedroom · 26′9″ × 19′10″', 'Walk-in closet', 'Primary bath', 'Top-floor lanai'],
      summary: 'The entire top floor belongs to the primary suite, ringed by windows and its own lanai.',
    },
  ],
  planNote: 'Floor plans by CubiCasa. Measurements deemed highly reliable but not guaranteed.',

  renovation: {
    year: 2023,
    intro: 'Extensively renovated in 2023 and lovingly maintained.',
    groups: [
      {
        title: 'Kitchen & interiors',
        summary: 'New kitchen, new floors, fresh paint.',
        items: ['New kitchen cabinets, countertops and appliances', 'LifeProof vinyl flooring', 'Interior paint'],
      },
      {
        title: 'Baths',
        summary: 'Updated vanities, fixtures and tub.',
        items: ['Updated bathroom vanities, fixtures and toilets', 'Updated main-bath tub'],
      },
      {
        title: 'Water & catchment',
        summary: 'New heater, pump and catchment liner.',
        items: ['New water heater', 'New water pump and pressure tank', 'New catchment liner'],
      },
      {
        title: 'Exterior & lanais',
        summary: 'Siding, lanai and paint work.',
        items: ['Significant siding improvements', 'Extensive second-story lanai work', 'Exterior paint'],
      },
    ],
  },

  agent: {
    name: 'Misti R. Tyrin',
    firstName: 'Misti',
    title: 'Principal Broker & Owner',
    brokerage: 'Iokua Real Estate',
    license: 'RB-22375',
    phone: '(808) 756-8811',
    phoneHref: 'tel:+18087568811',
    email: 'mrstyrin@gmail.com',
    website: 'https://misti.iokuarealestate.com/',
    brokerageAddress: '234 Waianuenue Ave, Suite 219, Hilo, HI 96720',
    brokeragePhone: '(808) 934-7050',
    brokeragePhoneHref: 'tel:+18089347050',
  },

  // A showing is always a request: never "book", "reserve" or "confirm" until a real scheduling system exists.
  cta: {
    primary: 'Request a Private or Virtual Tour',
    remoteNote: "Can't visit Hawaiʻi in person? Virtual tours are available for remote buyers.",
    film: 'Watch the film',
    call: 'Call the listing agent',
    submit: 'Send Showing Request',
  },

  video: {
    // Final cut “15-1077 AMAU RD, KEAAU - Video” (1080p, 57.6 s), streamed from a versioned folder.
    hls: '/media/film/v2/master.m3u8',
    mp4: '/media/film/v2/film-1080p.mp4',
    durationSeconds: 57,
    durationLabel: '0:57',
    // Silent eight-beat hero loop cut from the film and photographs (tools/build-media.mjs); the master never loads.
    heroWide: '/media/hero/hero-wide-v2.mp4',
    heroTall: '/media/hero/hero-tall-v2.mp4',
  },

  seo: {
    title: '15–1077 Amau Rd, Keaau, HI 96749 | Kaloli Point Residence',
    description:
      'Octagonal three-level home on a private tropical half acre at Kaloli Point, Hawaiian Paradise Park. 2 bed, 3 bath, 1,968 sq ft, renovated 2023. $679,000.',
    ogImageAlt: 'Aerial view of 15–1077 Amau Rd, a three-level octagonal home set in tropical gardens in Kaloli Point, Hawaiʻi',
  },

  legal: {
    disclaimer:
      'This is an independent marketing website for one property. It is not the MLS and is not the website of Iokua Real Estate. Information is deemed reliable but not guaranteed and should be independently verified. Listing information is subject to change without notice.',
    listedBy: 'Listed by Misti R. Tyrin (RB-22375), Principal Broker, Iokua Real Estate.',
    eho: 'Equal Housing Opportunity.',
  },
} as const;

export type Property = typeof property;
