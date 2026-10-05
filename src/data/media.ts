// Asset mapping: every image on the site resolves through this file.
// Originals are read in place (assets/, assets-listing/, src/assets/derived/); Astro writes optimised copies to dist/.
import type { ImageMetadata } from 'astro';

type Glob = Record<string, { default: ImageMetadata }>;
// Names with spaces are owner-supplied originals; the site uses their clean-named copies in src/assets/derived.
const photos = import.meta.glob<{ default: ImageMetadata }>(['/assets/Photos/*.jpg', '!/assets/Photos/* *.jpg'], { eager: true }) as Glob;
const plans = import.meta.glob<{ default: ImageMetadata }>('/src/assets/derived/plans/*.png', { eager: true }) as Glob;
const listing = import.meta.glob<{ default: ImageMetadata }>('/assets-listing/*.jpg', { eager: true }) as Glob;
const derived = import.meta.glob<{ default: ImageMetadata }>('/src/assets/derived/*.jpg', { eager: true }) as Glob;
const ownerShots = import.meta.glob<{ default: ImageMetadata }>('/src/assets/derived/owner/*.jpg', { eager: true }) as Glob;

export type MediaSource = 'photographer' | 'drone' | 'film-still' | 'listing-owner' | 'owner' | 'floor-plan' | 'agent';

export interface MediaItem {
  id: string;
  file: string;
  src: ImageMetadata;
  alt: string;
  caption?: string;
  source: MediaSource;
  /** CSS object-position focal point used when the frame is cropped. */
  focus?: string;
}

function load(glob: Glob, path: string): ImageMetadata {
  const hit = glob[path];
  if (!hit) throw new Error(`Media not found: ${path}`);
  return hit.default;
}

const photo = (file: string, alt: string, opts: Partial<MediaItem> = {}): MediaItem => ({
  id: file.replace(/\.jpg$/, ''),
  file: `assets/Photos/${file}`,
  src: load(photos, `/assets/Photos/${file}`),
  alt,
  source: file.startsWith('DJI_') ? 'drone' : 'photographer',
  ...opts,
});
const still = (file: string, alt: string, opts: Partial<MediaItem> = {}): MediaItem => ({
  id: file.replace(/\.jpg$/, ''),
  file: `src/assets/derived/${file}`,
  src: load(derived, `/src/assets/derived/${file}`),
  alt,
  source: 'film-still',
  ...opts,
});
const owner = (file: string, alt: string, opts: Partial<MediaItem> = {}): MediaItem => ({
  id: file.replace(/\.jpg$/, ''),
  file: `assets-listing/${file}`,
  src: load(listing, `/assets-listing/${file}`),
  alt,
  source: 'listing-owner',
  ...opts,
});
// Owner phone photos from assets/Photos/Fruit and ocean photos (upright, GPS-stripped copies).
const phone = (file: string, original: string, alt: string, opts: Partial<MediaItem> = {}): MediaItem => ({
  id: file.replace(/\.jpg$/, ''),
  file: `assets/Photos/Fruit and ocean photos/${original}`,
  src: load(ownerShots, `/src/assets/derived/owner/${file}`),
  alt,
  source: 'owner',
  ...opts,
});
// Plans are whitespace-cropped copies of assets/<dir>/<file>.jpg made by tools/build-media.mjs.
const plan = (dir: string, file: string, alt: string, caption: string): MediaItem => ({
  id: file.replace(/\.jpg$/, ''),
  file: `assets/${dir}/${file}`,
  src: load(plans, `/src/assets/derived/plans/${file.replace(/\.jpg$/, '.png')}`),
  alt,
  caption,
  source: 'floor-plan',
});

