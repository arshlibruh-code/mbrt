import * as turf from '@turf/turf';
import { Marker } from 'maplibre-gl';

const collection = features => ({type:'FeatureCollection',features});
const areas = ['buffer','isochrone','polygon','boundary'];
const lines = ['route','line'];
const isKind = kinds => ['in',['get','kind'],['literal',kinds]];
const role = t => ['match',['get','status'],'latest',t.color.latest,'waiting',t.color.waiting,'error',t.color.error,t.color.older];
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const coordinateText = c => `${Math.abs(c[1]).toFixed(4)} ${c[1]<0?'S':'N'} / ${Math.abs(c[0]).toFixed(4)} ${c[0]<0?'W':'E'}`;
const paths = f => f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
const pointOn = (f,ratio) => { const p=paths(f)[0]; return turf.along(turf.lineString(p),turf.length(turf.lineString(p))*ratio).geometry.coordinates; };
const midpoint = f => paths(f).length ? pointOn(f,.5) : f.geometry.type==='Point' ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;

function installTheme(host,t) {
  host.dataset.mbrtDraw=t.id;
  const vars={...t.color,'type-size':t.type.size+'px','type-weight':t.type.weight,'type-tracking':t.type.tracking,'coordinate-size':t.type.coordinateSize+'px','label-width':t.label.width+'px','label-padding':t.label.padding+'px','hover-scale':t.pin.hoverScale,'selected-scale':t.pin.selectedScale,'fade':t.motion.fade+'ms'};
  for(const [key,value]of Object.entries(vars))host.style.setProperty('--'+key,value);
  if(document.getElementById('mbrt-draw-style-'+t.id))return;
  const scope=`[data-mbrt-draw="${t.id}"]`,style=document.createElement('style');style.id='mbrt-draw-style-'+t.id;
  const pinShape=t.pin.shape==='crosshair'?`background:linear-gradient(currentColor,currentColor) center/1px 100% no-repeat,linear-gradient(currentColor,currentColor) center/100% 1px no-repeat;`:t.pin.shape==='trace'?`border:1px solid currentColor;box-shadow:0 0 ${t.line.glow*2}px currentColor,inset 0 0 ${t.line.glow}px var(--latest);`:`border:1px solid currentColor;clip-path:polygon(0 0,35% 0,35% 8%,8% 8%,8% 35%,0 35%,0 0,100% 0,100% 35%,92% 35%,92% 8%,65% 8%,65% 0,100% 0,100% 100%,65% 100%,65% 92%,92% 92%,92% 65%,100% 65%,100% 100%,0 100%,0 65%,8% 65%,8% 92%,35% 92%,35% 100%,0 100%);`;
  const inner=t.pin.shape==='crosshair'?'inset:5px;border:1px solid currentColor;':t.pin.shape==='trace'?'inset:6px;border-left:1px solid currentColor;border-bottom:1px solid currentColor;':'';
  const label=t.label.box?'background:var(--ground);border:1px solid var(--hair);border-left:2px solid var(--role);':t.label.coordinates?'border-bottom:1px solid currentColor;background:color-mix(in srgb,var(--ground) 70%,transparent);':'background:color-mix(in srgb,var(--ground) 60%,transparent);';
  const shadow=t.line.glowWidth?`0 0 ${t.line.glow*1.5}px currentColor,0 1px 3px #000`:'0 1px 2px #000,0 0 4px #000';
  style.textContent=`
    ${scope}{font-family:${t.type.family},monospace;font-variant-numeric:tabular-nums;}
    ${scope} .leaders{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;fill:none;stroke-width:.7;opacity:.6;}
    ${scope} .maplibregl-marker{z-index:2;}
    ${scope} .lab-marker{width:0;height:0;position:relative;color:var(--role);font-size:var(--type-size);font-weight:var(--type-weight);letter-spacing:var(--type-tracking);white-space:nowrap;}
    ${scope} .pin{position:absolute;left:calc(var(--pin-size) / -2);top:calc(var(--pin-size) / -2);width:var(--pin-size);height:var(--pin-size);padding:0;color:var(--role);border:0;border-radius:0;background:transparent;display:grid;place-items:center;cursor:pointer;transform:translateY(var(--drop,0px));transition:scale var(--fade) ease-out;line-height:1;}
    ${scope} .pin span{background:var(--ground);min-width:14px;padding:1px;font:inherit;font-size:11px;}
    ${scope} .pin:before,${scope} .pin:after{content:'';position:absolute;inset:0;pointer-events:none;}
    ${scope} .pin:before{${pinShape}}
    ${scope} .pin:after{${inner}}
    ${scope} .pin:hover,${scope} .hovered .pin{scale:var(--hover-scale);color:var(--latest);}
    ${scope} .selected .pin{scale:var(--selected-scale);color:var(--latest);}
    ${scope} .map-label{position:absolute;box-sizing:border-box;max-width:var(--label-width);padding:var(--label-padding);line-height:1.3;color:var(--role);pointer-events:auto;cursor:pointer;user-select:none;text-shadow:${shadow};overflow:hidden;${label}}
    ${scope} .map-label b{font-weight:var(--type-weight);display:block;}
    ${scope} .map-label small{display:block;color:var(--muted);font-size:var(--coordinate-size);margin-top:2px;}
    ${scope} .selected .map-label,${scope} .hovered .map-label{color:var(--latest);border-color:var(--latest);z-index:3;}
    ${scope} .number-marker{font-size:10px;}
    ${scope} .elevation{width:100%;height:94px;display:block;margin-top:7px;cursor:crosshair;${t.line.glowWidth?'filter:drop-shadow(0 0 2px var(--latest));':''}}
    ${scope} .chart-title,${scope} .chart-axis,${scope} .chart-data{display:flex;justify-content:space-between;gap:5px;font-size:9px;color:var(--muted);}
    ${scope} .chart-title b{font-weight:400;color:var(--older);}
    ${scope} .chart-title i{font-style:normal;}
    ${scope} .chart-axis,${scope} .chart-data{margin-top:3px;}
    ${scope} .chart-data{color:var(--older);}
    ${scope} .chart-range{width:100%;height:10px;accent-color:var(--latest);margin:8px 0 2px;}
    ${scope} .chart-note{font-size:8px;color:var(--muted);}
    @media(prefers-reduced-motion:reduce){${scope} .pin{transition:none;}}
  `;
  document.head.append(style);
}

