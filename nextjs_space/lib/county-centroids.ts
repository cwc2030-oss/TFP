/**
 * Static reference table of US county centroids.
 *
 * Used by the public listing detail page to render a low-zoom county-outline
 * map for an OPSEC-safe "where is this lease?" preview. We DO NOT pull
 * lat/lng from the source SavedProperty for this map — we use a county
 * centroid keyed by the listing\u2019s state + county strings.
 *
 * Coverage starts with Missouri (TFP\u2019s primary market) plus a sample of
 * neighboring states. Counties not in the table fall back to the state
 * centroid (defined as US_STATE_CENTROIDS below); if the state is also
 * missing the page omits the map entirely.
 *
 * Source: USGS / public domain county centroids, rounded to 4 decimal
 * places (~11 m). Values are intentionally low-precision — they are not
 * derived from any user data.
 */

export interface Centroid {
  lat: number;
  lng: number;
  precision: 'county' | 'state';
}

// Missouri (114 counties + St. Louis City). Subset — the rest fall back
// to the MO state centroid via stateCentroid().
export const MO_COUNTY_CENTROIDS: Record<string, Centroid> = {
  adair:       { lat: 40.1933, lng: -92.6065, precision: 'county' },
  andrew:      { lat: 39.9874, lng: -94.7973, precision: 'county' },
  atchison:    { lat: 40.4366, lng: -95.4366, precision: 'county' },
  audrain:     { lat: 39.2150, lng: -91.8420, precision: 'county' },
  barry:       { lat: 36.7053, lng: -93.8326, precision: 'county' },
  barton:      { lat: 37.5040, lng: -94.3469, precision: 'county' },
  bates:       { lat: 38.2604, lng: -94.3375, precision: 'county' },
  benton:      { lat: 38.2954, lng: -93.2935, precision: 'county' },
  bollinger:   { lat: 37.3252, lng: -90.0382, precision: 'county' },
  boone:       { lat: 38.9931, lng: -92.3168, precision: 'county' },
  buchanan:    { lat: 39.6586, lng: -94.7997, precision: 'county' },
  butler:      { lat: 36.6585, lng: -90.4084, precision: 'county' },
  caldwell:    { lat: 39.6586, lng: -93.9776, precision: 'county' },
  callaway:    { lat: 38.8388, lng: -91.9219, precision: 'county' },
  camden:      { lat: 38.0212, lng: -92.7591, precision: 'county' },
  'cape-girardeau': { lat: 37.3915, lng: -89.7575, precision: 'county' },
  carroll:     { lat: 39.4279, lng: -93.5043, precision: 'county' },
  carter:      { lat: 36.9433, lng: -91.0090, precision: 'county' },
  cass:        { lat: 38.6479, lng: -94.3543, precision: 'county' },
  cedar:       { lat: 37.7244, lng: -93.8580, precision: 'county' },
  chariton:    { lat: 39.5192, lng: -92.9586, precision: 'county' },
  christian:   { lat: 36.9698, lng: -93.1880, precision: 'county' },
  clark:       { lat: 40.4172, lng: -91.7409, precision: 'county' },
  clay:        { lat: 39.3120, lng: -94.4220, precision: 'county' },
  clinton:     { lat: 39.6017, lng: -94.4080, precision: 'county' },
  cole:        { lat: 38.5076, lng: -92.2780, precision: 'county' },
  cooper:      { lat: 38.8517, lng: -92.8154, precision: 'county' },
  crawford:    { lat: 37.9762, lng: -91.3015, precision: 'county' },
  dade:        { lat: 37.4324, lng: -93.8578, precision: 'county' },
  dallas:      { lat: 37.6796, lng: -92.9882, precision: 'county' },
  daviess:     { lat: 39.9591, lng: -93.9819, precision: 'county' },
  dekalb:      { lat: 39.8881, lng: -94.4084, precision: 'county' },
  dent:        { lat: 37.6087, lng: -91.5034, precision: 'county' },
  douglas:     { lat: 36.9356, lng: -92.4998, precision: 'county' },
  dunklin:     { lat: 36.1209, lng: -90.1717, precision: 'county' },
  franklin:    { lat: 38.4129, lng: -91.0731, precision: 'county' },
  gasconade:   { lat: 38.4406, lng: -91.5045, precision: 'county' },
  gentry:      { lat: 40.2125, lng: -94.4116, precision: 'county' },
  greene:      { lat: 37.2581, lng: -93.3433, precision: 'county' },
  grundy:      { lat: 40.1148, lng: -93.5634, precision: 'county' },
  harrison:    { lat: 40.3873, lng: -93.9924, precision: 'county' },
  henry:       { lat: 38.3835, lng: -93.7888, precision: 'county' },
  hickory:     { lat: 37.9424, lng: -93.3194, precision: 'county' },
  holt:        { lat: 40.0935, lng: -95.2104, precision: 'county' },
  howard:      { lat: 39.1442, lng: -92.6926, precision: 'county' },
  howell:      { lat: 36.7771, lng: -91.8842, precision: 'county' },
  iron:        { lat: 37.5269, lng: -90.7155, precision: 'county' },
  jackson:     { lat: 39.0103, lng: -94.3471, precision: 'county' },
  jasper:      { lat: 37.2049, lng: -94.3393, precision: 'county' },
  jefferson:   { lat: 38.2625, lng: -90.5398, precision: 'county' },
  johnson:     { lat: 38.7490, lng: -93.7997, precision: 'county' },
  knox:        { lat: 40.1290, lng: -92.1474, precision: 'county' },
  laclede:     { lat: 37.6580, lng: -92.5839, precision: 'county' },
  lafayette:   { lat: 39.0666, lng: -93.7843, precision: 'county' },
  lawrence:    { lat: 37.1098, lng: -93.8326, precision: 'county' },
  lewis:       { lat: 40.0945, lng: -91.7140, precision: 'county' },
  lincoln:     { lat: 39.0584, lng: -90.9617, precision: 'county' },
  linn:        { lat: 39.8753, lng: -93.0982, precision: 'county' },
  livingston:  { lat: 39.7825, lng: -93.5479, precision: 'county' },
  macon:       { lat: 39.8341, lng: -92.5615, precision: 'county' },
  madison:     { lat: 37.4789, lng: -90.3441, precision: 'county' },
  maries:      { lat: 38.1681, lng: -91.9314, precision: 'county' },
  marion:      { lat: 39.7889, lng: -91.6263, precision: 'county' },
  mcdonald:    { lat: 36.6294, lng: -94.3716, precision: 'county' },
  mercer:      { lat: 40.4276, lng: -93.5681, precision: 'county' },
  miller:      { lat: 38.2122, lng: -92.4304, precision: 'county' },
  mississippi: { lat: 36.8210, lng: -89.2780, precision: 'county' },
  moniteau:    { lat: 38.6385, lng: -92.5773, precision: 'county' },
  monroe:      { lat: 39.6420, lng: -92.0042, precision: 'county' },
  montgomery:  { lat: 38.9402, lng: -91.4720, precision: 'county' },
  morgan:      { lat: 38.4290, lng: -92.8866, precision: 'county' },
  'new-madrid': { lat: 36.5994, lng: -89.6553, precision: 'county' },
  newton:      { lat: 36.8870, lng: -94.3393, precision: 'county' },
  nodaway:     { lat: 40.3624, lng: -94.8867, precision: 'county' },
  oregon:      { lat: 36.6906, lng: -91.4040, precision: 'county' },
  osage:       { lat: 38.4598, lng: -91.7682, precision: 'county' },
  ozark:       { lat: 36.6386, lng: -92.4427, precision: 'county' },
  pemiscot:    { lat: 36.2167, lng: -89.7860, precision: 'county' },
  perry:       { lat: 37.7099, lng: -89.8325, precision: 'county' },
  pettis:      { lat: 38.7297, lng: -93.2832, precision: 'county' },
  phelps:      { lat: 37.8709, lng: -91.7993, precision: 'county' },
  pike:        { lat: 39.3380, lng: -91.1735, precision: 'county' },
  platte:      { lat: 39.3811, lng: -94.7727, precision: 'county' },
  polk:        { lat: 37.6166, lng: -93.4017, precision: 'county' },
  pulaski:     { lat: 37.8242, lng: -92.2068, precision: 'county' },
  putnam:      { lat: 40.4894, lng: -93.0149, precision: 'county' },
  ralls:       { lat: 39.5275, lng: -91.5339, precision: 'county' },
  randolph:    { lat: 39.4400, lng: -92.4986, precision: 'county' },
  ray:         { lat: 39.3554, lng: -93.9988, precision: 'county' },
  reynolds:    { lat: 37.3589, lng: -90.9563, precision: 'county' },
  ripley:      { lat: 36.6529, lng: -90.8784, precision: 'county' },
  saline:      { lat: 39.1389, lng: -93.2026, precision: 'county' },
  schuyler:    { lat: 40.4682, lng: -92.5215, precision: 'county' },
  scotland:    { lat: 40.4524, lng: -92.1473, precision: 'county' },
  scott:       { lat: 37.0556, lng: -89.5984, precision: 'county' },
  shannon:     { lat: 37.1625, lng: -91.4102, precision: 'county' },
  shelby:      { lat: 39.7937, lng: -92.0780, precision: 'county' },
  'st-charles': { lat: 38.7842, lng: -90.6833, precision: 'county' },
  'st-clair':  { lat: 38.0341, lng: -93.7864, precision: 'county' },
  'ste-genevieve': { lat: 37.8915, lng: -90.1789, precision: 'county' },
  'st-francois': { lat: 37.8075, lng: -90.4736, precision: 'county' },
  'st-louis':  { lat: 38.6359, lng: -90.4407, precision: 'county' },
  'st-louis-city': { lat: 38.6357, lng: -90.2446, precision: 'county' },
  stoddard:    { lat: 36.8428, lng: -89.9483, precision: 'county' },
  stone:       { lat: 36.7536, lng: -93.4666, precision: 'county' },
  sullivan:    { lat: 40.2087, lng: -93.1131, precision: 'county' },
  taney:       { lat: 36.6534, lng: -93.0421, precision: 'county' },
  texas:       { lat: 37.3145, lng: -91.9648, precision: 'county' },
  vernon:      { lat: 37.8528, lng: -94.3398, precision: 'county' },
  warren:      { lat: 38.7674, lng: -91.1610, precision: 'county' },
  washington:  { lat: 37.9779, lng: -90.8862, precision: 'county' },
  wayne:       { lat: 37.1142, lng: -90.4659, precision: 'county' },
  webster:     { lat: 37.2784, lng: -92.8775, precision: 'county' },
  worth:       { lat: 40.4791, lng: -94.4225, precision: 'county' },
  wright:      { lat: 37.2752, lng: -92.4686, precision: 'county' },
};

