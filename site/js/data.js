/**
 * Trip catalogue + flexibility policy (plain ES module, no framework).
 *
 * ============================ GROUP TRIP SCHEMA (stable) ============================
 * Every ready-made group trip (seeds in GROUP_TRIPS below + trips the owner publishes
 * from /owner/create/, merged by store.getTrips()) has this shape. Other pages read it;
 * add optional fields only, never rename.
 *
 *   {
 *     id: string,                 // 'g01' seeds, 'o-…' owner trips
 *     title: string,              // "Kedarkantha winter-break trek"
 *     destination: string,        // "Kedarkantha"
 *     price: number,              // ₹ per person (demo values, see GROUP_TRIPS note)
 *     dates: string[],            // departure dates, 'YYYY-MM-DD', earliest first
 *     seats: number,              // total seats
 *     coverImage: string,         // root path ('/assets/…') or JPEG data URL (owner upload)
 *     coverAlt: string,           // (optional) alt text for coverImage
 *     summary: string,            // 1-2 sentence card blurb
 *     inclusions: string[],
 *     days: [{
 *       day: number,              // 1-based, in order
 *       title: string,            // "Sankri to Juda-ka-Talab"
 *       place: string,            // where the day happens / ends
 *       description: string,
 *       activities: string[],
 *       image: string,            // root path or data URL; '' when none
 *       imageAlt: string,         // (optional)
 *       imageFallback: string,    // (optional) shown if image fails to load
 *       hotel: { name: string, note: string } | null   // null = no overnight stay
 *     }],
 *     pickupPointId: 'sundar-one' | 'college-gate',
 *   }
 *
 * Legacy aliases kept for older renderers (same values): budgetPerPerson = price,
 * date = dates[0], seatsTotal = seats, image/imageAlt = coverImage/coverAlt,
 * blurb = summary, durationLabel = "N days". store.getTrips() also adds
 * membersJoined, seatsLeft, filledPercent, isFull, pickupLabel.
 * Hotel names are placeholders ("Hotel: to be confirmed by Neel") until the owner confirms.
 * ====================================================================================
 *
 * IMPORTANT for page builders:
 * - Every price here is a PLACEHOLDER (priceIsPlaceholder: true). Never show the raw
 *   number as a firm price: use planner.priceLabel(trip) which renders "From ₹X*"
 *   with a "*indicative" note, or "Price on request" when PRICES_ARE_PUBLIC is false.
 * - Departure dates are indicative samples (datesAreIndicative: true) until Neel confirms.
 * - Policy values marked '[to confirm]' must never be printed raw; use `.display`.
 *
 * TODO(owner): confirm prices, departures, group sizes, inclusions and policy terms.
 */

/* Root paths so images resolve from any page depth (/owner/create/, /trip/…). */
const IMG = (name) => `/assets/images/places/${name}.jpg`;

/** Flip to true once the owner signs off on real prices. */
export const PRICES_ARE_PUBLIC = false;
/** Sample departures, group capacities and availability are not owner-confirmed. */
export const PUBLIC_INVENTORY_CONFIRMED = false;

export const WHATSAPP_NUMBER = '919825744110';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DIFFICULTY = {
  easy: { id: 'easy', label: 'Easy', note: 'No experience needed' },
  moderate: { id: 'moderate', label: 'Moderate', note: 'Some walking or light trekking' },
  challenging: { id: 'challenging', label: 'Challenging', note: 'Good fitness and prior trekking helpful' },
};

export const REGIONS = [
  'Uttarakhand', 'Himachal Pradesh', 'Ladakh', 'Rajasthan',
  'Kerala', 'Karnataka', 'Goa', 'Meghalaya',
];

/** Image library: every image has a stated purpose and crop. */
export const IMAGES = {
  'himalaya-peaks': { src: IMG('himalaya-peaks'), alt: 'Trekkers on a snow-covered ridge at Kedarkantha, Uttarakhand, with mountains behind' },
  'kedarkantha-hikers': { src: IMG('kedarkantha-hikers'), alt: 'Hikers climbing a snow-covered trail towards Kedarkantha in Uttarakhand', width: 1200, height: 1500, focus: '50% 50%' },
  'kedarkantha-hikers-editorial': { src: IMG('kedarkantha-hikers-editorial'), alt: 'Hikers climbing a snow-covered trail towards Kedarkantha in Uttarakhand', width: 1200, height: 1500, focus: '50% 50%' },
  'trek-trail': { src: IMG('trek-trail'), alt: 'Two trekkers with packs climbing the stone trail to Triund near Dharamshala, Himachal Pradesh', width: 1200, height: 1600 },
  'triund-trekkers-editorial': { src: IMG('triund-trekkers-editorial'), alt: 'Two trekkers with packs climbing the stone trail to Triund near Dharamshala, Himachal Pradesh', width: 1200, height: 1500 },
  'desert-dunes': { src: IMG('desert-dunes'), alt: 'Camel riders crossing pale sand dunes near Jaisalmer, Rajasthan' },
  'jaisalmer-camel-riders-editorial': { src: IMG('jaisalmer-camel-riders-editorial'), alt: 'Two riders and a guide crossing the Sam sand dunes by camel near Jaisalmer, Rajasthan', width: 1200, height: 1500 },
  'lake-city': { src: IMG('lake-city'), alt: 'Passengers aboard a red boat on Lake Pichola in Udaipur, Rajasthan', focus: '30% 50%' },
  'green-valley': { src: IMG('green-valley'), alt: 'The Parvati River flowing between forested mountain slopes near Kasol, Himachal Pradesh' },
  backwaters: { src: IMG('backwaters'), alt: 'Travellers aboard a traditional houseboat on the Alleppey backwaters in Kerala', focus: '84% 50%' },
  coast: { src: IMG('coast'), alt: 'People sitting in shallow water at Om Beach in Gokarna, Karnataka' },
  'monastery-ridge': { src: IMG('monastery-ridge'), alt: 'Key Monastery on its barren mountainside above the Spiti Valley, Himachal Pradesh' },
  'meghalaya-root-bridge': { src: IMG('meghalaya-root-bridge'), alt: 'Visitors beneath the double-decker living root bridge at Nongriat, Meghalaya' },
  'goa-palm-cove': { src: IMG('goa-palm-cove'), alt: 'Travellers walking along palm-lined Palolem Beach in Goa' },
  'ladakh-high-pass': { src: IMG('ladakh-high-pass'), alt: 'Three motorcyclists beneath the Khardung La pass sign and prayer flags in Ladakh' },
  'rishikesh-river': { src: IMG('rishikesh-river'), alt: 'Two rafters paddling the Ganga through a rocky gorge near Rishikesh, Uttarakhand' },
};

const img = (key, reason) => ({
  image: IMAGES[key].src,
  imageAlt: IMAGES[key].alt,
  imageKey: key,
  imageReason: reason,
  imageWidth: IMAGES[key].width || 1600,
  imageHeight: IMAGES[key].height || 1067,
  imageFocus: IMAGES[key].focus || '',
});

/* Shared inclusion/exclusion building blocks (placeholders until owner confirms). */
const BASE_INCLUDES = ['Stays on twin/triple sharing', 'Breakfast and dinner daily', 'Trip captain throughout', 'All transfers in the itinerary'];
const BASE_EXCLUDES = ['Travel to the start point', 'Lunch and personal expenses', 'Anything not listed in inclusions'];
const TREK_INCLUDES = ['Certified trek leader and local guide', 'Camping gear (tents, sleeping bags, mats)', 'Forest and trek permits', 'First-aid kit and oximeter'];
const COMMON_FAQS = [
  { q: 'Can I change my dates after booking?', a: 'Ask us about your new dates. We confirm available options and any fee in writing before you book.' },
  { q: 'When do I pay?', a: 'Review the trip details and the full per-person budget before the final payment step.' },
  { q: 'I am travelling solo. Is that okay?', a: 'Yes, you can enquire as a solo traveller. Ask us about room sharing and group options for your route.' },
];