export function createRenderer({map,tokens:t,features,elevation,onSelect=()=>{},onHover=()=>{},onCursor=()=>{}}) {
  let selected='route', hovered='', numbers=true, progress=1, horizon=30, sample='', view='ALL', markers=[], cursor=0, disposed=false, drawFrame=0, layoutFrame=0, moveTimer=0;
  const base=structuredClone(features.type==='FeatureCollection'?features.features:features).map((f,i)=>{
    f.id=f.id??f.properties.fid??`feature-${i}`;f.properties={status:'older',...f.properties,fid:f.id};
    if(paths(f).length && f.properties.km==null) f.properties.km=turf.length(f);
    if(areas.includes(f.properties.kind)) {
      f.properties.km2??=turf.area(f)/1e6;
      if(f.properties.kind==='isochrone') f.properties.minutes??=parseFloat(f.properties.label);
      if(f.properties.kind==='buffer') {f.properties.center??=turf.centroid(f).geometry.coordinates;f.properties.radiusKm??=turf.distance(f.properties.center,f.geometry.coordinates[0][0]);}
    }
    return f;
  });
  const route=base.find(f=>(elevation?.routeId && f.id===elevation.routeId) || f.properties.kind==='route');
  const prefix='lab-';
  const container=map.getContainer();
  installTheme(container,t);
  container.dataset.look=t.id;
  container.style.setProperty('--latest',t.color.latest);
  const leaders=document.createElementNS('http://www.w3.org/2000/svg','svg');
  leaders.classList.add('leaders'); container.append(leaders);
  const defaults={selected,hovered,numbers,progress,horizon,sample,view};
  const source=(id,data,extra={})=>map.addSource(prefix+id,{type:'geojson',data:collection(data),...extra});
  const layer=(id,type,sourceId,paint,filter,layout={})=>map.addLayer({id:prefix+id,type,source:prefix+sourceId,paint,...(filter?{filter}:{}),layout});
  const usable=f=>view==='ALL'||(view==='WORLD'?f.properties.variant==='arc':f.properties.variant!=='arc');
  function geometryAt(f,p) {
    if(p===1 || f.geometry.type==='Point') return f;
    if(paths(f).length) {
      return {...f,geometry:{type:f.geometry.type,coordinates:f.geometry.type==='LineString'?clipPath(f.geometry.coordinates,p):f.geometry.coordinates.map(c=>clipPath(c,p))}};
    }
    const center=f.properties.center || midpoint(f);
    const resize=coords=>coords.length && typeof coords[0]==='number' ? [center[0]+(coords[0]-center[0])*p,center[1]+(coords[1]-center[1])*p] : coords.map(resize);
    return {...f,geometry:{...f.geometry,coordinates:resize(f.geometry.coordinates)}};
  }
  function clipPath(coords,p) {
    const line=turf.lineString(coords), km=turf.length(line);
    return turf.lineSliceAlong(line,0,Math.max(.00001,km*p)).geometry.coordinates;
  }
  const grades=[];
  if(elevation && route) for(let i=1;i<elevation.samples.length;i++) {
    const a=elevation.samples[i-1],b=elevation.samples[i];
    const grade=(b.meters-a.meters)/Math.max(1,(b.km-a.km)*1000)*100;
    const pathKm=turf.length(route);
    const shape=turf.lineSliceAlong(route,pathKm*(i-1)/(elevation.samples.length-1),pathKm*i/(elevation.samples.length-1));
    grades.push({...shape,properties:{grade:Math.abs(grade),index:i/(elevation.samples.length-1)}});
  }
  function decorations() {
    const out=[];
    for(const f of base.filter(f=>lines.includes(f.properties.kind)&&usable(f))) for(const coords of paths(f)) {
      const line=turf.lineString(coords), geometryKm=turf.length(line), km=f.properties.km??geometryKm, step=f.properties.variant==='arc'?1000:t.line.ticksKm;
      for(let d=step;d<km;d+=step) {
        const at=geometryKm*d/km,a=turf.along(line,at),b=turf.along(line,Math.min(geometryKm,at+.1));
        const bearing=turf.bearing(a,b), size=f.properties.variant==='arc'?35:t.line.tickLengthKm;
        out.push(turf.lineString([turf.destination(a,size,bearing-90).geometry.coordinates,turf.destination(a,size,bearing+90).geometry.coordinates],{status:f.properties.status}));
      }
      const arrowStep=f.properties.variant==='arc'?1500:t.line.arrowKm;
      for(let d=arrowStep;d<km;d+=arrowStep) {
        const at=geometryKm*d/km,a=turf.along(line,at),b=turf.along(line,Math.min(geometryKm,at+.1)),bearing=turf.bearing(a,b),size=f.properties.variant==='arc'?50:.22;
        out.push(turf.lineString([turf.destination(a,size,bearing+145).geometry.coordinates,a.geometry.coordinates,turf.destination(a,size,bearing-145).geometry.coordinates],{status:f.properties.status}));
      }
    }
    if(t.area.hatch) for(const f of base.filter(f=>areas.includes(f.properties.kind)&&usable(f))) {
      const ring=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];
      const line=turf.lineString(ring),km=turf.length(line);
      for(let d=0;d<km;d+=t.area.hatchSpacingKm) {
        const p=turf.along(line,d),q=turf.along(line,Math.min(km,d+.05)),bearing=turf.bearing(p,q);
        const dest=turf.destination(p,t.line.tickLengthKm,bearing+65);
        out.push(turf.lineString([p.geometry.coordinates,dest.geometry.coordinates],{status:f.properties.status}));
      }
      if(f.properties.kind==='polygon'||f.properties.kind==='boundary') {
        const [w,s,e,n]=turf.bbox(f),latStep=t.area.hatchSpacingKm/111,lonStep=latStep/Math.cos(s*Math.PI/180);
        for(let lat=s;lat<n;lat+=latStep) for(let lon=w;lon<e;lon+=lonStep) {
          const a=turf.point([lon,lat]),b=turf.destination(a,t.area.hatchLengthKm,45);
          if(turf.booleanPointInPolygon(a,f)&&turf.booleanPointInPolygon(b,f)) out.push(turf.lineString([a.geometry.coordinates,b.geometry.coordinates],{status:f.properties.status}));
        }
      }
    }
    return out;
  }
  function samples() {
    const points=base.filter(f=>f.geometry.type==='Point').flatMap(f=>Array.from({length:7},(_,i)=>turf.destination(f,.3+i*.09,i*51,{properties:{weight:(7-i)/7}})));
    const poly=base.find(f=>f.properties.kind==='polygon');
    const measured=base.find(f=>f.id==='straight');
    return {points,poly:poly?[poly]:[],comparison:route?[route]:[],measure:measured?[measured]:[]};
  }
  function mount() {
    if(disposed || map.getSource(prefix+'features')) return;
    source('features',[]); source('decor',[]); source('grade',grades); source('cursor',[]);
    const s=samples(); source('heat',s.points);source('extrusion',s.poly);source('comparison',s.comparison);source('measure',s.measure);
    layer('fills','fill','features',{'fill-color':role(t),'fill-opacity':['match',['get','kind'],'buffer',t.area.buffer,'isochrone',t.area.isochrone,'polygon',t.area.polygon,t.area.boundary]},isKind(areas));
    if(t.line.glowWidth) layer('glow','line','features',{'line-color':role(t),'line-width':t.line.glowWidth,'line-blur':t.line.glow,'line-opacity':.4},isKind([...lines,...areas]));
    layer('edges','line','features',{'line-color':role(t),'line-width':t.line.area,'line-opacity':.78},isKind(areas));
    if(t.area.doubleBoundary) layer('double-boundary','line','features',{'line-color':role(t),'line-width':t.line.boundary,'line-gap-width':4},isKind(['boundary']));
    layer('casing','line','features',{'line-color':t.color.casing,'line-width':t.line.casing,'line-opacity':.85},isKind(lines),{'line-cap':'round','line-join':'round'});
    layer('route','line','features',{'line-color':role(t),'line-width':t.line.route},isKind(['route']),{'line-cap':'round','line-join':'round'});
    layer('straight','line','features',{'line-color':role(t),'line-width':t.line.straight,'line-dasharray':t.line.dash},['all',isKind(['line']),['!=',['get','variant'],'arc']]);
    layer('arc','line','features',{'line-color':role(t),'line-width':t.line.arc,'line-dasharray':t.line.arcDash},['==',['get','variant'],'arc']);
    layer('selected','line','features',{'line-color':t.color.latest,'line-width':t.line.selected,'line-opacity':.28},['==',['get','fid'],selected]);
    layer('hovered','line','features',{'line-color':t.color.latest,'line-width':t.line.selected+1,'line-opacity':.35},['==',['get','fid'],hovered]);
    layer('grades','line','grade',{'line-color':['interpolate',['linear'],['get','grade'],0,t.color.low,4,t.color.medium,9,t.color.steep],'line-width':Math.max(1,t.line.route-1)},null,{'line-cap':'round'});
    layer('decorations','line','decor',{'line-color':role(t),'line-width':1,'line-opacity':.8});
    layer('heat','heatmap','heat',{'heatmap-radius':t.sample.heatRadius,'heatmap-weight':['get','weight'],'heatmap-opacity':.75,'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(8,155,223,0)',.3,t.color.latest,.65,t.color.waiting,1,t.color.error]},null,{visibility:'none'});
    layer('extrusion','fill-extrusion','extrusion',{'fill-extrusion-color':t.color.latest,'fill-extrusion-height':t.sample.extrusionMeters,'fill-extrusion-opacity':.6},null,{visibility:'none'});
    layer('compare','line','comparison',{'line-color':t.color.waiting,'line-width':t.line.route,'line-offset':t.sample.compareOffset,'line-dasharray':t.line.dash},null,{visibility:'none'});
    layer('measure','line','measure',{'line-color':t.color.waiting,'line-width':t.sample.measureWidth,'line-dasharray':[1,1]},null,{visibility:'none'});
    layer('cursor','circle','cursor',{'circle-radius':5,'circle-color':t.color.latest,'circle-stroke-color':t.color.older,'circle-stroke-width':2});
    update(); buildMarkers(); setCursor(cursor);
  }
  function visibleFeatures() {return base.filter(f=>usable(f)&&(f.properties.kind!=='isochrone'||f.properties.minutes<=horizon)).map(f=>geometryAt(f,Math.max(.0001,progress)));}
  function update() {
    const src=map.getSource(prefix+'features'); if(!src)return;
    src.setData(collection(visibleFeatures()));
    map.getSource(prefix+'decor').setData(collection(progress===1?decorations():[]));
    const gradeData=map.getZoom()>=5?grades.filter(f=>f.properties.index<=progress):[];
    map.getSource(prefix+'grade').setData(collection(gradeData));
    map.setFilter(prefix+'selected',['==',['get','fid'],selected]);
    map.setFilter(prefix+'hovered',['==',['get','fid'],hovered]);
    for(const [id,key] of [['heat','heatmap'],['extrusion','extrusion'],['compare','compare'],['measure','measure']])map.setLayoutProperty(prefix+id,'visibility',sample===key&&map.getZoom()>=5?'visible':'none');
    for(const m of markers) {m.el.classList.toggle('selected',m.ids.includes(selected)); m.el.classList.toggle('hovered',m.ids.includes(hovered));}
    scheduleLayout();
  }
  function makeMarker(f,coord,text,opts={}) {
    const el=document.createElement('div');el.className='lab-marker '+(opts.pin?'point-marker':'number-marker');
    el.style.setProperty('--role',t.color[f.properties.status]||t.color.older);
    el.style.setProperty('--pin-size',t.pin.size+'px');
    el.innerHTML=`${opts.pin?`<button class="pin" aria-label="Select ${escape(text)}"><span>${escape(opts.cluster?opts.ids.length:f.properties.number??'+')}</span></button>`:''}<div class="map-label"><b>${escape(text)}</b>${t.label.coordinates?`<small>${coordinateText(coord)}</small>`:''}</div>`;
    const ids=opts.ids||[f.id];
    el.addEventListener('click',e=>{e.stopPropagation();if(opts.cluster)map.easeTo({center:coord,zoom:Math.max(12,map.getZoom()+2),duration:t.motion.duration});else onSelect(f.id);});
    el.addEventListener('pointerenter',()=>onHover(f.id));el.addEventListener('pointerleave',()=>onHover(''));
    const marker=new Marker({element:el,anchor:'center',subpixelPositioning:true}).setLngLat(coord).addTo(map);
    markers.push({marker,el,coord,ids,priority:opts.priority??(opts.pin?f.properties.status==='latest'?80:60:30),pin:opts.pin,number:!opts.pin,feature:f});
  }
  function buildMarkers() {
    markers.forEach(m=>m.marker.remove());markers=[];
    const pts=base.filter(f=>f.geometry.type==='Point'&&usable(f)),groups=[];
    for(const f of pts) {
      const p=map.project(f.geometry.coordinates);
      const group=groups.find(g=>Math.hypot(g.p.x-p.x,g.p.y-p.y)<t.pin.clusterDistance);
      if(group)group.features.push(f);else groups.push({p,features:[f]});
    }
    for(const g of groups) {
      const coord=turf.centroid(collection(g.features)).geometry.coordinates,f=g.features[0];
      makeMarker(f,coord,g.features.length>1?`${g.features.length} STOPS`:f.properties.label,{pin:true,cluster:g.features.length>1,ids:g.features.map(f=>f.id)});
    }
    for(const f of base.filter(f=>usable(f)&&f.geometry.type!=='Point')) {
      if(f.properties.kind==='isochrone'&&f.properties.minutes>horizon)continue;
      const p=f.properties;
      if(lines.includes(p.kind)) {
        makeMarker(f,pointOn(f,.48),p.label,{priority:75});
        if(p.variant==='arc'){const coords=paths(f)[0];makeMarker(f,coords[0],'BENGALURU',{pin:true});makeMarker(f,coords.at(-1),'LONDON',{pin:true});}
        if(numbers) {
          const km=p.km,step=p.variant==='arc'?2000:t.line.ticksKm;
          for(let d=step;d<km;d+=step)makeMarker(f,pointOn(f,d/km),`${d.toFixed(0)} KM${p.minutes?` / ${(p.minutes*d/km).toFixed(0)} MIN`:''}`,{priority:20});
        }
      } else {
        const edge=p.center? turf.destination(p.center,p.radiusKm||((p.minutes||10)/4),p.kind==='isochrone'?65:140).geometry.coordinates:midpoint(f);
        if(p.kind==='isochrone') {
          const ring=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0];
          const boundary=turf.lineString(ring);
          const at=turf.along(boundary,turf.length(boundary)*.28).geometry.coordinates;
          makeMarker(f,at,p.label,{priority:65});
        } else makeMarker(f,edge,p.kind==='buffer'?numbers?`${p.radiusKm.toFixed(1)} KM RADIUS`:p.label:p.label,{priority:65});
        if(numbers)makeMarker(f,midpoint(f),`${p.km2.toFixed(2)} KM²`,{priority:15});
      }
    }
    if(sample==='compare'&&route&&usable(route))makeMarker({...route,id:'route'},pointOn(route,.7),'A / OSRM   B / OFFSET STUDY');
    if(sample==='measure') {
      const f=base.find(f=>f.id==='straight');if(f&&usable(f))makeMarker(f,pointOn(f,.5),`${f.properties.km.toFixed(2)} KM MEASURE`);
    }
    update();
  }
  function scheduleLayout(){cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(layout);}
  function layout() {
    if(disposed)return;
    const bounds=container.getBoundingClientRect(),occupied=[],segments=[];
    const ordered=[...markers].sort((a,b)=>(b.priority+(b.ids.includes(selected)?25:0))-(a.priority+(a.ids.includes(selected)?25:0)));
    for(const m of ordered) {
      const {el,coord}=m,p=map.project(coord),label=el.querySelector('.map-label');
      const show=progress===1||m.pin;
      el.style.visibility=show?'visible':'hidden';
      if(!show)continue;
      el.style.setProperty('--drop',m.pin?`${-t.motion.pinDrop*(1-progress)}px`:'0px');
      el.style.opacity=String(m.pin?progress:1);
      const width=Math.min(t.label.width,label.scrollWidth||t.label.width),height=label.offsetHeight||30;
      const candidates=[[t.label.gap,-height/2],[t.label.gap,-height-15],[-width-t.label.gap,-height/2],[t.label.gap,15],[-width/2,22],[-width/2,-height-22]];
      let chosen;
      if(p.x>0&&p.x<bounds.width&&p.y>0&&p.y<bounds.height-10)for(const [dx,dy]of candidates) {
        const rect={x:p.x+dx,y:p.y+dy,w:width+4,h:height+4};
        if(rect.x<5||rect.y<45||rect.x+rect.w>bounds.width-5||rect.y+rect.h>bounds.height-28)continue;
        if(!occupied.some(r=>rect.x<r.x+r.w+t.label.priorityGap&&rect.x+rect.w>r.x-t.label.priorityGap&&rect.y<r.y+r.h+t.label.priorityGap&&rect.y+rect.h>r.y-t.label.priorityGap)){chosen={dx,dy,rect};break;}
      }
      label.style.visibility=chosen?'visible':'hidden';
      if(chosen){occupied.push(chosen.rect);label.style.left=chosen.dx+'px';label.style.top=chosen.dy+'px';
        if(t.label.leader)segments.push(`<path d="M${p.x},${p.y} L${p.x+chosen.dx/2},${p.y+chosen.dy+height/2} L${p.x+chosen.dx},${p.y+chosen.dy+height/2}" stroke="${m.ids.includes(selected)?t.color.latest:t.color.older}"/>`);
      }
    }
    leaders.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);leaders.innerHTML=segments.join('');
  }
  function setCursor(ratio) {
    cursor=Math.max(0,Math.min(1,ratio));
    if(route&&map.getSource(prefix+'cursor'))map.getSource(prefix+'cursor').setData(collection(map.getZoom()>=5?[turf.point(pointOn(route,cursor))]:[]));
  }
  const click=e=>{
    const hits=map.queryRenderedFeatures(e.point,{layers:['fills','edges','route','straight','arc'].map(id=>prefix+id).filter(id=>map.getLayer(id))});
    if(hits.length)onSelect(hits[0].properties.fid);
  };
  const pointer=e=>{
    const hits=map.queryRenderedFeatures(e.point,{layers:['route','straight','arc','edges'].map(id=>prefix+id).filter(id=>map.getLayer(id))});
    container.style.cursor=hits.length?'pointer':'';
    const id=hits[0]?.properties.fid||'';if(id!==hovered)onHover(id);
    if(hits[0]?.properties.kind==='route'&&route){const nearest=turf.nearestPointOnLine(route,turf.point([e.lngLat.lng,e.lngLat.lat]));onCursor(nearest.properties.location/turf.length(route));}
  };
  function moveEnd(){clearTimeout(moveTimer);moveTimer=setTimeout(()=>{update();buildMarkers();setCursor(cursor);},80);}
  map.on('style.load',mount);map.on('move',scheduleLayout);map.on('moveend',moveEnd);map.on('click',click);map.on('mousemove',pointer);
  if(map.isStyleLoaded())mount();
  return {
    tokens:t,defaults,
    setState(state){if('selected'in state)selected=state.selected;if('hovered'in state)hovered=state.hovered;
      let rebuild=false;for(const key of ['numbers','horizon','sample','view'])if(key in state)rebuild=true;
      if('numbers'in state)numbers=state.numbers;if('horizon'in state)horizon=state.horizon;if('sample'in state)sample=state.sample;if('view'in state)view=state.view;
      update();if(rebuild)buildMarkers();},
    setCursor,
    replay(start=performance.now()){
      cancelAnimationFrame(drawFrame);progress=0;update();
      const frame=now=>{
        const u=Math.min(1,(now-start)/t.motion.duration),d=t.motion.damping;
        progress=u===1?1:(1-(1+d*u)*Math.exp(-d*u))/(1-(1+d)*Math.exp(-d));
        update();if(u<1)drawFrame=requestAnimationFrame(frame);else {buildMarkers();}
      };drawFrame=requestAnimationFrame(frame);
    },
    destroy(){disposed=true;clearTimeout(moveTimer);cancelAnimationFrame(drawFrame);cancelAnimationFrame(layoutFrame);markers.forEach(m=>m.marker.remove());leaders.remove();map.off('style.load',mount);map.off('move',scheduleLayout);map.off('moveend',moveEnd);map.off('click',click);map.off('mousemove',pointer);},
  };
}

