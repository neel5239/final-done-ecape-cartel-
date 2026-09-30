#!/bin/bash
# Builds small (480px longest side) JPEG thumbnails for the day-by-day itinerary from existing site photos.
# Run from the project root: bash scripts/make-itinerary-thumbs.sh
set -e
IMG="site/assets/images"
OUT="$IMG/itinerary"
mkdir -p "$OUT"
while read -r key src; do
  sips -Z 480 -s format jpeg -s formatOptions 70 "$IMG/$src" --out "$OUT/$key.jpg" >/dev/null
done <<'LIST'
kedarkantha-summit-sunrise places/kedarkantha-summit-sunrise.jpg
kedarkantha-summit trip-kedarkantha-summit.jpg
himalaya-peaks places/himalaya-peaks.jpg
kedarkantha-hikers places/kedarkantha-hikers-natural.jpg
triund-trekkers places/triund-trekkers-natural.jpg
trek-trail places/trek-trail.jpg
jaisalmer-dunes places/jaisalmer-dunes-daylight.jpg
jaisalmer-fort trip-jaisalmer-fort.jpg
desert-dunes places/desert-dunes.jpg
jaisalmer-camel-cart places/jaisalmer-camel-cart-natural.jpg
lake-city places/lake-city.jpg
udaipur-city-palace trip-udaipur-city-palace.jpg
jaipur-amer-fort trip-jaipur-amer-fort.jpg
green-valley places/green-valley.jpg
backwaters places/backwaters.jpg
coast places/coast.jpg
goa-palm-cove places/goa-palm-cove.jpg
monastery-ridge places/monastery-ridge.jpg
ladakh-riders places/ladakh-mountain-road-riders.jpg
ladakh-high-pass places/ladakh-high-pass.jpg
meghalaya-root-bridge places/meghalaya-root-bridge.jpg
rishikesh-river places/rishikesh-river.jpg
LIST
ls -la "$OUT"