export const media = {
  // Exterior & architecture
  heroAerial: photo('DJI_20261001133743_0632_D.jpg', 'Aerial view down a long lawn framed by palms to the three-level octagonal home', {
    caption: 'The residence at the head of the lawn', focus: '50% 56%',
  }),
  // Square centre crop of heroAerial (tools/build-media.mjs) for portrait phones.
  heroPhone: { ...still('hero-phone.jpg', 'Aerial view down a long lawn framed by palms to the three-level octagonal home'), source: 'drone' },
  architectureAerial: photo('DJI_20261001133625_0617_D.jpg', 'Elevated view of the octagonal three-level home with stacked lanais, red ti and tall pines', {
    caption: 'Three stacked levels, three lanais', focus: '47% 45%',
  }),
  frontElevation: photo('C04A4635.jpg', 'Front elevation of the octagonal three-level home: a covered lanai at garden level, the wraparound lanai above it and the top-floor lanai', {
    caption: 'Three lanais, one on every level', focus: '48% 40%',
  }),
  entry: photo('C04A4658.jpg', 'Glass-paned entry doors flanked by anthuriums', { caption: 'Entry', focus: '50% 50%' }),
  approach: photo('C04A4596.jpg', 'Palms and tropical trees along the approach to the property', { caption: 'The approach', focus: '50% 60%' }),
  stairLight: still('film-stair-light.jpg', 'Stair with a step light connecting the three levels', {
    caption: 'One stair, three levels', focus: '50% 50%',
  }),

  // Living & kitchen (level 2)
  kitchenWide: photo('C04A4916.jpg', 'Renovated kitchen with dark shaker cabinets, a waterfall quartz island and French doors to the lanai', {
    caption: 'Kitchen, renovated in 2023', focus: '45% 55%',
  }),
  kitchenIsland: photo('C04A4921.jpg', 'Kitchen island with bar seating and stainless refrigerator', { caption: 'Island seating' }),
  kitchenHall: photo('C04A4958.jpg', 'Kitchen island looking toward the hall', { caption: 'Kitchen' }),
  kitchenSink: photo('C04A4968.jpg', 'Farmhouse sink beneath a window, with range and microwave', { caption: 'Kitchen' }),
  kitchenDetail: photo('C04A5036.jpg', 'Detail of the farmhouse sink and new cabinetry', { caption: 'New cabinets and countertops' }),
  familyRoom: photo('C04A4931.jpg', 'Family room opening to the kitchen, with French doors bringing in light from the lanai', {
    caption: 'Family room and kitchen share the middle level', focus: '50% 55%',
  }),
  familyMedia: photo('C04A4948.jpg', 'Family room set up with a projector screen', { caption: 'Family room' }),

  // Garden level (level 1)
  gardenLiving: photo('C04A4729.jpg', 'Garden-level living room with French doors open to the covered lanai and garden', {
    caption: 'Garden-level living room, open to the covered lanai', focus: '45% 55%',
  }),
  gardenLiving2: photo('C04A4739.jpg', 'Garden-level living room with tile floors and garden views', { caption: 'Garden-level living room' }),
  gardenBath: photo('C04A4749.jpg', 'Garden-level full bath with glass shower', { caption: 'Garden-level bath' }),
  flexRoom: photo('C04A4764.jpg', 'Garden-level bedroom arranged with a bed and a work desk beside sliding doors to the garden', {
    caption: 'Garden-level bedroom, set up as guest room and office', focus: '50% 55%',
  }),

  // Lanais
  lanaiCovered: photo('C04A4663.jpg', 'Covered garden-level lanai with wicker seating looking onto lawn and tropical planting', {
    caption: 'Covered lanai, garden level', focus: '50% 55%',
  }),
  lanaiFurnished: still('lanai-wraparound.jpg', 'Furnished upper wraparound lanai with wicker seating and grill overlooking the garden', {
    caption: 'The upper wraparound lanai', focus: '64% 50%', file: 'assets/Photos/lanai second floor new photo.jpg', source: 'photographer',
  }),
  lanaiRockers: photo('C04A4975.jpg', 'Rocking chairs on the upper wraparound lanai above the palms', {
    caption: 'Morning coffee on the wraparound lanai', focus: '50% 50%',
  }),
  lanaiTopView: photo('C04A4851.jpg', 'The top-floor lanai off the primary suite, looking over the front lawn and grounds', {
    caption: 'Top-floor lanai, off the primary suite', focus: '50% 55%',
  }),

  // Primary retreat (level 3)
  primaryBedroom: photo('C04A4806.jpg', 'Top-floor primary bedroom wrapped in windows, with sliding doors to its lanai', {
    caption: 'Primary bedroom · 26′9″ × 19′10″', focus: '50% 55%',
  }),
  primaryDesk: photo('C04A4821.jpg', 'Desk beside a window in the primary suite', { caption: 'Desk nook in the primary suite' }),
  primaryBath: photo('C04A4836.jpg', 'Primary bath with freestanding tub, double vanity and natural light', {
    caption: 'Primary bath with freestanding tub and double vanity', focus: '50% 55%',
  }),
  primaryShower: photo('C04A4846.jpg', 'Glass-enclosed shower with marble-look tile', { caption: 'Primary shower' }),
  primaryVanity: photo('C04A5060.jpg', 'Detail of the vessel sinks on the primary vanity', { caption: 'Updated vanity and fixtures' }),

  // Grounds
  groundsLawn: photo('C04A4710.jpg', 'Wide lawn bordered by palms and a lava-rock wall', { caption: 'Half an acre, enclosed by rock wall and fencing', focus: '50% 60%' }),
  groundsGarden: photo('C04A4700.jpg', 'Tropical garden with red ti, palms and lawn', { caption: 'Mature palms and ornamentals', focus: '50% 55%' }),
  groundsWall: photo('C04A4705.jpg', 'Lawn and rock wall beside the house', { caption: 'Rock wall and lawn', focus: '50% 55%' }),
  citrus: still('film-citrus.jpg', 'Citrus fruit ripening on a tree in the garden, with a gecko on the fruit', {
    caption: 'Established fruit trees', focus: '50% 45%',
  }),

  // Garden harvest, photographed on the property in September 2026 (EXIF GPS matches the lot)
  coconuts: phone('garden-coconuts.jpg', 'IMG_5203.jpeg', 'A pile of freshly picked coconuts on the lawn beneath the palms', {
    caption: 'Coconuts', focus: '50% 62%',
  }),
  lilikoi: phone('garden-lilikoi.jpg', 'IMG_5229.jpeg', 'Lilikoʻi (passion fruit) hanging from the vine', {
    caption: 'Lilikoʻi (passion fruit)', focus: '62% 58%',
  }),
  papaya: phone('garden-papaya.jpg', 'IMG_5231.jpeg', 'Papaya tree heavy with fruit beside the lanai', {
    caption: 'Papaya', focus: '50% 40%',
  }),
  raisedBeds: phone('garden-raised-beds.jpg', 'IMG_5216.jpeg', 'Raised garden beds planted with greens on a gravel pad, with the house beyond', {
    caption: 'Raised garden beds', focus: '50% 62%',
  }),
  rainbow: phone('lanai-rainbow.jpg', 'IMG_5186.JPG', 'A double rainbow over the lawn and red ti hedge, seen from the lanai', {
    caption: 'A double rainbow from the lanai', focus: '50% 40%',
  }),

  // Setting
  contextOcean: photo('DJI_20261001134158_0705_D.jpg', 'High aerial view over Kaloli Point toward the Pacific Ocean horizon', {
    caption: 'Kaloli Point and the Pacific horizon', focus: '45% 55%',
  }),
  contextHigh: photo('DJI_20261001134148_0700_D.jpg', 'Aerial view over the neighborhood to the ocean', { caption: 'Kaloli Point' }),
  contextInland: photo('DJI_20261001134233_0716_D.jpg', 'Aerial view across the treetops of Hawaiian Paradise Park', { caption: 'Hawaiian Paradise Park' }),
  aerialSite: photo('DJI_20261001133658_0627_D.jpg', 'Aerial view of the house, lawn, solar array and water catchment tank', { caption: 'The site from above' }),
  filmOcean: still('film-ocean-aerial.jpg', 'Aerial view over treetops toward the Pacific Ocean', { caption: 'Toward the ocean', focus: '50% 50%' }),
  filmPoster: still('film-poster-v2.jpg', 'Aerial view of the octagonal residence among tall pines, from the property film', {
    caption: 'From the property film', focus: '50% 50%',
  }),

  // Kaloli Point coastline (owner photos; the honu shots carry GPS on the Kaloli Point shore)
  lookout: phone('kaloli-lookout.jpg', 'unnamed.jpg', 'A visitor with arms outstretched on the black lava headland at the Kaloli Point lookout, surf and open Pacific beyond', {
    caption: 'The Kaloli Point lookout', focus: '45% 52%',
  }),
  honuLava: phone('kaloli-honu-lava.jpg', 'IMG_3998.jpeg', 'A green sea turtle resting on black lava rock at the water’s edge near Kaloli Point', {
    caption: 'Honu on the lava shoreline near Kaloli Point', focus: '50% 70%',
  }),
  honuShore: phone('kaloli-honu-shore.jpg', 'IMG_8217.jpeg', 'A green sea turtle resting on a sandy cove near Kaloli Point', {
    caption: 'Honu resting on the shore near Kaloli Point', focus: '50% 70%',
  }),

  // Evenings (owner photographs from the public listing)
  sunsetHouse: owner('listing-sunset-house.jpg', 'The house beneath a pink and violet sky at dusk, with hibiscus in the foreground', { caption: 'Dusk over the house', focus: '56% 45%' }),
  sunsetYard: owner('listing-sunset-yard.jpg', 'Sunset clouds and a crescent moon over the lawn, palms and red ti', { caption: 'Sunset over the garden', focus: '50% 40%' }),
  nightSky: owner('listing-night-sky.jpg', 'The Milky Way above the illuminated house at night', { caption: 'The Milky Way above the house', focus: '50% 35%' }),

  agentPortrait: still('agent-misti.jpg', 'Misti R. Tyrin, listing agent', { focus: '62% 30%', file: 'assets/misti pic.avif', source: 'agent' }),
} satisfies Record<string, MediaItem>;

