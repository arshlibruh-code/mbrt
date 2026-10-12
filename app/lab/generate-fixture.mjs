import * as turf from '@turf/turf';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
try { await access(root + 'fixture.json'); throw new Error('Fixture already frozen. Remove it explicitly to regenerate.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
await mkdir(root + 'sources', { recursive: true });
let last = 0;
const provenance = [];
async function request(name, url, body) {
  const cache = root + 'sources/' + name + '.json';
  try {
    const stored = JSON.parse(await readFile(cache, 'utf8'));
    if(stored.provenance.url !== url || JSON.stringify(stored.provenance.body) !== JSON.stringify(body)) throw Object.assign(new Error('Request changed'), {code:'ENOENT'});
    provenance.push(stored.provenance);
    console.log('cached', name);
    return stored.data;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await new Promise(r => setTimeout(r, Math.max(0, last + 1100 - Date.now())));
  last = Date.now();
  console.log('fetch', name, url);
  const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'User-Agent': 'mbrt-style-lab/1.0 (local visual fixture; github.com/arshlibruh-code)', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  const raw = await res.text();
  console.log(name, res.status, raw.slice(0, 220));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const data = JSON.parse(raw);
  const record = { name, url, method: body ? 'POST' : 'GET', ...(body ? { body } : {}), fetchedAt: new Date().toISOString() };
  await writeFile(cache, JSON.stringify({ provenance: record, data }, null, 2) + '\n');
  provenance.push(record);
  return data;
}
const queries = [
  ['mg', 'MG Road Bengaluru', [77.61, 12.975]],
  ['nandi', 'Nandi', [77.684, 13.37]],
  ['hebbal', 'Hebbal', [77.598, 13.035]],
  ['cubbon', 'Cubbon Park Bengaluru', [77.592, 12.976]],
  ['palace', 'Bangalore Palace', [77.592, 12.999]],
  ['london', 'London United Kingdom', [-0.127, 51.507]],
];
const places = {};
for (const [key, q, near] of queries) {
  const data = await request(key, `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=20&lon=${near[0]}&lat=${near[1]}`);
  const candidates = data.features.filter(f => (key==='mg' || (key==='nandi' ? f.properties.osm_key==='natural' && f.properties.osm_value==='peak' : f.properties.name?.toLowerCase() === q.replace(' Bengaluru','').replace(' United Kingdom','').toLowerCase())) && turf.distance(f, turf.point(near)) < (key === 'london' ? 30 : 12));
  if (!candidates.length) throw new Error('No nearby Photon result: ' + q);
  const f = candidates.sort((a,b) => turf.distance(a, turf.point(near)) - turf.distance(b, turf.point(near)))[0];
  places[key] = { coord: f.geometry.coordinates, label: key==='nandi'?'Nandi Hills':q.replace(' Bengaluru','').replace(' Karnataka','').replace(' United Kingdom',''), publishedName: f.properties.name, osmId: f.properties.osm_id };
  console.log('chosen', key, JSON.stringify(places[key]));
}
const rawRoute = await request('route', `https://routing.openstreetmap.de/routed-car/route/v1/driving/${places.mg.coord.join(',')};${places.nandi.coord.join(',')}?overview=full&geometries=geojson`);
if (rawRoute.code !== 'Ok') throw new Error(JSON.stringify(rawRoute));
const r = rawRoute.routes[0];
const route = turf.lineString(r.geometry.coordinates);
const total = turf.length(route);
const samples = Array.from({ length: 200 }, (_, i) => turf.along(route, total * i / 199).geometry.coordinates);
const heights = await request('height', 'https://valhalla1.openstreetmap.de/height', { shape: samples.map(([lon,lat]) => ({ lon,lat })), range: true });
if (heights.range_height?.length !== 200 || heights.range_height.some(p => p[1] == null)) throw new Error('Expected 200 valid heights');
const iso = await request('isochrone', 'https://valhalla1.openstreetmap.de/isochrone', { locations: [{lon: places.hebbal.coord[0], lat: places.hebbal.coord[1]}], costing: 'auto', contours: [10,20,30].map(time => ({time})), polygons: true });
const boundaryRaw = await request('boundary', 'https://nominatim.openstreetmap.org/search?q=Yelahanka%20taluku%2C%20India&format=geojson&polygon_geojson=1&polygon_threshold=0.0002&limit=10');
const boundaries = boundaryRaw.features.filter(f => /Polygon/.test(f.geometry.type) && f.properties.category==='boundary' && f.properties.type==='administrative' && f.properties.addresstype !== 'district' && turf.area(f)/1e6>1 && turf.area(f)/1e6<1000);
if (!boundaries.length) throw new Error('No subdistrict boundary returned');
const boundary = boundaries.sort((a,b) => turf.area(a)-turf.area(b))[0];
const feat = (f, id, kind, label, props = {}) => ({ ...f, id, properties: {kind, label, fid:id, status:'older', ...props} });
const polygon = turf.polygon([[places.mg.coord, places.palace.coord, places.cubbon.coord, places.mg.coord]]);
const straight = turf.lineString([places.mg.coord, places.palace.coord]);
const arc = turf.greatCircle(places.mg.coord, places.london.coord, {npoints:192});
const features = [
  feat(route, 'route', 'route', 'MG Road → Nandi Hills', {status:'latest', km:r.distance/1000, minutes:r.duration/60}),
  ...iso.features.sort((a,b)=>b.properties.contour-a.properties.contour).map(f => feat(f, `iso-${f.properties.contour}`, 'isochrone', `${f.properties.contour} MIN`, {minutes:f.properties.contour, center:places.hebbal.coord, km2:turf.area(f)/1e6})),
  feat(turf.circle(places.cubbon.coord,5,{steps:128}), 'buffer', 'buffer', 'Cubbon radius', {radiusKm:5, center:places.cubbon.coord, km2:turf.area(turf.circle(places.cubbon.coord,5,{steps:128}))/1e6}),
  feat(polygon,'polygon','polygon','City triangle',{km2:turf.area(polygon)/1e6}),
  feat(boundary,'boundary','boundary',boundary.properties.name,{km2:turf.area(boundary)/1e6, sourceName:boundary.properties.display_name, addressType:boundary.properties.addresstype}),
  feat(straight,'straight','line','MG Road → Palace',{variant:'straight',km:turf.length(straight)}),
  feat(arc,'arc','line','Bengaluru → London',{variant:'arc',km:turf.distance(places.mg.coord,places.london.coord)}),
  ...['mg','nandi','hebbal','cubbon','palace'].map((k,i)=>feat(turf.point(places[k].coord),`pin-${i+1}`,'marker',places[k].label,{number:i+1,status:i===0?'latest':'older'})),
];
const fixture = {
  version:1, generatedAt:new Date().toISOString(), provenance, places,
  cameras:{CITY:{center:[77.62,13.16],zoom:9.1,pitch:0,bearing:0},WORLD:{center:[35,35],zoom:1.45,pitch:0,bearing:0}},
  features:{type:'FeatureCollection',features},
  elevation:{routeId:'route',samples:samples.map((coordinate,i)=>({coordinate,km:heights.range_height[i][0]/1000,meters:heights.range_height[i][1]}))},
  notes:['OSRM duration is a routing estimate, not live traffic.','Valhalla contour times are modelled drive times.','Elevation gain and grade are sampled terrain estimates.','Future-tool samples are illustrative, not service results.'],
};
await writeFile(root+'fixture.json', JSON.stringify(fixture,null,2)+'\n');
console.log('frozen', {routeKm:r.distance/1000, minutes:r.duration/60, samples:200, features:features.length,boundaryKm2:turf.area(boundary)/1e6});