// State centroid fallbacks. If neither county-level nor state-level data is
// available, the public detail page omits the map block entirely.
export const US_STATE_CENTROIDS: Record<string, Centroid> = {
  MO: { lat: 38.4561, lng: -92.2884, precision: 'state' },
  KS: { lat: 38.5266, lng: -96.7265, precision: 'state' },
  IA: { lat: 42.0115, lng: -93.2105, precision: 'state' },
  IL: { lat: 40.3495, lng: -88.9861, precision: 'state' },
  AR: { lat: 34.9697, lng: -92.3731, precision: 'state' },
  OK: { lat: 35.5653, lng: -96.9289, precision: 'state' },
  TN: { lat: 35.7478, lng: -86.6923, precision: 'state' },
  KY: { lat: 37.6681, lng: -84.6701, precision: 'state' },
  NE: { lat: 41.1254, lng: -98.2681, precision: 'state' },
  TX: { lat: 31.0545, lng: -97.5635, precision: 'state' },
  WI: { lat: 44.2685, lng: -89.6165, precision: 'state' },
  MN: { lat: 45.6945, lng: -93.9002, precision: 'state' },
  IN: { lat: 39.8494, lng: -86.2583, precision: 'state' },
  OH: { lat: 40.3888, lng: -82.7649, precision: 'state' },
  PA: { lat: 40.5908, lng: -77.2098, precision: 'state' },
  NY: { lat: 42.1657, lng: -74.9481, precision: 'state' },
  MI: { lat: 43.3266, lng: -84.5361, precision: 'state' },
};

function normalizeCounty(c: string): string {
  return c.toLowerCase().trim().replace(/\s+county$/, '').replace(/[^a-z0-9]+/g, '-');
}

/**
 * Look up a county centroid. Returns the county centroid if known,
 * otherwise falls back to the state centroid, otherwise null.
 */
export function lookupCentroid(state: string | null, county: string | null): Centroid | null {
  if (!state) return null;
  const stateUpper = state.toUpperCase().trim();
  if (stateUpper === 'MO' && county) {
    const key = normalizeCounty(county);
    if (key in MO_COUNTY_CENTROIDS) return MO_COUNTY_CENTROIDS[key];
  }
  if (stateUpper in US_STATE_CENTROIDS) return US_STATE_CENTROIDS[stateUpper];
  return null;
}