export const floorPlans = {
  level1: plan('Floor Plan Without Dimensions', '1st_floor_15_1077_amau_street_keaau_without_dim.jpg', 'Floor plan of level 1: bedroom, living room, bath, laundry, porch and covered lanai', 'Level 1 · Garden level'),
  level2: plan('Floor Plan Without Dimensions', '2nd_floor_15_1077_amau_street_keaau_without_dim.jpg', 'Floor plan of level 2: eat-in kitchen, family room, pantry, bath and lanais', 'Level 2 · Living level'),
  level3: plan('Floor Plan Without Dimensions', '3rd_floor_15_1077_amau_street_keaau_without_dim.jpg', 'Floor plan of level 3: primary bedroom, walk-in closet, primary bath and lanai', 'Level 3 · Primary retreat'),
  all: plan('Floor Plan Without Dimensions', 'all_floors_15_1077_amau_street_keaau_without_dim.jpg', 'All three floor plans side by side', 'All levels'),
  level1Dim: plan('Floor Plan With Dimensions', '1st_floor_15_1077_amau_street_keaau_with_dim.jpg', 'Dimensioned floor plan of level 1', 'Level 1 · with dimensions'),
  level2Dim: plan('Floor Plan With Dimensions', '2nd_floor_15_1077_amau_street_keaau_with_dim.jpg', 'Dimensioned floor plan of level 2', 'Level 2 · with dimensions'),
  level3Dim: plan('Floor Plan With Dimensions', '3rd_floor_15_1077_amau_street_keaau_with_dim.jpg', 'Dimensioned floor plan of level 3', 'Level 3 · with dimensions'),
  allDim: plan('Floor Plan With Dimensions', 'all_floors_15_1077_amau_street_keaau_with_dim.jpg', 'Dimensioned floor plans of all levels', 'All levels · with dimensions'),
} satisfies Record<string, MediaItem>;

