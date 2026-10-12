import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import reticle from './look/reticle.js';
import surveyor from './look/surveyor.js';
import phosphor from './look/phosphor.js';
import {STYLES,SKY,SKY_DARK} from './basemaps.js';
import {createRenderer,createElevationChart} from './draw.js';
maplibregl.setWorkerUrl(workerUrl);
const $=id=>document.getElementById(id);
const looks=[reticle,surveyor,phosphor],panels=[];
let syncing=false,base='DARK',camera='CITY',selected='route',hovered='',sample='',cursor=0;
const fixture=await fetch(new URL('./fixture.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Frozen fixture missing');return r.json();}).catch(e=>{$('panels').innerHTML=`<p class="error-banner">${e.message}. Run node app/lab/generate-fixture.mjs once.</p>`;throw e;});
const route=fixture.features.features.find(f=>f.id==='route');
$('scene-summary').textContent=`BENGALURU / ${route.properties.km.toFixed(1)} KM DRIVE / ${route.properties.minutes.toFixed(0)} MIN / 200 HEIGHTS`;
$('provenance').textContent=`FROZEN ${fixture.generatedAt.slice(0,10)} / OSRM + VALHALLA + NOMINATIM + PHOTON`;
const sampleNotes={
  heatmap:'Heatmap slot: density of illustrative observations near the five stops.',
  extrusion:'3D slot: city triangle extruded 650 m, illustrative height.',
  compare:'A vs B: OSRM A plus a screen-offset B trace, a style study, not an alternate route.',
  time:'Time slot: cumulative real 10 / 20 / 30 min Valhalla contours. No interpolated travel-time claims.',
  measure:'Measure slot: geodesic MG Road to Palace, computed from the fixture coordinates.',
};
function specimen(t,key) {
  const a=t.color.latest,w=t.color.older,m=t.color.waiting,stroke=t.line.straight,glow=t.id==='phosphor'?` style="filter:drop-shadow(0 0 2px ${a})"`:'';
  const shapes={
    heatmap:`<defs><radialGradient id="heat-${t.id}"><stop stop-color="${t.color.error}"/><stop offset=".45" stop-color="${m}"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs><circle cx="25" cy="23" r="17" fill="url(#heat-${t.id})"/><circle cx="40" cy="18" r="13" fill="url(#heat-${t.id})"/>`,
    extrusion:`<path d="M15 28L30 20L48 28L32 37Z" fill="${a}" fill-opacity=".15" stroke="${a}"/><path d="M15 12L30 4L48 12L32 21Z" fill="${a}" fill-opacity=".3" stroke="${a}"/><path d="M15 12V28M32 21V37M48 12V28" stroke="${a}"/>`,
    compare:`<path d="M7 28L19 28L28 12L43 12L55 23" fill="none" stroke="${a}" stroke-width="${t.line.route}"/><path d="M7 34L22 34L32 20L43 20L55 30" fill="none" stroke="${m}" stroke-width="${stroke}" stroke-dasharray="${t.line.dash.join(' ')}"/>`,
    time:`<path d="M5 24L15 7L38 4L57 24L39 37L17 35Z" fill="${w}" fill-opacity=".04" stroke="${w}"/><path d="M14 24L21 13L35 12L48 24L34 32L22 29Z" fill="${w}" fill-opacity=".08" stroke="${w}"/><path d="M23 24L27 17L33 19L38 24L30 29Z" fill="${a}" fill-opacity=".15" stroke="${a}"/>`,
    measure:`<path d="M10 31L52 9M7 26L13 36M49 4L55 14" stroke="${a}" stroke-width="${t.sample.measureWidth}"/><text x="24" y="30" fill="${w}" font-size="9" font-family="Quantico">KM</text>`,
  };
  const names={heatmap:'HEATMAP',extrusion:'3D',compare:'A / B',time:'TIME',measure:'MEASURE'};
  return `<button class="specimen" data-sample="${key}" aria-pressed="false"><svg viewBox="0 0 62 42"${glow} aria-hidden="true">${shapes[key]}</svg><b>${names[key]}</b><small>${key==='extrusion'?'650 M':key==='time'?'10 / 20 / 30':key==='compare'?'STYLE STUDY':'SAMPLE'}</small></button>`;
}
function select(id){if(id==='arc'&&camera!=='WORLD')chooseCamera('WORLD');else if(id!=='arc'&&camera==='WORLD')chooseCamera('CITY');selected=id;for(const p of panels){p.renderer.setState({selected});p.root.querySelector('.map-note').innerHTML=`<b>SELECTED</b> / ${fixture.features.features.find(f=>f.id===id)?.properties.label||id}`;}for(const b of $('results').children)b.setAttribute('aria-pressed',String(b.dataset.id===id));}
function hover(id){if(hovered===id)return;hovered=id;for(const p of panels)p.renderer.setState({hovered});}
function setCursor(ratio){cursor=ratio;for(const p of panels){p.renderer.setCursor(ratio);p.chart.setCursor(ratio);}}
function setHorizon(value){for(const p of panels){p.renderer.setState({horizon:value});p.root.querySelector('.time-range').value=value;p.root.querySelector('.time-value').textContent=`${value} MIN`;}}
function chooseCamera(next){camera=next;syncing=true;for(const p of panels){p.map.jumpTo(fixture.cameras[camera]);p.renderer.setState({view:camera});}syncing=false;document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===camera)));}
function setSample(key){sample=sample===key?'':key;
  for(const p of panels){p.renderer.setState({sample});p.root.querySelectorAll('[data-sample]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sample===sample)));p.root.querySelector('.sample-note').textContent=sampleNotes[sample]||'Choose a slot to inspect it on the map.';}
  if(sample==='extrusion'){syncing=true;for(const p of panels)p.map.jumpTo({...fixture.cameras.CITY,pitch:48,zoom:12,center:fixture.places.palace.coord});syncing=false;camera='CITY';}
  else if(sample){syncing=true;const zoom=sample==='measure'?12.8:sample==='heatmap'?11.3:9.45;for(const p of panels)p.map.jumpTo({...fixture.cameras.CITY,zoom,center:sample==='measure'?fixture.places.palace.coord:sample==='heatmap'?fixture.places.mg.coord:fixture.cameras.CITY.center});syncing=false;camera='CITY';}
  if(sample)for(const p of panels)p.renderer.setState({view:'CITY'});
  document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===camera)));
}
for(const [index,t] of looks.entries()) {
  const root=document.createElement('section');root.className='panel';root.dataset.look=t.id;
  const vars={...Object.fromEntries(Object.entries(t.color).map(([k,v])=>[k==='muted'?'look-muted':k==='hair'?'look-hair':k,v])),'type-size':t.type.size+'px','type-weight':t.type.weight,'type-tracking':t.type.tracking,'coordinate-size':t.type.coordinateSize+'px','label-width':t.label.width+'px','label-padding':t.label.padding+'px','hover-scale':t.pin.hoverScale,'selected-scale':t.pin.selectedScale,fade:t.motion.fade+'ms'};
  for(const [k,v]of Object.entries(vars))root.style.setProperty('--'+k,v);
  root.innerHTML=`<header class="panel-head"><div><h1>${t.name}</h1><p>${t.subtitle}</p></div><span class="panel-index">0${index+1}</span></header><div class="map-wrap"><div class="map" id="map-${t.id}"></div><div class="map-top"><span class="camera-readout"></span><span class="map-status">FROZEN GEOMETRY</span></div><div class="map-note"><b>LATEST</b> / MG Road → Nandi Hills</div></div><div class="elevation-wrap"></div><div class="legend">${['latest','older','waiting','error'].map(k=>`<span style="color:${t.color[k]}"><i></i>${k.toUpperCase()}</span>`).join('')}</div><div class="slots"><div class="slots-head"><span>FUTURE TOOL SLOTS</span><span>ILLUSTRATIVE</span></div><div class="specimens">${Object.keys(sampleNotes).map(key=>specimen(t,key)).join('')}</div><small class="sample-note">Choose a slot to inspect it on the map.</small><label class="time-row">ISOCHRONE<input class="time-range" type="range" min="10" max="30" step="10" value="30" aria-label="Drive-time contour"><output class="time-value">30 MIN</output></label></div>`;
  $('panels').append(root);
  const map=new maplibregl.Map({container:root.querySelector('.map'),style:STYLES[base],...fixture.cameras.CITY,attributionControl:false,renderWorldCopies:false,canvasContextAttributes:{preserveDrawingBuffer:true}});
  map.addControl(new maplibregl.AttributionControl({compact:false,customAttribution:'© OpenStreetMap · Photon · FOSSGIS'}),'bottom-right');
  map.on('style.load',()=>{map.setProjection({type:'globe'});map.setSky(base==='DARK'||base==='OFFLINE'?SKY_DARK:SKY);});
  const renderer=createRenderer({map,tokens:t,features:fixture.features,elevation:fixture.elevation,onSelect:select,onHover:hover,onCursor:setCursor});
  renderer.setState({view:camera});
  const chart=createElevationChart(root.querySelector('.elevation-wrap'),t,fixture.elevation.samples,setCursor);
  const p={root,map,renderer,chart};panels.push(p);
  map.on('move',()=>{
    const c=map.getCenter();root.querySelector('.camera-readout').textContent=`${Math.abs(c.lat).toFixed(3)} ${c.lat<0?'S':'N'} / ${Math.abs(c.lng).toFixed(3)} ${c.lng<0?'W':'E'} / Z ${map.getZoom().toFixed(2)}`;
    if(syncing)return;syncing=true;
    for(const other of panels)if(other!==p)other.map.jumpTo({center:c,zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()});
    syncing=false;
  });
  map.on('error',e=>{root.querySelector('.map-status').textContent=e.error?.message?.includes('lab-')?'LAYER ERROR':'TILES UNAVAILABLE / USE OFFLINE';console.warn(t.id,e.error?.message);});
  map.on('load',()=>{root.querySelector('.map-status').textContent='LIVE CAMERA / FROZEN DATA';root.querySelector('.camera-readout').textContent=`13.160 N / 77.620 E / Z ${map.getZoom().toFixed(2)}`;});
  root.querySelectorAll('[data-sample]').forEach(b=>b.addEventListener('click',()=>setSample(b.dataset.sample)));
  root.querySelector('.time-range').addEventListener('input',e=>setHorizon(Number(e.target.value)));
}
for(const f of fixture.features.features.filter(f=>f.properties.kind!=='marker')) {
  const b=document.createElement('button');b.textContent=f.properties.kind==='isochrone'?f.properties.label:f.properties.kind==='line'?f.properties.variant.toUpperCase():f.properties.kind.toUpperCase();b.dataset.id=f.id;b.className=f.properties.status;b.setAttribute('aria-pressed',String(f.id===selected));b.addEventListener('click',()=>select(f.id));$('results').append(b);
}
$('basemaps').addEventListener('click',e=>{const next=e.target.dataset.base;if(!next)return;base=next;for(const p of panels)p.map.setStyle(STYLES[base]);$('basemaps').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.base===base)));});
$('cameras').addEventListener('click',e=>{const next=e.target.dataset.camera;if(next)chooseCamera(next);});
$('numbers').addEventListener('change',e=>{for(const p of panels)p.renderer.setState({numbers:e.target.checked});});
$('replay').addEventListener('click',()=>{const start=performance.now();for(const p of panels)p.renderer.replay(start);});
$('methods').innerHTML=`<p>OSRM drive duration: routing estimate without live traffic. Valhalla contours: modelled drive times. Sampled terrain elevation and grade are not a road survey. OSRM road distance and Valhalla sampled-path distance use different measurements, each keeps its source value.</p><p>Boundary: ${fixture.features.features.find(f=>f.id==='boundary').properties.sourceName}. Buffer radius and areas use Turf geodesic calculations. All requests were sequential, at least 1.1 s apart. Saved responses are in lab/sources/.</p><p>Porting: choose look/*.js and use createRenderer / createElevationChart from draw.js. Supply GeoJSON with kind and label; lab metadata adds status, IDs and measured values. basemaps.js temporarily copies main.js constants; share them later. lab.html is excluded from the default production build.</p><ul>${fixture.provenance.map(s=>`<li><a href="${s.url}" target="_blank" rel="noopener">${s.name} / ${new URL(s.url).hostname}</a> / ${s.fetchedAt}</li>`).join('')}</ul>`;
// Read-only handles for headless checks and future porting experiments.
window.mbrtLab={panels,fixture,get state(){return {base,camera,selected,hovered,sample,cursor};}};
