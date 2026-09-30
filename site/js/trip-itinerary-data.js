/**
 * Day-by-day itinerary content for the trip detail page (trip.html), one entry per trip in data.js.
 * Rendered by trip-itinerary.js.
 *
 * ITINERARY[tripId] = {
 *   intro:  string,      // one or two sentences about the trip, shown left of the timeline
 *   covers: string[],    // places, shown as "You'll cover: ..."
 *   days: [{ day, title, summary: string[1-3 short lines], images: [{ k, alt, pos? }] }]
 * }
 * Day titles and order follow TRIPS[].itinerary in data.js.
 * Thumbnails are small copies of existing site photos (assets/images/itinerary/). They show the
 * region, not the exact stop, so alt text describes the photo itself.
 * TODO(owner): replace with real photos from past batches when available.
 */

const T = '/assets/images/itinerary/';

/** Photo library: key -> file and alt text. */
const PHOTOS = {
  'kedarkantha-summit-sunrise': ['Sunrise light on the summit ridge of Kedarkantha in Uttarakhand'],
  'kedarkantha-summit': ['Snowy ridge and pine forest below a Himalayan peak on the Kedarkantha trek'],
  'himalaya-peaks': ['Trekkers on a snow-covered ridge with Himalayan peaks behind'],
  'kedarkantha-hikers': ['Hikers climbing a snow-covered trail in Uttarakhand'],
  'triund-trekkers': ['Two trekkers with packs on the stone trail to Triund, Himachal Pradesh'],
  'trek-trail': ['Trekkers climbing a stone mountain trail near Dharamshala'],
  'jaisalmer-dunes': ['Sand dunes near Jaisalmer in daylight'],
  'jaisalmer-fort': ['Golden sandstone Jaisalmer Fort above the old city at sunset'],
  'desert-dunes': ['Camel riders crossing pale sand dunes near Jaisalmer'],
  'jaisalmer-camel-cart': ['A camel cart on a sandy road in Rajasthan'],
  'lake-city': ['A red boat with passengers on Lake Pichola in Udaipur'],
  'udaipur-city-palace': ['City Palace and old-city ghats along Lake Pichola in Udaipur'],
  'jaipur-amer-fort': ['A fort on a hillside above a lake in Rajasthan, walls reflected in the water'],
  'green-valley': ['A river flowing between forested mountain slopes in Himachal Pradesh'],
  backwaters: ['Travellers aboard a houseboat on the Alleppey backwaters in Kerala'],
  coast: ['People sitting in shallow water at Om Beach in Gokarna'],
  'goa-palm-cove': ['Travellers walking along palm-lined Palolem Beach in Goa'],
  'monastery-ridge': ['Key Monastery on its barren hillside above the Spiti Valley'],
  'ladakh-riders': ['Motorcyclists on a mountain road in Ladakh'],
  'ladakh-high-pass': ['Motorcyclists beneath a high-pass sign and prayer flags in Ladakh'],
  'meghalaya-root-bridge': ['Visitors beneath a double-decker living root bridge in Meghalaya'],
  'rishikesh-river': ['Two rafters paddling the Ganga through a rocky gorge near Rishikesh'],
};

/** im('lake-city', '30% 50%') -> image entry; pos is the object-position crop. */
const im = (k, pos = '50% 50%') => ({ src: `${T}${k}.jpg`, alt: PHOTOS[k][0], pos });