export type GalleryChapter = { id: string; title: string; items: MediaItem[] };

// Editorial order: exterior → architecture → living → kitchen → lanai → primary → bath → grounds → context → mood.
export const galleryChapters: GalleryChapter[] = [
  { id: 'exterior', title: 'Arrival', items: [media.heroAerial, media.frontElevation, media.architectureAerial, media.entry, media.approach, media.stairLight] },
  { id: 'living', title: 'Living', items: [media.familyRoom, media.familyMedia, media.gardenLiving, media.gardenLiving2] },
  { id: 'kitchen', title: 'Kitchen', items: [media.kitchenWide, media.kitchenIsland, media.kitchenHall, media.kitchenSink, media.kitchenDetail] },
  { id: 'lanais', title: 'Lanais', items: [media.lanaiCovered, media.lanaiFurnished, media.lanaiRockers, media.lanaiTopView, media.rainbow] },
  { id: 'retreat', title: 'Bedrooms & baths', items: [media.primaryBedroom, media.primaryDesk, media.primaryBath, media.primaryShower, media.primaryVanity, media.flexRoom, media.gardenBath] },
  { id: 'grounds', title: 'Grounds & garden', items: [media.groundsGarden, media.groundsWall, media.groundsLawn, media.coconuts, media.lilikoi, media.papaya, media.raisedBeds, media.citrus] },
  { id: 'setting', title: 'Kaloli Point', items: [media.aerialSite, media.contextOcean, media.contextHigh, media.contextInland, media.filmOcean, media.lookout, media.honuLava, media.honuShore] },
  { id: 'evenings', title: 'Evenings', items: [media.sunsetHouse, media.sunsetYard, media.nightSky] },
];

export const galleryCount = galleryChapters.reduce((n, c) => n + c.items.length, 0);

// Paid assets intentionally left out of the editorial set (still in assets/ and listed in docs/MEDIA_INVENTORY.md).
export const excludedFromSite = [
  { file: 'assets/Photos/C04A4610.jpg', reason: 'Driveway frame dominated by bare ground; weaker duplicate of the approach' },
  { file: 'assets/Photos/C04A4985.jpg', reason: 'Replaced by the owners’ retouch with a healthier plant (assets/Photos/lanai second floor new photo.jpg)' },
  { file: 'assets/Photos/DJI_20261001133935_0660_D.jpg', reason: 'Roof fills the foreground; the house reads better in the other aerials' },
  { file: 'assets/Photos/Fruit and ocean photos/IMG_4741.jpeg', reason: 'EXIF GPS places it on Oʻahu’s North Shore (2021), so it cannot represent Kaloli Point' },
];