export function createElevationChart(host,t,samples,onCursor) {
  installTheme(host,t);
  const W=t.chart.width,H=t.chart.height,pad=8,hs=samples.map(s=>s.meters),lo=Math.min(...hs),hi=Math.max(...hs),km=samples.at(-1).km;
  const x=s=>pad+(W-pad*2)*s.km/km,y=s=>H-pad-(H-pad*2)*(s.meters-lo)/Math.max(1,hi-lo);
  let gain=0;for(let i=1;i<hs.length;i++)gain+=Math.max(0,hs[i]-hs[i-1]);
  const path=samples.map((s,i)=>`${i?'L':'M'}${x(s).toFixed(2)},${y(s).toFixed(2)}`).join(' ');
  const segments=samples.slice(1).map((b,i)=>{const a=samples[i],g=Math.abs((b.meters-a.meters)/Math.max(1,(b.km-a.km)*1000)*100);return `<path d="M${x(a)},${y(a)} L${x(b)},${y(b)}" stroke="${g>=9?t.color.steep:g>=4?t.color.medium:t.color.low}"/>`;}).join('');
  host.innerHTML=`<div class="chart-title"><b>TERRAIN / 200 SAMPLES</b><span>GRADE <i style="color:${t.color.low}">0%</i> <i style="color:${t.color.medium}">4%</i> <i style="color:${t.color.steep}">9%+</i></span></div><svg class="elevation" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Elevation profile, ${lo} to ${hi} meters"><g class="chart-grid" stroke="${t.color.muted}" opacity="${t.chart.grid}">${[.25,.5,.75].map(p=>`<path d="M0,${H*p} H${W}"/>`).join('')}</g><path d="${path} L${W-pad},${H} L${pad},${H} Z" fill="${t.color.latest}" opacity="${t.chart.fill}"/><g fill="none" stroke-width="${t.chart.stroke}">${segments}</g><path class="cursor-line" stroke="${t.color.older}" stroke-width="${t.chart.cursor}"/><circle class="cursor-dot" r="3" fill="${t.color.latest}"/></svg><div class="chart-axis"><span>0 KM / ${lo} M</span><span>${km.toFixed(1)} KM / ${hi} M</span></div><div class="chart-data"><span>↑ ${Math.round(gain)} M GAIN</span><output></output></div><input class="chart-range" type="range" min="0" max="199" value="0" aria-label="Elevation cursor"/><small class="chart-note">Sampled terrain grade, not surveyed road grade</small>`;
  const svg=host.querySelector('.elevation'),range=host.querySelector('input');
  const setCursor=ratio=>{const index=Math.min(samples.length-1,Math.round(ratio*(samples.length-1))),s=samples[index],prev=samples[Math.max(0,index-1)];const grade=index?(s.meters-prev.meters)/Math.max(1,(s.km-prev.km)*1000)*100:0;
    host.querySelector('.cursor-line').setAttribute('d',`M${x(s)},0 V${H}`);host.querySelector('.cursor-dot').setAttribute('cx',x(s));host.querySelector('.cursor-dot').setAttribute('cy',y(s));
    host.querySelector('output').textContent=`${s.km.toFixed(1)} KM / ${s.meters} M / ${grade.toFixed(1)}%`;range.value=index;
  };
  svg.addEventListener('pointermove',e=>{const r=svg.getBoundingClientRect();onCursor(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));});
  range.addEventListener('input',()=>onCursor(Number(range.value)/199));setCursor(0);return {setCursor};
}