export const TRIPS = [
  {
    id: 't01', slug: 'kedarkantha-summit-trek', name: 'Kedarkantha Summit Trek', region: 'Uttarakhand', destination: 'Kedarkantha',
    tagline: 'Snow trails, pine camps and a summit sunrise.', type: 'trek',
    days: 6, nights: 5, difficulty: 'moderate', months: [11, 12, 1, 2, 3, 4], peakMonths: [12, 1],
    groupMin: 8, groupMax: 18, spotsLeft: 5, basePricePerPerson: 9999, priceIsPlaceholder: true,
    departures: ['2026-12-12', '2026-12-26', '2027-01-09'], datesAreIndicative: true, startPoint: 'Dehradun',
    ...img('kedarkantha-hikers-editorial', 'A real snowy route with hikers in the foreground makes the summit trek and its scale clear in the arch crop.'),
    inclusions: [...BASE_INCLUDES, ...TREK_INCLUDES],
    exclusions: [...BASE_EXCLUDES, 'Porter or mule for personal bags (on request)'],
    itinerary: [
      { day: 1, title: 'Dehradun to Sankri', detail: 'Scenic drive along the Yamuna and Tons valleys. Evening briefing and gear check.' },
      { day: 2, title: 'Sankri to Juda-ka-Talab', detail: 'Forest climb through pine and oak to a frozen lake campsite.' },
      { day: 3, title: 'Juda-ka-Talab to base camp', detail: 'Open meadows with the first full view of the summit ridge.' },
      { day: 4, title: 'Summit day', detail: 'Pre-dawn start, sunrise on the summit, descent to Hargaon camp.' },
      { day: 5, title: 'Hargaon to Sankri', detail: 'Easy descent through the forest. Celebration dinner.' },
      { day: 6, title: 'Sankri to Dehradun', detail: 'Drive back, drop at Dehradun by evening.' },
    ],
    faqs: [{ q: 'Do I need trekking experience?', a: 'No, but you should be able to walk 5-6 hours a day. We share a simple fitness plan after booking.' }, ...COMMON_FAQS],
  },
  {
    id: 't02', slug: 'triund-mcleodganj-escape', name: 'Triund & McLeodganj Escape', region: 'Himachal Pradesh', destination: 'McLeodganj',
    tagline: 'Cafés, a ridge-top camp and the Dhauladhar at eye level.', type: 'trek',
    days: 5, nights: 4, difficulty: 'easy', months: [3, 4, 5, 6, 9, 10, 11], peakMonths: [5, 6, 10],
    groupMin: 6, groupMax: 16, spotsLeft: 9, basePricePerPerson: 7499, priceIsPlaceholder: true,
    departures: ['2026-10-16', '2026-10-30', '2026-11-13'], datesAreIndicative: true, startPoint: 'Delhi',
    ...img('triund-trekkers-editorial', 'Two walkers on the stone trail to Triund show the trekking experience; keep both hikers inside the card crop.'),
    inclusions: [...BASE_INCLUDES, 'Overnight camping at Triund ridge', 'Trek leader and permits'],
    exclusions: [...BASE_EXCLUDES],
    itinerary: [
      { day: 1, title: 'Overnight Volvo from Delhi', detail: 'Meet the group at the pickup point and depart.' },
      { day: 2, title: 'McLeodganj arrival', detail: 'Check in, Tsuglagkhang walk, Bhagsu waterfall and café crawl.' },
      { day: 3, title: 'Trek to Triund', detail: 'Steady 9 km climb to the ridge. Bonfire and stargazing camp.' },
      { day: 4, title: 'Sunrise and descent', detail: 'Sunrise over the Dhauladhar, descend and free evening in town.' },
      { day: 5, title: 'Return', detail: 'Overnight bus back to Delhi.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't03', slug: 'jaisalmer-desert-nights', name: 'Jaisalmer Desert Nights', region: 'Rajasthan', destination: 'Jaisalmer',
    tagline: 'Golden fort, dune camps and a sky full of stars.', type: 'culture',
    days: 5, nights: 4, difficulty: 'easy', months: [10, 11, 12, 1, 2, 3], peakMonths: [12, 1],
    groupMin: 6, groupMax: 20, spotsLeft: 12, basePricePerPerson: 8499, priceIsPlaceholder: true,
    departures: ['2026-11-06', '2026-11-20', '2026-12-18'], datesAreIndicative: true, startPoint: 'Jaisalmer',
    ...img('jaisalmer-camel-riders-editorial', 'Camel riders crossing the Sam dunes identify the Jaisalmer experience; keep the riders visible in narrow crops.'),
    inclusions: [...BASE_INCLUDES, 'Camel or jeep dune safari', 'Desert camp night with folk evening'],
    exclusions: [...BASE_EXCLUDES, 'Monument entry tickets'],
    itinerary: [
      { day: 1, title: 'Arrive Jaisalmer', detail: 'Check in and evening at Gadisar Lake.' },
      { day: 2, title: 'Golden fort and havelis', detail: 'Walk inside the living fort, Patwon ki Haveli and the old bazaar.' },
      { day: 3, title: 'To the dunes', detail: 'Kuldhara ruins, dune safari at sunset, camp night with music.' },
      { day: 4, title: 'Desert morning', detail: 'Sunrise on the dunes, free afternoon, rooftop farewell dinner.' },
      { day: 5, title: 'Departure', detail: 'Checkout after breakfast.' },
    ],
    faqs: [{ q: 'How cold are desert nights?', a: 'From December to January nights can drop close to freezing. Carry a warm jacket; blankets are provided at camp.' }, ...COMMON_FAQS],
  },
  {
    id: 't04', slug: 'udaipur-lakes-and-palaces', name: 'Udaipur Lakes & Palaces', region: 'Rajasthan', destination: 'Udaipur',
    tagline: 'Rooftop sunsets, boat rides and old-city lanes.', type: 'culture',
    days: 5, nights: 4, difficulty: 'easy', months: [9, 10, 11, 12, 1, 2, 3], peakMonths: [11, 12],
    groupMin: 6, groupMax: 18, spotsLeft: 7, basePricePerPerson: 8999, priceIsPlaceholder: true,
    departures: ['2026-10-23', '2026-11-27', '2026-12-25'], datesAreIndicative: true, startPoint: 'Udaipur',
    ...img('lake-city', 'A boat carrying visitors on Lake Pichola shows Udaipur from the water; keep the boat visible in narrow crops.'),
    inclusions: [...BASE_INCLUDES, 'Sunset boat ride on the lake', 'Day trip to Kumbhalgarh'],
    exclusions: [...BASE_EXCLUDES, 'Monument entry tickets'],
    itinerary: [
      { day: 1, title: 'Arrive Udaipur', detail: 'Check in to a lake-view stay. Sunset at Ambrai Ghat.' },
      { day: 2, title: 'City Palace and old city', detail: 'City Palace, Jagdish Temple, Bagore ki Haveli dance show.' },
      { day: 3, title: 'Kumbhalgarh day trip', detail: 'Walk the great wall of the fort and return by evening.' },
      { day: 4, title: 'Lakes and hills', detail: 'Boat ride, Sajjangarh sunset point, farewell rooftop dinner.' },
      { day: 5, title: 'Departure', detail: 'Checkout after breakfast.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't05', slug: 'kasol-parvati-valley', name: 'Kasol & Parvati Valley', region: 'Himachal Pradesh', destination: 'Kasol',
    tagline: 'River camps, forest villages and slow mornings.', type: 'mountains',
    days: 6, nights: 5, difficulty: 'moderate', months: [3, 4, 5, 6, 9, 10, 11], peakMonths: [5, 6],
    groupMin: 8, groupMax: 18, spotsLeft: 3, basePricePerPerson: 8999, priceIsPlaceholder: true,
    departures: ['2026-10-09', '2026-10-23', '2027-03-19'], datesAreIndicative: true, startPoint: 'Delhi',
    ...img('green-valley', 'Deep greens and a river read as "fresh mountain air" and balance the snowy images in the grid. Crop 16:9 card; river as a leading line.'),
    inclusions: [...BASE_INCLUDES, 'Riverside camp night', 'Kheerganga trek with guide'],
    exclusions: [...BASE_EXCLUDES],
    itinerary: [
      { day: 1, title: 'Overnight bus from Delhi', detail: 'Meet the group and depart.' },
      { day: 2, title: 'Kasol', detail: 'Check in, Chalal village walk along the Parvati.' },
      { day: 3, title: 'Tosh and Pulga', detail: 'Village hopping and waterfall walk.' },
      { day: 4, title: 'Kheerganga trek', detail: 'Forest trek to the hot springs and camp.' },
      { day: 5, title: 'Descent and Manikaran', detail: 'Return trek, gurudwara and hot springs.' },
      { day: 6, title: 'Return', detail: 'Overnight bus back to Delhi.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't06', slug: 'kerala-backwaters-drift', name: 'Kerala Backwaters Drift', region: 'Kerala', destination: 'Alleppey',
    tagline: 'Houseboat nights, tea hills and slow canals.', type: 'nature',
    days: 6, nights: 5, difficulty: 'easy', months: [9, 10, 11, 12, 1, 2, 3], peakMonths: [12, 1],
    groupMin: 6, groupMax: 16, spotsLeft: 8, basePricePerPerson: 12999, priceIsPlaceholder: true,
    departures: ['2026-11-13', '2026-12-11', '2027-01-22'], datesAreIndicative: true, startPoint: 'Kochi',
    ...img('backwaters', 'The houseboat and its passengers give the Kerala route a clear human scale; the arch crop is biased right to retain both people.'),
    inclusions: [...BASE_INCLUDES, 'One night on a private houseboat', 'Munnar tea estate visit'],
    exclusions: [...BASE_EXCLUDES],
    itinerary: [
      { day: 1, title: 'Arrive Kochi', detail: 'Fort Kochi walk, Chinese fishing nets at sunset.' },
      { day: 2, title: 'Kochi to Munnar', detail: 'Drive into the tea hills with waterfall stops.' },
      { day: 3, title: 'Munnar', detail: 'Tea estate, Top Station viewpoint, spice garden.' },
      { day: 4, title: 'Munnar to Alleppey', detail: 'Board the houseboat and drift through the canals overnight.' },
      { day: 5, title: 'Marari beach', detail: 'Village canoe ride in the morning, beach afternoon.' },
      { day: 6, title: 'Departure', detail: 'Drop at Kochi.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't07', slug: 'gokarna-coastal-trail', name: 'Gokarna Coastal Trail', region: 'Karnataka', destination: 'Gokarna',
    tagline: 'Beach-to-beach hikes and cliffside sunsets.', type: 'beach',
    days: 5, nights: 4, difficulty: 'moderate', months: [10, 11, 12, 1, 2, 3], peakMonths: [12, 1],
    groupMin: 6, groupMax: 16, spotsLeft: 10, basePricePerPerson: 7999, priceIsPlaceholder: true,
    departures: ['2026-11-06', '2026-12-04', '2027-01-15'], datesAreIndicative: true, startPoint: 'Bengaluru',
    ...img('coast', 'People at Om Beach show Gokarna as an active coastal stop; keep the people and shoreline in the crop.'),
    inclusions: [...BASE_INCLUDES, 'Guided beach trek (5 beaches)', 'Kayaking session'],
    exclusions: [...BASE_EXCLUDES],
    itinerary: [
      { day: 1, title: 'Overnight from Bengaluru', detail: 'Meet the group and depart.' },
      { day: 2, title: 'Gokarna town', detail: 'Temple town walk, Kudle beach sunset.' },
      { day: 3, title: 'Beach trek', detail: 'Kudle to Om, Half Moon and Paradise beach on foot.' },
      { day: 4, title: 'Kayak and chill', detail: 'Morning kayak, free afternoon, bonfire dinner.' },
      { day: 5, title: 'Return', detail: 'Overnight back to Bengaluru.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't08', slug: 'spiti-monastery-circuit', name: 'Spiti Monastery Circuit', region: 'Himachal Pradesh', destination: 'Spiti',
    tagline: 'High desert roads, cliff monasteries, the Milky Way.', type: 'mountains',
    days: 7, nights: 6, difficulty: 'challenging', months: [6, 7, 8, 9], peakMonths: [7, 8],
    groupMin: 8, groupMax: 14, spotsLeft: 4, basePricePerPerson: 16999, priceIsPlaceholder: true,
    departures: ['2027-06-12', '2027-07-10', '2027-08-14'], datesAreIndicative: true, startPoint: 'Manali',
    ...img('monastery-ridge', 'A monastery on a ridge is the one image that says "Spiti" and adds cultural depth. Crop 16:9 card or tall 4:5 feature tile; monastery in the upper-right third.'),
    inclusions: [...BASE_INCLUDES, 'Tempo traveller with expert mountain driver', 'Inner line permits'],
    exclusions: [...BASE_EXCLUDES, 'Monastery donations'],
    itinerary: [
      { day: 1, title: 'Manali', detail: 'Arrive, acclimatise, briefing.' },
      { day: 2, title: 'Manali to Kaza', detail: 'Over Kunzum pass, via Chandratal viewpoint.' },
      { day: 3, title: 'Key and Kibber', detail: 'Key monastery, Chicham bridge, Kibber village.' },
      { day: 4, title: 'Langza, Hikkim, Komic', detail: 'Fossil village, the highest post office, Buddha statue.' },
      { day: 5, title: 'Dhankar and Tabo', detail: 'Cliff monastery and the ancient Tabo caves.' },
      { day: 6, title: 'Back towards Manali', detail: 'Return drive with a Chandratal lake stop if roads allow.' },
      { day: 7, title: 'Departure', detail: 'Checkout in Manali.' },
    ],
    faqs: [{ q: 'Is altitude a concern?', a: 'Spiti sits high. We build in acclimatisation and carry oxygen and an oximeter. Tell us about any medical conditions.' }, ...COMMON_FAQS],
  },
  {
    id: 't09', slug: 'meghalaya-living-roots', name: 'Meghalaya Living Roots', region: 'Meghalaya', destination: 'Cherrapunji',
    tagline: 'Root bridges, blue pools and waterfalls in the clouds.', type: 'nature',
    days: 6, nights: 5, difficulty: 'moderate', months: [10, 11, 12, 1, 2, 3, 4], peakMonths: [11, 12],
    groupMin: 6, groupMax: 16, spotsLeft: 11, basePricePerPerson: 14499, priceIsPlaceholder: true,
    departures: ['2026-10-30', '2026-11-27', '2027-02-12'], datesAreIndicative: true, startPoint: 'Guwahati',
    ...img('meghalaya-root-bridge', 'The living-root bridge gives Meghalaya a distinct nature landmark; centre the bridge inside circular destination chips.'),
    inclusions: [...BASE_INCLUDES, 'Double-decker root bridge trek', 'Local Khasi guide'],
    exclusions: [...BASE_EXCLUDES],
    itinerary: [
      { day: 1, title: 'Guwahati to Shillong', detail: 'Umiam lake on the way, evening at Police Bazaar.' },
      { day: 2, title: 'Shillong to Cherrapunji', detail: 'Waterfalls, Mawsmai caves.' },
      { day: 3, title: 'Root bridge trek', detail: 'Steps down to Nongriat, double-decker bridge, Rainbow falls.' },
      { day: 4, title: 'Dawki and Shnongpang', detail: 'Clear-water river boating and village stay.' },
      { day: 5, title: 'Mawlynnong', detail: 'The clean village, sky view, back to Shillong.' },
      { day: 6, title: 'Departure', detail: 'Drop at Guwahati.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't10', slug: 'south-goa-slow-trip', name: 'South Goa Slow Trip', region: 'Goa', destination: 'Goa',
    tagline: 'Quiet beaches, Latin quarters and island hopping.', type: 'beach',
    days: 5, nights: 4, difficulty: 'easy', months: [10, 11, 12, 1, 2, 3, 4], peakMonths: [12, 1],
    groupMin: 6, groupMax: 20, spotsLeft: 14, basePricePerPerson: 9499, priceIsPlaceholder: true,
    departures: ['2026-11-20', '2026-12-28', '2027-02-05'], datesAreIndicative: true, startPoint: 'Goa (Madgaon)',
    ...img('goa-palm-cove', 'Palms and beachgoers identify Palolem Beach in Goa; keep both the shoreline and people in the crop.'),
    inclusions: [...BASE_INCLUDES, 'Scooter for 2 days (shared)', 'Island boat trip'],
    exclusions: [...BASE_EXCLUDES, 'Fuel for scooters'],
    itinerary: [
      { day: 1, title: 'Arrive South Goa', detail: 'Check in near Palolem, sunset on the beach.' },
      { day: 2, title: 'Island hopping', detail: 'Butterfly beach boat trip and Cabo de Rama fort.' },
      { day: 3, title: 'Old Goa and Fontainhas', detail: 'Churches, the Latin quarter walk, Panjim evening.' },
      { day: 4, title: 'Scooter day', detail: 'Hidden beaches of the south, farewell dinner.' },
      { day: 5, title: 'Departure', detail: 'Drop at Madgaon.' },
    ],
    faqs: [...COMMON_FAQS],
  },
  {
    id: 't11', slug: 'ladakh-high-passes', name: 'Ladakh High Passes', region: 'Ladakh', destination: 'Leh',
    tagline: 'Pangong blues, Nubra dunes and roads in the sky.', type: 'mountains',
    days: 7, nights: 6, difficulty: 'challenging', months: [5, 6, 7, 8, 9], peakMonths: [6, 7],
    groupMin: 8, groupMax: 16, spotsLeft: 6, basePricePerPerson: 21999, priceIsPlaceholder: true,
    departures: ['2027-05-29', '2027-06-19', '2027-07-17'], datesAreIndicative: true, startPoint: 'Leh',
    ...img('ladakh-high-pass', 'Motorcyclists at the Khardung La sign identify the Ladakh pass; keep the riders and sign together in small crops.'),
    inclusions: [...BASE_INCLUDES, 'SUV transfers with local drivers', 'Inner line permits', 'Oxygen cylinder on board'],
    exclusions: [...BASE_EXCLUDES, 'Flights to Leh'],
    itinerary: [
      { day: 1, title: 'Arrive Leh', detail: 'Full rest day to acclimatise.' },
      { day: 2, title: 'Leh local', detail: 'Shanti Stupa, Leh palace, Hall of Fame.' },
      { day: 3, title: 'Leh to Nubra', detail: 'Over Khardung La to Hunder dunes.' },
      { day: 4, title: 'Nubra to Pangong', detail: 'Shyok river road to the lake. Lakeside camp.' },
      { day: 5, title: 'Pangong to Leh', detail: 'Sunrise at the lake, back via Chang La.' },
      { day: 6, title: 'Monasteries', detail: 'Thiksey, Hemis and a free evening in the market.' },
      { day: 7, title: 'Departure', detail: 'Drop at Leh airport.' },
    ],
    faqs: [{ q: 'Why the rest day on arrival?', a: 'Leh is at high altitude. A full rest day lowers the risk of altitude sickness and is non-negotiable for safety.' }, ...COMMON_FAQS],
  },
  {
    id: 't12', slug: 'rishikesh-rafting-camp', name: 'Rishikesh Rafting & Camp', region: 'Uttarakhand', destination: 'Rishikesh',
    tagline: 'White water, riverside camps and Ganga aarti.', type: 'adventure',
    days: 5, nights: 4, difficulty: 'moderate', months: [2, 3, 4, 5, 6, 9, 10, 11], peakMonths: [3, 4, 5],
    groupMin: 6, groupMax: 20, spotsLeft: 15, basePricePerPerson: 6999, priceIsPlaceholder: true,
    departures: ['2026-10-02', '2026-10-16', '2027-03-05'], datesAreIndicative: true, startPoint: 'Delhi',
    ...img('rishikesh-river', 'Two rafters on the Ganga show the Rishikesh river experience; keep the raft in circular crops.'),
    inclusions: [...BASE_INCLUDES, '16 km rafting with certified guides', 'Riverside camp with bonfire'],
    exclusions: [...BASE_EXCLUDES, 'Bungee or other optional adventure sports'],
    itinerary: [
      { day: 1, title: 'Delhi to Rishikesh', detail: 'Drive up, Ganga aarti at Triveni Ghat.' },
      { day: 2, title: 'Rafting day', detail: 'Rafting on the Ganga with cliff jump, move to the river camp.' },
      { day: 3, title: 'Waterfall hike', detail: 'Neer Garh waterfall hike and café evening in Tapovan.' },
      { day: 4, title: 'Beatles ashram and yoga', detail: 'Morning yoga, ashram visit, farewell bonfire.' },
      { day: 5, title: 'Return', detail: 'Drive back to Delhi.' },
    ],
    faqs: [{ q: 'Can non-swimmers raft?', a: 'Yes. Life jackets and helmets are mandatory and guides brief everyone before starting.' }, ...COMMON_FAQS],
  },
];

/**
 * Flexibility policy. `value` holds the owner-facing draft marked '[to confirm]';
 * `display` is polished visitor-facing wording safe to print today.
 * TODO(owner): confirm every value, then set confirmed: true.
 */
export const FLEX_POLICY = {
  confirmed: false,
  dateChange: {
    title: 'Flexible date requests',
    value: 'Move to another departure up to [to confirm] days before start, once, at no fee',
    display: 'Ask about changing dates. We confirm available options and any fee before you book.',
    confirmed: false,
  },
  cancellation: {
    title: 'Clear cancellation terms',
    value: '[to confirm] % refund if cancelled [to confirm] days before departure',
    display: 'Transparent cancellation terms shared in writing before you pay.',
    confirmed: false,
  },
  paymentTiming: {
    title: 'Payment timing',
    value: 'Full budget is due at the final payment step',
    display: 'Review the full budget before the final payment step.',
    confirmed: false,
  },
  transfer: {
    title: 'Transfer your spot',
    value: 'Spot transferable to a friend up to [to confirm] days before start',
    display: 'Ask whether your booking can transfer to a friend; terms are confirmed before you book.',
    confirmed: false,
  },
  groupDiscount: {
    title: 'Group savings',
    value: 'Indicative: 5% for 4-7, 8% for 8-11, 12% for 12+ travellers [to confirm]',
    display: 'Travelling with friends? Ask for a group quote.',
    confirmed: false,
  },
  flexibleDates: {
    title: 'Flexible-date savings',
    value: 'Indicative: 5% off if flexible by 3+ days, 8% if flexible by 7+ days [to confirm]',
    display: 'Flexible on dates? Share your range so we can quote suitable options.',
    confirmed: false,
  },
  pricing: {
    title: 'All-in pricing',
    value: 'Prices [to confirm] inclusive of GST',
    display: 'Ask for a full price breakdown before you pay.',
    confirmed: false,
  },
};

/* Builder options (used by planner.estimate and the trip-builder page). */
export const STAY_TYPES = [
  { id: 'hostel', label: 'Backpacker / hostel', multiplier: 0.85 },
  { id: 'standard', label: 'Comfort stays', multiplier: 1 },
  { id: 'boutique', label: 'Boutique & premium', multiplier: 1.35 },
];

/** perPerson: flat ₹ per traveller; perDay: ₹ per traveller per day. Placeholder costs. */
export const ADD_ONS = [
  { id: 'pickup', label: 'Airport / station pickup', perPerson: 600 },
  { id: 'photographer', label: 'Trip photographer', perPerson: 1200 },
  { id: 'adventure', label: 'Extra adventure activity', perPerson: 1500 },
  { id: 'insurance', label: 'Travel insurance', perPerson: 450 },
  { id: 'private-cab', label: 'Private cab upgrade', perDay: 900 },
  { id: 'all-meals', label: 'All meals included', perDay: 450 },
];

/* ---------- Student group trips (Manipal University Jaipur, Sundar One hostel) ----------
 * Separate from TRIPS above. Only the owner (Neel) creates group trips (/owner/create/);
 * students browse a ready trip, read its full day-by-day plan, then join. Private groups
 * use Plan my trip instead. Shape: see GROUP TRIP SCHEMA at the top of this file.
 * Rule: joining means the student confirms they can pay the full price. No loans,
 * splits or waivers exist anywhere in the flow.
 */

/** Exactly two fixed pickup points. Every group trip drops back at the chosen pickup point. */
export const PICKUP_POINTS = [
  { id: 'sundar-one', label: 'Sundar One hostel gate' },
  { id: 'college-gate', label: 'College gate (Manipal University Jaipur)' },
];

export const DROP_NOTE = 'Drop back at your pickup point';

export const GROUP_SEATS_MIN = 2;
export const GROUP_SEATS_MAX = 30;

/** Known destinations: suggestions in the owner trip creator (image reused from places/*). */
export const GROUP_DESTINATIONS = [
  { id: 'jaipur-forts', label: 'Jaipur forts (Amer & Nahargarh)', image: '/assets/images/trip-jaipur-amer-fort.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'Amer Fort on its hillside above Maota Lake near Jaipur, walls reflected in the water at sunset' },
  { id: 'pushkar', label: 'Pushkar', image: IMG('jaisalmer-camel-cart-natural'), imageWidth: 1200, imageHeight: 1500, imageAlt: 'A camel cart on a sandy road in Rajasthan' },
  { id: 'kedarkantha', label: 'Kedarkantha', image: '/assets/images/trip-kedarkantha-summit.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'Snowy ridge and pine forest below a Himalayan peak on the Kedarkantha trek in Uttarakhand' },
  { id: 'jaisalmer', label: 'Jaisalmer', image: '/assets/images/trip-jaisalmer-fort.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'Golden sandstone Jaisalmer Fort rising above the old city at sunset, desert dunes beyond' },
  { id: 'udaipur', label: 'Udaipur', image: '/assets/images/trip-udaipur-city-palace.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'City Palace and old-city ghats along Lake Pichola in Udaipur, with the Aravalli hills behind' },
  { id: 'rishikesh', label: 'Rishikesh', image: IMG('rishikesh-river'), imageAlt: 'Two rafters paddling the Ganga through a rocky gorge near Rishikesh' },
];

/** Image used when a student types a destination that is not in GROUP_DESTINATIONS. */
export const GROUP_FALLBACK_IMAGE = { image: IMG('green-valley'), imageAlt: 'A forested river valley in the mountains' };

/**
 * Seed group trips. DEMO DATA: budgets, seat counts, joined counts and dates are illustrative
 * demo values for the prototype, not confirmed quotes or real departures.
 * membersJoined is the seed count; the store adds students who join in this browser.
 * Legacy fields here; GROUP_TRIPS (below) adds the schema fields, inclusions and days.
 */
const GROUP_SEEDS = [
  {
    id: 'g01', destination: 'Jaipur forts (Amer & Nahargarh)', title: 'Amer & Nahargarh fort day trip', durationLabel: '1 day',
    blurb: 'Sunrise climb at Amer, Jaleb Chowk photo stops and sunset over the city from Nahargarh.',
    date: '2026-11-14', budgetPerPerson: 599, seatsTotal: 25, membersJoined: 22, pickupPointId: 'sundar-one',
    image: '/assets/images/trip-jaipur-amer-fort.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'Amer Fort on its hillside above Maota Lake near Jaipur, walls reflected in the water at sunset', dropNote: DROP_NOTE,
  },
  {
    id: 'g02', destination: 'Pushkar', title: 'Pushkar weekend escape', durationLabel: '2 days',
    blurb: 'Ghats at dawn, Brahma temple, café-lined lanes and a Savitri hill sunset.',
    date: '2026-11-21', budgetPerPerson: 1499, seatsTotal: 16, membersJoined: 9, pickupPointId: 'college-gate',
    image: IMG('jaisalmer-camel-cart-natural'), imageWidth: 1200, imageHeight: 1500, imageAlt: 'A camel cart on a sandy road in Rajasthan', dropNote: DROP_NOTE,
  },
  {
    id: 'g03', destination: 'Kedarkantha', title: 'Kedarkantha winter-break trek', durationLabel: '6 days',
    blurb: 'Snow trails, pine-forest camps and a summit sunrise with a group from your own campus.',
    date: '2026-12-19', budgetPerPerson: 8499, seatsTotal: 18, membersJoined: 16, pickupPointId: 'college-gate',
    image: '/assets/images/trip-kedarkantha-summit.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'Snowy ridge and pine forest below a Himalayan peak on the Kedarkantha trek in Uttarakhand', dropNote: DROP_NOTE,
  },
  {
    id: 'g04', destination: 'Jaisalmer', title: 'Jaisalmer desert camp', durationLabel: '4 days',
    blurb: 'Golden fort walk, Sam dunes at sunset and a campfire night under the stars.',
    date: '2027-01-09', budgetPerPerson: 5499, seatsTotal: 20, membersJoined: 11, pickupPointId: 'sundar-one',
    image: '/assets/images/trip-jaisalmer-fort.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'Golden sandstone Jaisalmer Fort rising above the old city at sunset, desert dunes beyond', dropNote: DROP_NOTE,
  },
  {
    id: 'g05', destination: 'Udaipur', title: 'Udaipur lakes weekend', durationLabel: '3 days',
    blurb: 'Lake Pichola boat ride, City Palace, old-city lanes and rooftop sunsets.',
    date: '2026-12-05', budgetPerPerson: 3999, seatsTotal: 15, membersJoined: 6, pickupPointId: 'sundar-one',
    image: '/assets/images/trip-udaipur-city-palace.jpg', imageWidth: 1280, imageHeight: 800, imageAlt: 'City Palace and old-city ghats along Lake Pichola in Udaipur, with the Aravalli hills behind', dropNote: DROP_NOTE,
  },
  {
    id: 'g06', destination: 'Rishikesh', title: 'Rishikesh rafting & camp', durationLabel: '3 days',
    blurb: 'White-water rafting, riverside camp bonfire and Ganga aarti at Triveni Ghat.',
    date: '2026-11-28', budgetPerPerson: 2999, seatsTotal: 20, membersJoined: 13, pickupPointId: 'college-gate',
    image: IMG('rishikesh-river'), imageAlt: 'Two rafters paddling the Ganga through a rocky gorge near Rishikesh', dropNote: DROP_NOTE,
  },
];

/* Day-by-day plans for the seeds: one entry per trip day. Stays are placeholders until
 * Neel confirms them; inclusions are drafts.
 * Day images live at /assets/images/trips/<trip-id>/day-<N>.jpg (search terms per day in
 * research/day-images-plan.md). imageFallback is an existing photo of the same destination,
 * used by itinerary.js if the day photo is missing; after that a neutral placeholder shows. */
const STAY = (kind, note) => ({ name: `${kind}: to be confirmed by Neel`, note });
const DAY_PHOTO = (tripId, day, alt, fallback = '') => ({
  image: `/assets/images/trips/${tripId}/day-${day}.jpg`, imageAlt: alt, imageFallback: fallback,
});
const RETURN_TRAVEL = 'Return transport from and to your pickup point';

const SEED_PLANS = {
  g01: {
    inclusions: [RETURN_TRAVEL, 'Trip captain for the day', 'Water and a packed snack'],
    days: [
      {
        day: 1, title: 'Amer at sunrise, Nahargarh at sunset', place: 'Amer and Nahargarh, Jaipur',
        description: 'We leave the pickup point before dawn so the group reaches Amer Fort as the first light hits its honey-coloured walls above Maota Lake. You walk up the old ramp through Suraj Pol into Jaleb Chowk, then explore the Diwan-i-Aam, the painted Ganesh Pol and the mirror-work ceilings of the Sheesh Mahal while the courtyards are still quiet. Next is a short stop at Panna Meena ka Kund, the criss-cross stepwell just below the fort, for the classic group photo on its steps. On the way back into the city we pause at the Man Sagar Lake promenade to see Jal Mahal floating in the water, then break for a Rajasthani lunch in the old walled city with time to wander the bazaars around Hawa Mahal. In the late afternoon the bus climbs the Aravalli ridge road to Nahargarh Fort, where you explore the maze of rooms in Madhavendra Bhawan. The day ends on the fort walls watching the sun go down over the whole pink city before we drive back to your pickup point.',
        activities: ['Sunrise walk up to Amer Fort through Suraj Pol', 'Jaleb Chowk, Ganesh Pol and the Sheesh Mahal mirror palace', 'Group photos at Panna Meena ka Kund stepwell', 'Jal Mahal view from Man Sagar Lake', 'Lunch and bazaar time near Hawa Mahal', 'Madhavendra Bhawan inside Nahargarh Fort', 'Sunset over Jaipur from the Nahargarh walls'],
        ...DAY_PHOTO('g01', 1, 'Amer Fort on its hillside above Maota Lake, Jaipur', '/assets/images/trip-jaipur-amer-fort.jpg'),
        hotel: null,
      },
    ],
  },
  g02: {
    inclusions: [RETURN_TRAVEL, 'One night stay on twin/triple sharing', 'Breakfast on day 2', 'Trip captain throughout'],
    days: [
      {
        day: 1, title: 'Jaipur to Pushkar: temple lanes and lakeside aarti', place: 'Pushkar',
        description: 'We leave after breakfast for the roughly three-hour drive past Ajmer and over the Aravalli hills into Pushkar. After checking in near the lake, the group walks to the Brahma Temple, one of the very few temples in India dedicated to Brahma, with its red spire and marble courtyard. Lunch is in one of the rooftop cafés of the main bazaar, followed by free time to browse the lanes for block-print fabric, silver jewellery and leather sandals. In the late afternoon you head down to the ghats around the holy Pushkar Lake; remember to take off your shoes and keep cameras respectful near bathers. As the sun sets we sit on Varaha Ghat or Gau Ghat for the evening aarti, when bells, chants and lamps fill the water. Dinner is together back near the lake, then a relaxed night at the guesthouse.',
        activities: ['Morning drive from Jaipur via Ajmer', 'Brahma Temple visit', 'Rooftop café lunch in the main bazaar', 'Shopping for block prints and silver in the market lanes', 'Walk along the ghats of Pushkar Lake', 'Evening aarti at Varaha Ghat or Gau Ghat'],
        ...DAY_PHOTO('g02', 1, 'Ghats and white temples along Pushkar Lake, Rajasthan', IMG('jaisalmer-camel-cart-natural')),
        hotel: STAY('Hotel', 'Guesthouse near the lake, twin/triple sharing.'),
      },
      {
        day: 2, title: 'Ghats at dawn, Savitri hill at sunset', place: 'Pushkar',
        description: 'Early risers can join the trip captain for a quiet sunrise on the ghats while the lake is still misty and pilgrims arrive for their morning dip. After breakfast at the guesthouse and checkout, the morning is free for cafés, a last round of shopping or a camel-cart ride on the edge of town among the dunes. After lunch we walk to the base of Ratnagiri hill and ride the ropeway (or climb the steps, about 45 minutes) up to Savitri Temple. From the top you look over the whole town, the lake and the desert beyond, and the group stays to watch the sun set over the hills. We then come down and start the drive back to Jaipur, stopping for dinner on the highway. Drop back at your pickup point late in the evening.',
        activities: ['Optional sunrise walk on the ghats', 'Breakfast and checkout', 'Free time for cafés, shopping or a camel-cart ride', 'Ropeway or hike up to Savitri Temple on Ratnagiri hill', 'Sunset view over Pushkar and the desert', 'Drive back to Jaipur with a dinner stop'],
        ...DAY_PHOTO('g02', 2, 'View over Pushkar town and lake from Savitri Temple hill at sunset', IMG('jaisalmer-camel-cart-natural')),
        hotel: null,
      },
    ],
  },
  g03: {
    inclusions: [RETURN_TRAVEL, 'Trek leader and local guide', 'Camping gear (tents, sleeping bags, mats)', 'Forest and trek permits', 'Meals on the trek', 'First-aid kit and oximeter'],
    days: [
      {
        day: 1, title: 'Overnight to Dehradun', place: 'Jaipur to Dehradun',
        description: 'The group meets at the pickup point in the evening for a gear and document check: ID, warm layers, trekking shoes and a head torch. The trip captain walks everyone through the plan, the fitness pace on the trail and the rules of a snow trek. We then board the overnight journey north towards Uttarakhand, with a dinner stop on the highway. Get as much sleep as you can on the way, because the mountains start tomorrow. By early morning the plains give way to the Doon valley and the first line of the Shivalik hills.',
        activities: ['Evening pickup and gear check', 'Trip briefing with the trip captain', 'Dinner stop on the highway', 'Overnight travel to Dehradun'],
        ...DAY_PHOTO('g03', 1, 'Early morning view of the Shivalik foothills above Dehradun, Uttarakhand', '/assets/images/hero/hero-mountains.jpg'),
        hotel: null,
      },
      {
        day: 2, title: 'Dehradun to Sankri through the Tons valley', place: 'Sankri',
        description: 'After a breakfast stop in Dehradun, a trek vehicle takes the group up past Mussoorie and then down into the Yamuna valley towards Nainbagh and Purola. The road gets narrower and greener as it follows the Tons river through Mori and Naitwar, with apple orchards and wooden village houses along the way. It is a long day on the road (around 8 to 10 hours), so we stop for lunch and tea at dhabas by the river. By late afternoon you reach Sankri, a small village at about 1,900 m inside the Govind Wildlife Sanctuary area, with the snow peaks of Swargarohini visible on clear evenings. The trek leader holds a briefing on layering, water and the route, and we take a short walk around the village to start acclimatising.',
        activities: ['Breakfast stop in Dehradun', 'Drive via Mussoorie, Purola and Mori along the Tons river', 'Dhaba lunch on the way', 'Evening walk around Sankri village', 'Trek briefing and layering check with the trek leader'],
        ...DAY_PHOTO('g03', 2, 'Wooden houses of Sankri village below pine forest, Uttarakhand', '/assets/images/hero/kedarkantha-sunrise-natural.jpg'),
        hotel: STAY('Homestay', 'Base-village homestay in Sankri, shared rooms.'),
      },
      {
        day: 3, title: 'Sankri to Juda-ka-Talab', place: 'Juda-ka-Talab',
        description: 'The trek begins after breakfast with a steady climb out of Sankri on a well-used trail through pine, oak and maple forest. The route is about 4 km and gains around 900 m, so the leader sets an easy pace with regular water and snack breaks. You cross small wooden bridges over streams and pass shepherd huts before the forest opens into a clearing. Here sits Juda-ka-Talab, a small lake at about 2,800 m that usually freezes over in mid-winter and is ringed by tall pines. After a hot lunch at camp the afternoon is free to rest, play in the snow and learn how to pitch a tent. If the sky is clear, the night brings some of the best stargazing of the trip.',
        activities: ['Forest trek from Sankri (about 4 km, 4 to 5 hours)', 'Stream crossings through pine and oak forest', 'Hot lunch at camp', 'Snow play and tent pitching around the frozen lake', 'Stargazing on clear nights'],
        ...DAY_PHOTO('g03', 3, 'Frozen Juda-ka-Talab lake surrounded by snowy pine forest on the Kedarkantha trek', IMG('kedarkantha-hikers-natural')),
        hotel: STAY('Campsite', 'Tents on twin/triple sharing at Juda-ka-Talab.'),
      },
      {
        day: 4, title: 'Juda-ka-Talab to Kedarkantha base camp', place: 'Kedarkantha base camp',
        description: 'A shorter but steeper walk takes you from the lake up through thinning forest to the open snowfields of Kedarkantha base camp at about 3,400 m. As the trees fall away, the summit ridge appears for the first time straight ahead. From camp you get wide views of Himalayan peaks such as Swargarohini, Bandarpoonch and Black Peak, which glow orange at sunset. The afternoon is for rest and acclimatisation: drink plenty of water, eat well and take a short walk above camp to help your body adjust. The trek leader runs through the summit plan, the crampons or microspikes and the turnaround time. Early dinner and early to bed, because the summit push starts in the dark.',
        activities: ['Climb through thinning forest to the snowfields (about 3 km)', 'First full view of the Kedarkantha summit ridge', 'Acclimatisation walk above camp', 'Sunset on Swargarohini and Bandarpoonch peaks', 'Summit briefing and early dinner'],
        ...DAY_PHOTO('g03', 4, 'Tents at Kedarkantha base camp in the snow with Himalayan peaks behind', IMG('himalaya-peaks')),
        hotel: STAY('Campsite', 'Tents on twin/triple sharing at base camp.'),
      },
      {
        day: 5, title: 'Summit sunrise, descent to Hargaon', place: 'Kedarkantha summit',
        description: 'Wake-up is around 3 am for hot tea and a light snack before starting up the snow slope with head torches. The climb to the summit at about 3,800 m (12,500 ft) takes three to four hours, and the leader keeps the group together and decides the turnaround point if the weather turns. Reaching the top at sunrise, you see a full circle of Garhwal peaks lit up gold, with the small summit shrine and prayer flags beside you. After photos and a short celebration, the group descends carefully back to base camp for a hot breakfast. We then continue down a different trail through snow-covered clearings to Hargaon camp, set among pine trees. The evening is for rest, warm food and sharing summit stories around camp.',
        activities: ['Pre-dawn start with head torches', 'Summit climb to about 3,800 m (12,500 ft)', 'Sunrise over the Garhwal Himalaya from the summit', 'Descent to base camp for breakfast', 'Walk down to Hargaon camp through snowy clearings'],
        ...DAY_PHOTO('g03', 5, 'Sunrise from the snowy Kedarkantha summit over the Garhwal Himalaya', IMG('kedarkantha-summit-sunrise')),
        hotel: STAY('Campsite', 'Tents at Hargaon camp.'),
      },
      {
        day: 6, title: 'Hargaon to Sankri, overnight home', place: 'Sankri to Jaipur',
        description: 'An easy two to three hour walk takes you down from Hargaon through the forest and past village fields back to Sankri. There is time for a hot shower, lunch at the homestay and certificates for everyone who completed the trek. The trek vehicle then drives back down the Tons valley to Dehradun, retracing the river road you came up on day 2. In Dehradun the group has dinner together before boarding the overnight journey home. Drop back at your pickup point the next morning.',
        activities: ['Forest descent from Hargaon to Sankri', 'Hot shower and lunch at the homestay', 'Trek completion certificates', 'Drive to Dehradun', 'Dinner and overnight travel back to Jaipur'],
        ...DAY_PHOTO('g03', 6, 'Snowy ridge and pine forest below a Himalayan peak on the Kedarkantha trek', '/assets/images/trip-kedarkantha-summit.jpg'),
        hotel: null,
      },
    ],
  },
  g04: {
    inclusions: [RETURN_TRAVEL, 'One hotel night and one desert camp night', 'Breakfast and dinner on stay days', 'Camel or jeep dune safari', 'Trip captain throughout'],
    days: [
      {
        day: 1, title: 'Overnight to Jaisalmer', place: 'Jaipur to Jaisalmer',
        description: 'The group meets at the pickup point in the evening, and the trip captain checks IDs and shares the plan for the next four days. We board the overnight journey west across Rajasthan, through Jodhpur and into the Thar Desert. Pack a warm layer in your day bag, because desert nights and early mornings get cold from November to February. Dinner is on the way, and then it is time to sleep. You wake up to flat golden scrubland and the first sight of Jaisalmer rising out of the desert.',
        activities: ['Evening pickup and ID check', 'Trip briefing with the trip captain', 'Overnight travel west via Jodhpur', 'Dinner on the way'],
        ...DAY_PHOTO('g04', 1, 'A road through the Thar Desert at dawn on the way to Jaisalmer, Rajasthan', IMG('jaisalmer-camel-cart-natural')),
        hotel: null,
      },
      {
        day: 2, title: 'The golden fort and havelis', place: 'Jaisalmer old city',
        description: 'After arriving and checking in at the old-city hotel, you get a few hours to rest and freshen up over breakfast. Late morning we walk up through the gates of Jaisalmer Fort (Sonar Quila), one of the few forts in the world where people still live inside the walls. You explore its narrow lanes, the carved Jain temples and the views from the ramparts over the yellow sandstone city. After lunch the group walks down into the old town to Patwon ki Haveli, a cluster of five merchant mansions covered in stone carving as fine as lace, and the peacock-shaped balconies of Salim Singh ki Haveli nearby. There is free time in the old bazaar for mirror-work bags, leather goods and a glass of makhaniya lassi. In the evening we head to Gadisar Lake, with its temples and stone arches on the water, to watch the sunset before dinner.',
        activities: ['Check in and breakfast', 'Walk inside Jaisalmer Fort (Sonar Quila) and its Jain temples', 'Views from the fort ramparts', 'Patwon ki Haveli and Salim Singh ki Haveli', 'Shopping in the old bazaar', 'Sunset at Gadisar Lake'],
        ...DAY_PHOTO('g04', 2, 'Golden sandstone Jaisalmer Fort rising above the old city', '/assets/images/trip-jaisalmer-fort.jpg'),
        hotel: STAY('Hotel', 'Old-city hotel, twin/triple sharing.'),
      },
      {
        day: 3, title: 'Bada Bagh, Kuldhara and the Sam dunes', place: 'Sam sand dunes',
        description: 'After breakfast and checkout we drive to Bada Bagh, a hillside of carved sandstone cenotaphs built for the old rulers of Jaisalmer, with wind turbines turning on the ridge behind. Next is Kuldhara, the abandoned village whose people are said to have left overnight about two centuries ago; you walk among the roofless stone houses and hear the story from a local guide. After lunch we continue west to the camp near the Sam sand dunes, about 40 km from the city. In the late afternoon the group rides out into the dunes on camels (or a jeep safari for those who prefer) to find a quiet ridge for sunset. Back at camp there is Rajasthani folk music and dance around the fire, a traditional dinner and, away from city lights, a sky thick with stars.',
        activities: ['Bada Bagh cenotaphs', 'Kuldhara abandoned village with a local guide', 'Check in at the desert camp near Sam', 'Camel or jeep safari to the dunes at sunset', 'Folk music, dance and campfire dinner', 'Stargazing in the desert'],
        ...DAY_PHOTO('g04', 3, 'Camel riders crossing the Sam sand dunes near Jaisalmer at sunset', IMG('jaisalmer-camel-riders-editorial')),
        hotel: STAY('Desert camp', 'Tented camp at the dunes, twin/triple sharing.'),
      },
      {
        day: 4, title: 'Desert sunrise, journey home', place: 'Jaisalmer to Jaipur',
        description: 'Wake up early and walk out onto the dunes with a hot cup of chai to watch the sun rise over the sand. The morning light is the best of the trip for photos, with ripples in the dunes and long shadows. After breakfast at camp there is time to relax before we drive back into Jaisalmer for lunch and a last stroll around the fort area. In the afternoon the group starts the overnight journey home. Drop back at your pickup point the next morning.',
        activities: ['Sunrise walk on the dunes', 'Breakfast at camp', 'Lunch and last stroll in Jaisalmer', 'Overnight travel back to Jaipur'],
        ...DAY_PHOTO('g04', 4, 'Sunrise over the rippled Sam sand dunes near Jaisalmer', IMG('jaisalmer-dunes-daylight')),
        hotel: null,
      },
    ],
  },
  g05: {
    inclusions: [RETURN_TRAVEL, 'Two nights on twin/triple sharing', 'Breakfast daily', 'Boat ride on Lake Pichola', 'Trip captain throughout'],
    days: [
      {
        day: 1, title: 'Jaipur to Udaipur, sunset on the lake', place: 'Udaipur',
        description: 'We leave the pickup point early in the morning for the drive south through Ajmer, Bhilwara and Chittorgarh district, about six to seven hours with breakfast and lunch stops. The landscape turns greener and hillier as the Aravallis close in around Udaipur. After checking in at the lake-area hotel, the group walks to the jetty for a boat ride on Lake Pichola in the late afternoon. From the water you see the long white facade of the City Palace, the Lake Palace hotel floating in the middle and the island palace of Jag Mandir. As the light drops we cross to Ambrai Ghat on the far shore, the best spot in the city to watch the palace and ghats turn gold and then light up. Dinner is at a rooftop restaurant overlooking the lake.',
        activities: ['Morning drive from Jaipur with breakfast and lunch stops', 'Check in near Lake Pichola', 'Boat ride on Lake Pichola past the Lake Palace and Jag Mandir', 'Sunset at Ambrai Ghat', 'Rooftop dinner with a lake view'],
        ...DAY_PHOTO('g05', 1, 'Boat on Lake Pichola with the City Palace of Udaipur behind at sunset', IMG('lake-city')),
        hotel: STAY('Hotel', 'Lake-area hotel, twin/triple sharing.'),
      },
      {
        day: 2, title: 'City Palace and the old city', place: 'Udaipur old city',
        description: 'After breakfast the group walks up to the City Palace, the largest palace complex in Rajasthan, built over several centuries by the Mewar rulers. Inside you explore courtyards, mirror and glass inlay rooms, the peacock mosaics of Mor Chowk and balconies with sweeping views over Lake Pichola. Next door is Jagdish Temple, a 17th-century temple covered in carvings and reached by a steep flight of steps. After lunch in the old city, you get free time in the lanes for miniature paintings, leather notebooks and puppet shops, with rooftop cafés for a break. In the late afternoon we walk down to Gangaur Ghat to see the old haveli fronts and the lake at golden hour. In the evening the group watches the Dharohar folk dance show at Bagore ki Haveli, famous for the dancer who balances a tower of pots on her head.',
        activities: ['City Palace courtyards and Mor Chowk', 'Jagdish Temple', 'Lunch in the old city', 'Free time for miniature paintings and puppet shops', 'Golden hour at Gangaur Ghat', 'Dharohar folk dance show at Bagore ki Haveli'],
        ...DAY_PHOTO('g05', 2, 'City Palace and old-city ghats along Lake Pichola, Udaipur', '/assets/images/trip-udaipur-city-palace.jpg'),
        hotel: STAY('Hotel', 'Same lake-area hotel.'),
      },
      {
        day: 3, title: 'Fateh Sagar, Saheliyon ki Bari, drive home', place: 'Udaipur to Jaipur',
        description: 'The last morning starts with a walk along the promenade of Fateh Sagar Lake, where locals jog, feed the birds and sell fresh coconut water with the hills behind. Those who want can take a short boat ride out to Nehru Garden island in the middle of the lake. We then visit Saheliyon ki Bari, the Garden of the Maidens, with its lotus pools, marble elephants and fountains built for the royal ladies of the court. After an early lunch in town and checkout, the group starts the drive back north to Jaipur with tea and dinner stops on the highway. Drop back at your pickup point by night.',
        activities: ['Morning walk on the Fateh Sagar Lake promenade', 'Optional boat to Nehru Garden island', 'Saheliyon ki Bari gardens and fountains', 'Early lunch and checkout', 'Drive back to Jaipur'],
        ...DAY_PHOTO('g05', 3, 'Fateh Sagar Lake in Udaipur with the Aravalli hills behind', IMG('lake-city')),
        hotel: null,
      },
    ],
  },
  g06: {
    inclusions: [RETURN_TRAVEL, 'Two nights at a riverside camp', 'Breakfast and dinner at camp', 'Rafting with certified guides', 'Trip captain throughout'],
    days: [
      {
        day: 1, title: 'Jaipur to Rishikesh, Ganga aarti', place: 'Rishikesh',
        description: 'Pickup is very early in the morning for the long road day north through Delhi NCR and Haridwar, around ten to eleven hours with breakfast and lunch stops. As you leave Haridwar the Ganga appears beside the road and the first forested hills of the Himalayan foothills rise ahead. We check in at the riverside camp and freshen up, then head into town to Triveni Ghat in time for the evening Ganga aarti. Priests swing large brass lamps to chanting and bells while hundreds of small leaf-boat diyas float down the river. The group walks back to the bus through the busy ghat-side market for chai and snacks. Dinner is at camp, with a short safety talk about tomorrow\'s rafting before lights out.',
        activities: ['Early morning pickup', 'Drive to Rishikesh via Delhi NCR and Haridwar', 'Check in at the riverside camp', 'Evening Ganga aarti at Triveni Ghat', 'Chai and snacks in the ghat market', 'Dinner and rafting briefing at camp'],
        ...DAY_PHOTO('g06', 1, 'Evening Ganga aarti with brass lamps at Triveni Ghat, Rishikesh', IMG('rishikesh-river')),
        hotel: STAY('Riverside camp', 'Tents on twin/triple sharing near the river.'),
      },
      {
        day: 2, title: 'White-water rafting on the Ganga', place: 'Ganga, Rishikesh',
        description: 'After breakfast the group is driven upstream to the put-in point at Shivpuri, where certified river guides hand out helmets and life jackets and run a full safety briefing on paddling, commands and what to do if you fall in. The raft then runs roughly 16 km of the Ganga back towards Rishikesh through rapids with names like Roller Coaster and Golf Course, with calm stretches in between. Where the water is gentle and the guide gives the go-ahead, you can jump in and float with the current, and there is an optional cliff-jump stop. The trip ends near the town ghats, and after a late lunch the afternoon is free at camp for beach volleyball on the river sand or a nap in the hammocks. As it gets dark the group gathers round a bonfire for music, games and dinner under the stars.',
        activities: ['Drive to the Shivpuri put-in point', 'Safety briefing with certified river guides', 'Rafting about 16 km through Grade II to III rapids', 'Body-surfing in calm water and optional cliff jump', 'Beach volleyball and free time at camp', 'Bonfire night with music and dinner'],
        ...DAY_PHOTO('g06', 2, 'Rafters paddling through white water on the Ganga near Shivpuri, Rishikesh', IMG('rishikesh-river')),
        hotel: STAY('Riverside camp', 'Same riverside camp.'),
      },
      {
        day: 3, title: 'Beatles Ashram, Tapovan cafés and home', place: 'Rishikesh to Jaipur',
        description: 'After breakfast and checkout, the group heads to the Beatles Ashram (Chaurasi Kutia), the forest ashram where the band stayed in 1968, now full of colourful murals and graffiti inside the old meditation huts. We then walk along the river past Ram Jhula and the Laxman Jhula area, with temples, bookshops and sadhus along the ghats. Brunch is in one of the Tapovan cafés with a view over the river, with time to pick up rudraksha beads, Tibetan singing bowls or a yoga mat bag. By early afternoon the bus starts the drive back south, with a dinner stop on the highway. Drop back at your pickup point late at night.',
        activities: ['Breakfast and checkout', 'Murals and meditation huts at the Beatles Ashram (Chaurasi Kutia)', 'Riverside walk past Ram Jhula and the Laxman Jhula area', 'Café brunch in Tapovan', 'Drive back to Jaipur with a dinner stop'],
        ...DAY_PHOTO('g06', 3, 'Painted meditation huts at the Beatles Ashram (Chaurasi Kutia), Rishikesh', IMG('rishikesh-river')),
        hotel: null,
      },
    ],
  },
};

/** Adds the schema fields (see top of file) to a legacy-shaped trip. Used for seeds and owner trips. */
export function withTripSchema(t, plan = {}) {
  const days = plan.days || t.days || [];
  return {
    ...t,
    price: t.price ?? t.budgetPerPerson,
    dates: t.dates || (t.date ? [t.date] : []),
    seats: t.seats ?? t.seatsTotal,
    coverImage: t.coverImage || t.image,
    coverAlt: t.coverAlt || t.imageAlt || '',
    summary: t.summary || t.blurb || '',
    inclusions: plan.inclusions || t.inclusions || [],
    days,
    durationLabel: t.durationLabel || (days.length ? `${days.length} ${days.length === 1 ? 'day' : 'days'}` : ''),
  };
}

/* Short "at a glance" version of each seed day for the itinerary timeline (itinerary.js):
 * short = 1-3 word day title, points = 2-3 short lines, morePhotos = extra photos shown next to
 * the day photo (small copy from /assets/images/itinerary/, full size for the photo viewer). Optional fields: owner trips
 * without them fall back to the day title and first activities. */
const MORE_PHOTOS = {
  'jaipur-amer-fort': ['/assets/images/trip-jaipur-amer-fort.jpg', 'A fort on a hillside above a lake in Rajasthan, walls reflected in the water'],
  'jaisalmer-camel-cart': [IMG('jaisalmer-camel-cart-natural'), 'A camel cart on a sandy road in Rajasthan'],
  'kedarkantha-hikers': [IMG('kedarkantha-hikers'), 'Hikers climbing a snow-covered trail in Uttarakhand'],
  'himalaya-peaks': [IMG('himalaya-peaks'), 'Trekkers on a snow-covered ridge with Himalayan peaks behind'],
  'kedarkantha-summit-sunrise': [IMG('kedarkantha-summit-sunrise'), 'Sunrise light on the summit ridge of Kedarkantha in Uttarakhand'],
  'kedarkantha-summit': ['/assets/images/trip-kedarkantha-summit.jpg', 'Snowy ridge and pine forest below a Himalayan peak on the Kedarkantha trek'],
  'jaisalmer-fort': ['/assets/images/trip-jaisalmer-fort.jpg', 'Golden sandstone Jaisalmer Fort above the old city at sunset'],
  'desert-dunes': [IMG('desert-dunes'), 'Camel riders crossing pale sand dunes near Jaisalmer'],
  'jaisalmer-dunes': [IMG('jaisalmer-dunes-daylight'), 'Sand dunes near Jaisalmer in daylight'],
  'lake-city': [IMG('lake-city'), 'A red boat with passengers on Lake Pichola in Udaipur'],
  'udaipur-city-palace': ['/assets/images/trip-udaipur-city-palace.jpg', 'City Palace and old-city ghats along Lake Pichola in Udaipur'],
  'rishikesh-river': [IMG('rishikesh-river'), 'Two rafters paddling the Ganga through a rocky gorge near Rishikesh'],
};
const SNAP = (short, points, more = []) => ({
  short,
  points,
  morePhotos: more.map((k) => ({ thumb: `/assets/images/itinerary/${k}.jpg`, src: MORE_PHOTOS[k][0], alt: MORE_PHOTOS[k][1] })),
});
const SEED_SNAPSHOTS = {
  g01: [SNAP('Jaipur forts', ['Amer Fort at sunrise', 'Panna Meena stepwell', 'Nahargarh sunset'], ['jaipur-amer-fort'])],
  g02: [
    SNAP('Pushkar', ['Drive via Ajmer', 'Brahma Temple', 'Lakeside evening aarti'], ['jaisalmer-camel-cart']),
    SNAP('Savitri hill', ['Sunrise on the ghats', 'Cafés and bazaar lanes', 'Hilltop sunset, drive home']),
  ],
  g03: [
    SNAP('Night journey', ['Evening pickup', 'Gear check and briefing', 'Overnight to Dehradun']),
    SNAP('Tons valley', ['Drive via Mussoorie', 'Riverside dhaba lunch', 'Evening in Sankri']),
    SNAP('Frozen lake', ['Forest trail, about 4 km', 'Camp at Juda-ka-Talab', 'Stargazing'], ['kedarkantha-hikers']),
    SNAP('Base camp', ['Snowfields at 3,400 m', 'Peaks at sunset', 'Summit briefing'], ['himalaya-peaks']),
    SNAP('Summit', ['Pre-dawn climb', 'Sunrise at 3,800 m', 'Down to Hargaon'], ['kedarkantha-summit-sunrise']),
    SNAP('Homeward', ['Descent to Sankri', 'Trek certificates', 'Overnight to Jaipur'], ['kedarkantha-summit']),
  ],
  g04: [
    SNAP('Into the desert', ['Evening pickup', 'Trip briefing', 'Overnight via Jodhpur'], ['jaisalmer-camel-cart']),
    SNAP('Golden fort', ['Sonar Quila walk', 'Patwon ki Haveli', 'Gadisar Lake sunset'], ['jaisalmer-fort']),
    SNAP('Sam dunes', ['Bada Bagh and Kuldhara', 'Camel safari at sunset', 'Campfire and folk music'], ['desert-dunes']),
    SNAP('Desert sunrise', ['Sunrise on the dunes', 'Last stroll in town', 'Overnight to Jaipur'], ['jaisalmer-dunes']),
  ],
  g05: [
    SNAP('Lake Pichola', ['Drive from Jaipur', 'Boat ride on Pichola', 'Ambrai Ghat sunset'], ['lake-city']),
    SNAP('Old city', ['City Palace, Jagdish Temple', 'Gangaur Ghat golden hour', 'Dharohar folk show'], ['udaipur-city-palace']),
    SNAP('Fateh Sagar', ['Lakeside morning walk', 'Saheliyon ki Bari', 'Drive home']),
  ],
  g06: [
    SNAP('Ganga aarti', ['Drive via Haridwar', 'Riverside camp', 'Aarti at Triveni Ghat'], ['rishikesh-river']),
    SNAP('Rafting', ['16 km of rapids', 'Optional cliff jump', 'Bonfire night']),
    SNAP('Beatles Ashram', ['Ashram murals', 'Tapovan café brunch', 'Drive home']),
  ],
};
const withSnapshots = (id, plan) => (plan && SEED_SNAPSHOTS[id]
  ? { ...plan, days: plan.days.map((d, i) => ({ ...d, ...SEED_SNAPSHOTS[id][i], thumb: d.image.replace(/\.jpg$/, '-sm.jpg') })) }
  : plan);

export const GROUP_TRIPS = GROUP_SEEDS.map((t) => withTripSchema(t, withSnapshots(t.id, SEED_PLANS[t.id])));

export const getPickupPoint = (id) => PICKUP_POINTS.find((p) => p.id === id) || null;
export const isValidPickup = (id) => PICKUP_POINTS.some((p) => p.id === id);
export const groupSeatsLeft = (t) => Math.max(0, t.seatsTotal - t.membersJoined);
export const groupFilledPercent = (t) => (t.seatsTotal > 0 ? Math.min(100, Math.round((t.membersJoined / t.seatsTotal) * 100)) : 0);

export const getTripById = (id) => TRIPS.find((t) => t.id === id) || null;
export const getTripBySlug = (slug) => TRIPS.find((t) => t.slug === slug) || null;
export const getDestinations = () => [...new Set(TRIPS.map((t) => t.destination))].sort();