export const ITINERARY = {
  t01: {
    intro: 'Six days from Dehradun to a snowy summit sunrise. The trail climbs through pine and oak to a frozen lake camp, then opens into meadows below the Kedarkantha ridge.',
    covers: ['Sankri', 'Juda-ka-Talab', 'Kedarkantha base camp', 'Hargaon'],
    days: [
      { day: 1, title: 'Dehradun to Sankri', summary: ['Scenic drive along the Yamuna and Tons valleys', 'Evening briefing and gear check'], images: [im('kedarkantha-summit', '20% 50%'), im('green-valley', '60% 40%')] },
      { day: 2, title: 'Sankri to Juda-ka-Talab', summary: ['Forest climb through pine and oak', 'Camp beside a frozen lake'], images: [im('kedarkantha-hikers', '50% 30%'), im('kedarkantha-summit', '80% 60%')] },
      { day: 3, title: 'Juda-ka-Talab to base camp', summary: ['Open meadows on the way up', 'First full view of the summit ridge'], images: [im('himalaya-peaks', '30% 40%'), im('kedarkantha-summit-sunrise', '70% 50%'), im('kedarkantha-hikers', '50% 75%')] },
      { day: 4, title: 'Summit day', summary: ['Pre-dawn start for the summit', 'Sunrise from the top, then down to Hargaon camp'], images: [im('kedarkantha-summit-sunrise', '50% 40%'), im('himalaya-peaks', '75% 45%')] },
      { day: 5, title: 'Hargaon to Sankri', summary: ['Easy descent through the forest', 'Celebration dinner with the group'], images: [im('green-valley', '30% 50%'), im('kedarkantha-summit', '55% 30%')] },
      { day: 6, title: 'Sankri to Dehradun', summary: ['Drive back down the valley', 'Drop at Dehradun by evening'], images: [im('green-valley', '75% 60%'), im('kedarkantha-hikers', '50% 55%')] },
    ],
  },
  t02: {
    intro: 'A gentle trek trip: McLeodganj cafés and monasteries first, then a ridge-top camp at Triund with the Dhauladhar at eye level.',
    covers: ['McLeodganj', 'Bhagsu', 'Triund'],
    days: [
      { day: 1, title: 'Overnight Volvo from Delhi', summary: ['Meet the group at the pickup point', 'Overnight bus, playlists loaded'], images: [im('green-valley', '40% 50%'), im('trek-trail', '50% 30%')] },
      { day: 2, title: 'McLeodganj arrival', summary: ['Check in and the Tsuglagkhang walk', 'Bhagsu waterfall and a café crawl'], images: [im('triund-trekkers', '50% 30%'), im('green-valley', '70% 35%'), im('trek-trail', '50% 70%')] },
      { day: 3, title: 'Trek to Triund', summary: ['Steady 9 km climb to the ridge', 'Bonfire and stargazing at camp'], images: [im('triund-trekkers', '50% 60%'), im('trek-trail', '50% 45%'), im('himalaya-peaks', '60% 40%')] },
      { day: 4, title: 'Sunrise and descent', summary: ['Sunrise over the Dhauladhar', 'Descend, then a free evening in town'], images: [im('himalaya-peaks', '20% 45%'), im('triund-trekkers', '50% 80%')] },
      { day: 5, title: 'Return', summary: ['Overnight bus back to Delhi'], images: [im('trek-trail', '50% 85%'), im('green-valley', '20% 60%')] },
    ],
  },
  t03: {
    intro: 'Five days in the Golden City: a living sandstone fort, old havelis and a night in a dune camp under the stars.',
    covers: ['Gadisar Lake', 'Jaisalmer Fort', 'Kuldhara', 'Sam dunes'],
    days: [
      { day: 1, title: 'Arrive Jaisalmer', summary: ['Check in and settle the group', 'Evening at Gadisar Lake'], images: [im('jaisalmer-fort', '30% 50%'), im('jaisalmer-camel-cart', '50% 40%')] },
      { day: 2, title: 'Golden fort and havelis', summary: ['Walk inside the living fort', 'Patwon ki Haveli and the old bazaar'], images: [im('jaisalmer-fort', '60% 40%'), im('jaisalmer-camel-cart', '50% 70%'), im('jaisalmer-dunes', '30% 50%')] },
      { day: 3, title: 'To the dunes', summary: ['Kuldhara ruins, then a sunset dune safari', 'Camp night with music'], images: [im('desert-dunes', '50% 50%'), im('jaisalmer-dunes', '75% 55%'), im('desert-dunes', '15% 60%')] },
      { day: 4, title: 'Desert morning', summary: ['Sunrise on the dunes', 'Free afternoon and a rooftop farewell dinner'], images: [im('jaisalmer-dunes', '50% 40%'), im('jaisalmer-fort', '80% 35%')] },
      { day: 5, title: 'Departure', summary: ['Checkout after breakfast'], images: [im('jaisalmer-camel-cart', '50% 20%'), im('desert-dunes', '85% 50%')] },
    ],
  },
  t04: {
    intro: 'Lakes, palaces and old-city lanes at an easy pace, with a day trip to the great wall of Kumbhalgarh.',
    covers: ['Ambrai Ghat', 'City Palace', 'Kumbhalgarh', 'Sajjangarh'],
    days: [
      { day: 1, title: 'Arrive Udaipur', summary: ['Check in to a lake-view stay', 'Sunset at Ambrai Ghat'], images: [im('lake-city', '30% 50%'), im('udaipur-city-palace', '20% 50%')] },
      { day: 2, title: 'City Palace and old city', summary: ['City Palace and Jagdish Temple', 'Bagore ki Haveli dance show'], images: [im('udaipur-city-palace', '60% 50%'), im('jaipur-amer-fort', '30% 50%'), im('lake-city', '80% 40%')] },
      { day: 3, title: 'Kumbhalgarh day trip', summary: ['Walk the great wall of the fort', 'Back in Udaipur by evening'], images: [im('jaipur-amer-fort', '55% 40%'), im('green-valley', '50% 50%')] },
      { day: 4, title: 'Lakes and hills', summary: ['Boat ride on the lake', 'Sajjangarh sunset point and rooftop farewell dinner'], images: [im('lake-city', '50% 60%'), im('udaipur-city-palace', '85% 40%'), im('jaipur-amer-fort', '85% 60%')] },
      { day: 5, title: 'Departure', summary: ['Checkout after breakfast'], images: [im('udaipur-city-palace', '40% 70%'), im('lake-city', '10% 50%')] },
    ],
  },
  t05: {
    intro: 'River camps, forest villages and slow mornings in the Parvati Valley, with a trek up to the Kheerganga hot springs.',
    covers: ['Kasol', 'Tosh', 'Pulga', 'Kheerganga', 'Manikaran'],
    days: [
      { day: 1, title: 'Overnight bus from Delhi', summary: ['Meet the group and depart'], images: [im('green-valley', '20% 50%'), im('trek-trail', '50% 35%')] },
      { day: 2, title: 'Kasol', summary: ['Check in and settle by the river', 'Chalal village walk along the Parvati'], images: [im('green-valley', '50% 50%'), im('trek-trail', '50% 65%')] },
      { day: 3, title: 'Tosh and Pulga', summary: ['Village hopping through the valley', 'Waterfall walk'], images: [im('green-valley', '80% 40%'), im('himalaya-peaks', '35% 40%'), im('trek-trail', '50% 20%')] },
      { day: 4, title: 'Kheerganga trek', summary: ['Forest trek up to the hot springs', 'Camp for the night'], images: [im('trek-trail', '50% 50%'), im('himalaya-peaks', '70% 50%')] },
      { day: 5, title: 'Descent and Manikaran', summary: ['Return trek down the valley', 'Gurudwara visit and hot springs'], images: [im('green-valley', '65% 65%'), im('trek-trail', '50% 80%')] },
      { day: 6, title: 'Return', summary: ['Overnight bus back to Delhi'], images: [im('green-valley', '10% 40%'), im('himalaya-peaks', '90% 40%')] },
    ],
  },
  t06: {
    intro: 'Six slow days in Kerala: Fort Kochi, the tea hills of Munnar and a night drifting through the Alleppey canals on a private houseboat.',
    covers: ['Fort Kochi', 'Munnar', 'Alleppey', 'Marari beach'],
    days: [
      { day: 1, title: 'Arrive Kochi', summary: ['Fort Kochi walk', 'Chinese fishing nets at sunset'], images: [im('backwaters', '85% 50%'), im('coast', '30% 50%')] },
      { day: 2, title: 'Kochi to Munnar', summary: ['Drive into the tea hills', 'Waterfall stops on the way'], images: [im('green-valley', '40% 50%'), im('backwaters', '20% 50%')] },
      { day: 3, title: 'Munnar', summary: ['Tea estate visit', 'Top Station viewpoint and a spice garden'], images: [im('green-valley', '70% 60%'), im('green-valley', '20% 30%'), im('backwaters', '50% 30%')] },
      { day: 4, title: 'Munnar to Alleppey', summary: ['Board the houseboat', 'Drift through the canals overnight'], images: [im('backwaters', '84% 50%'), im('backwaters', '40% 60%')] },
      { day: 5, title: 'Marari beach', summary: ['Village canoe ride in the morning', 'Beach afternoon'], images: [im('coast', '50% 60%'), im('backwaters', '10% 40%')] },
      { day: 6, title: 'Departure', summary: ['Drop at Kochi'], images: [im('backwaters', '60% 80%'), im('coast', '85% 40%')] },
    ],
  },
  t07: {
    intro: 'Beach-to-beach hikes along the Gokarna coast, cliffside sunsets and a morning on the water in a kayak.',
    covers: ['Gokarna town', 'Kudle', 'Om Beach', 'Half Moon', 'Paradise'],
    days: [
      { day: 1, title: 'Overnight from Bengaluru', summary: ['Meet the group and depart'], images: [im('coast', '20% 50%'), im('green-valley', '50% 50%')] },
      { day: 2, title: 'Gokarna town', summary: ['Temple town walk', 'Kudle beach sunset'], images: [im('coast', '50% 50%'), im('goa-palm-cove', '30% 50%')] },
      { day: 3, title: 'Beach trek', summary: ['Kudle to Om on foot', 'Half Moon and Paradise beach'], images: [im('coast', '80% 40%'), im('goa-palm-cove', '70% 60%'), im('backwaters', '30% 50%')] },
      { day: 4, title: 'Kayak and chill', summary: ['Morning kayak', 'Free afternoon and a bonfire dinner'], images: [im('goa-palm-cove', '50% 40%'), im('coast', '40% 75%')] },
      { day: 5, title: 'Return', summary: ['Overnight back to Bengaluru'], images: [im('coast', '10% 30%'), im('goa-palm-cove', '90% 50%')] },
    ],
  },
  t08: {
    intro: 'A seven-day circuit through the high-desert valley of Spiti, with cliff monasteries, the highest villages and a sky full of stars.',
    covers: ['Manali', 'Kaza', 'Key', 'Kibber', 'Langza', 'Dhankar', 'Tabo'],
    days: [
      { day: 1, title: 'Manali', summary: ['Arrive and acclimatise', 'Trip briefing'], images: [im('himalaya-peaks', '40% 45%'), im('green-valley', '60% 50%')] },
      { day: 2, title: 'Manali to Kaza', summary: ['Over Kunzum pass', 'Chandratal viewpoint on the way'], images: [im('ladakh-riders', '40% 50%'), im('monastery-ridge', '20% 40%'), im('himalaya-peaks', '80% 40%')] },
      { day: 3, title: 'Key and Kibber', summary: ['Key monastery and the Chicham bridge', 'Kibber village'], images: [im('monastery-ridge', '55% 40%'), im('ladakh-riders', '80% 50%')] },
      { day: 4, title: 'Langza, Hikkim, Komic', summary: ['Fossil village', 'The highest post office and a Buddha statue'], images: [im('monastery-ridge', '80% 60%'), im('himalaya-peaks', '20% 50%')] },
      { day: 5, title: 'Dhankar and Tabo', summary: ['Cliff monastery at Dhankar', 'The ancient Tabo caves'], images: [im('monastery-ridge', '30% 30%'), im('ladakh-high-pass', '50% 50%'), im('ladakh-riders', '15% 60%')] },
      { day: 6, title: 'Back towards Manali', summary: ['Return drive', 'Chandratal lake stop if roads allow'], images: [im('ladakh-riders', '60% 40%'), im('green-valley', '30% 40%')] },
      { day: 7, title: 'Departure', summary: ['Checkout in Manali'], images: [im('himalaya-peaks', '90% 50%'), im('monastery-ridge', '50% 80%')] },
    ],
  },
  t09: {
    intro: 'Living root bridges, blue pools and waterfalls in the clouds: six days across the Khasi Hills, with a local guide for the Nongriat trek.',
    covers: ['Shillong', 'Cherrapunji', 'Nongriat', 'Dawki', 'Mawlynnong'],
    days: [
      { day: 1, title: 'Guwahati to Shillong', summary: ['Umiam lake on the way', 'Evening at Police Bazaar'], images: [im('green-valley', '30% 50%'), im('meghalaya-root-bridge', '20% 40%')] },
      { day: 2, title: 'Shillong to Cherrapunji', summary: ['Waterfalls along the road', 'Mawsmai caves'], images: [im('meghalaya-root-bridge', '80% 60%'), im('green-valley', '70% 50%')] },
      { day: 3, title: 'Root bridge trek', summary: ['Steps down to Nongriat', 'Double-decker bridge and Rainbow falls'], images: [im('meghalaya-root-bridge', '50% 50%'), im('meghalaya-root-bridge', '25% 75%'), im('green-valley', '50% 30%')] },
      { day: 4, title: 'Dawki and Shnongpang', summary: ['Boating on the clear-water river', 'Village stay'], images: [im('backwaters', '60% 50%'), im('meghalaya-root-bridge', '90% 40%')] },
      { day: 5, title: 'Mawlynnong', summary: ['The clean village and the sky view', 'Back to Shillong'], images: [im('green-valley', '15% 60%'), im('meghalaya-root-bridge', '55% 20%')] },
      { day: 6, title: 'Departure', summary: ['Drop at Guwahati'], images: [im('green-valley', '90% 50%'), im('backwaters', '20% 40%')] },
    ],
  },
  t10: {
    intro: 'A quiet South Goa: Palolem sunsets, boat trips to hidden coves, the Latin quarter of Fontainhas and a day on scooters.',
    covers: ['Palolem', 'Butterfly beach', 'Old Goa', 'Fontainhas', 'Panjim'],
    days: [
      { day: 1, title: 'Arrive South Goa', summary: ['Check in near Palolem', 'Sunset on the beach'], images: [im('goa-palm-cove', '50% 50%'), im('coast', '60% 50%')] },
      { day: 2, title: 'Island hopping', summary: ['Butterfly beach boat trip', 'Cabo de Rama fort'], images: [im('coast', '30% 40%'), im('goa-palm-cove', '20% 60%'), im('backwaters', '50% 40%')] },
      { day: 3, title: 'Old Goa and Fontainhas', summary: ['Churches of Old Goa', 'Latin quarter walk and a Panjim evening'], images: [im('goa-palm-cove', '85% 40%'), im('coast', '50% 30%')] },
      { day: 4, title: 'Scooter day', summary: ['Hidden beaches of the south', 'Farewell dinner'], images: [im('coast', '75% 70%'), im('goa-palm-cove', '40% 30%')] },
      { day: 5, title: 'Departure', summary: ['Drop at Madgaon'], images: [im('goa-palm-cove', '10% 50%'), im('coast', '50% 20%')] },
    ],
  },
  t11: {
    intro: 'Seven days over the highest roads in India: Khardung La, the Nubra dunes and a lakeside camp at Pangong, with a full rest day first for altitude.',
    covers: ['Leh', 'Khardung La', 'Hunder', 'Pangong', 'Chang La', 'Hemis'],
    days: [
      { day: 1, title: 'Arrive Leh', summary: ['Full rest day to acclimatise'], images: [im('himalaya-peaks', '30% 40%'), im('monastery-ridge', '60% 40%')] },
      { day: 2, title: 'Leh local', summary: ['Shanti Stupa and Leh palace', 'Hall of Fame'], images: [im('monastery-ridge', '40% 50%'), im('ladakh-riders', '20% 50%')] },
      { day: 3, title: 'Leh to Nubra', summary: ['Over Khardung La', 'Hunder dunes by evening'], images: [im('ladakh-high-pass', '50% 50%'), im('ladakh-riders', '30% 60%'), im('ladakh-riders', '70% 50%')] },
      { day: 4, title: 'Nubra to Pangong', summary: ['Shyok river road to the lake', 'Lakeside camp'], images: [im('ladakh-riders', '50% 50%'), im('himalaya-peaks', '80% 40%')] },
      { day: 5, title: 'Pangong to Leh', summary: ['Sunrise at the lake', 'Back over Chang La'], images: [im('himalaya-peaks', '50% 30%'), im('ladakh-high-pass', '20% 40%')] },
      { day: 6, title: 'Monasteries', summary: ['Thiksey and Hemis', 'A free evening in the market'], images: [im('monastery-ridge', '70% 50%'), im('ladakh-high-pass', '80% 50%')] },
      { day: 7, title: 'Departure', summary: ['Drop at Leh airport'], images: [im('ladakh-riders', '90% 40%'), im('monastery-ridge', '20% 70%')] },
    ],
  },
  t12: {
    intro: 'White water first, then riverside camps: 16 km of rafting on the Ganga, a waterfall hike and slow evenings in Rishikesh.',
    covers: ['Triveni Ghat', 'Ganga rapids', 'Neer Garh waterfall', 'Tapovan'],
    days: [
      { day: 1, title: 'Delhi to Rishikesh', summary: ['Drive up to the foothills', 'Ganga aarti at Triveni Ghat'], images: [im('rishikesh-river', '30% 50%'), im('green-valley', '50% 50%')] },
      { day: 2, title: 'Rafting day', summary: ['Rafting on the Ganga with a cliff jump', 'Move to the river camp'], images: [im('rishikesh-river', '55% 50%'), im('rishikesh-river', '85% 40%'), im('green-valley', '20% 40%')] },
      { day: 3, title: 'Waterfall hike', summary: ['Neer Garh waterfall hike', 'Café evening in Tapovan'], images: [im('green-valley', '60% 50%'), im('rishikesh-river', '20% 60%')] },
      { day: 4, title: 'Beatles ashram and yoga', summary: ['Morning yoga and an ashram visit', 'Farewell bonfire'], images: [im('himalaya-peaks', '50% 40%'), im('rishikesh-river', '70% 30%')] },
      { day: 5, title: 'Return', summary: ['Drive back to Delhi'], images: [im('rishikesh-river', '10% 50%'), im('green-valley', '85% 50%')] },
    ],
  },
};
