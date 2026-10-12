import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as turf from '@turf/turf';
const root=fileURLToPath(new URL('.',import.meta.url));
const fixture=JSON.parse(await readFile(root+'fixture.json','utf8'));
assert.equal(fixture.elevation.samples.length,200);
assert.equal(fixture.features.features.filter(f=>f.properties.kind==='marker').length,5);
assert.deepEqual(fixture.features.features.filter(f=>f.properties.kind==='isochrone').map(f=>f.properties.minutes).sort((a,b)=>a-b),[10,20,30]);
assert(fixture.elevation.samples.every(s=>Number.isFinite(s.meters)&&s.coordinate.length===2));
const boundary=fixture.features.features.find(f=>f.id==='boundary');
assert.equal(boundary.properties.addressType,'county');
assert(boundary.properties.km2>1&&boundary.properties.km2<1000);
const route=fixture.features.features.find(f=>f.id==='route');
assert(turf.distance(route.geometry.coordinates.at(-1),fixture.places.nandi.coord)<1);
assert.equal(fixture.places.nandi.publishedName,'Nandi Hill');
for(const key of ['route','height','isochrone','boundary'])assert(fixture.provenance.some(p=>p.name===key));
const globalRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||pathToFileURL(globalRoot+'/playwright/index.mjs').href);
const output=process.env.LAB_SCREENSHOTS||`${process.env.HOME}/Desktop/screenshots`;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1536,height:1100},deviceScaleFactor:1});
await context.routeWebSocket(/localhost:5173/,socket=>{socket.onMessage(()=>{});socket.send(JSON.stringify({type:'connected'}));});
const page=await context.newPage();
const errors=[],layerErrors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('net::'))layerErrors.push(m.text());});
async function settled(){await page.waitForFunction(()=>window.mbrtLab?.panels.every(p=>p.map.getSource('lab-features')&&p.map.isStyleLoaded()),{timeout:30000});await page.waitForTimeout(400);}
try {
  // External resources are blocked in this pass to prove the local font and fixture path.
  await context.route(/https?:\/\/(?!localhost:5173)/,route=>route.abort());
  await page.goto('http://localhost:5173/lab.html');
  await page.locator('[data-base="OFFLINE"]').click();await settled();
  assert.equal(await page.locator('.panel').count(),3);
  assert(await page.evaluate(()=>document.fonts.check('11px Quantico')));
  assert(await page.evaluate(()=>window.mbrtLab.panels.every(p=>p.map.getSource('lab-features').serialize().data.features.length>=13)));
  await page.screenshot({path:output+'/mbrt-lab-city.png',fullPage:true});
  await page.evaluate(()=>window.mbrtLab.panels[0].map.jumpTo({center:[77.62,13.14],zoom:10.4,bearing:17,pitch:22}));await page.waitForTimeout(500);
  const cams=await page.evaluate(()=>window.mbrtLab.panels.map(p=>[...p.map.getCenter().toArray(),p.map.getZoom(),p.map.getBearing(),p.map.getPitch()]));
  for(const c of cams.slice(1))for(let i=0;i<c.length;i++)assert(Math.abs(c[i]-cams[0][i])<.000001);
  await page.locator('[data-id="buffer"]').click();assert.equal(await page.evaluate(()=>window.mbrtLab.state.selected),'buffer');
  assert(await page.evaluate(()=>window.mbrtLab.panels.every(p=>p.map.getFilter('lab-selected')[2]==='buffer')));
  await page.locator('.chart-range').first().fill('160');
  const chartValues=await page.locator('.chart-data output').allTextContents();assert.equal(new Set(chartValues).size,1);
  assert(await page.evaluate(()=>window.mbrtLab.panels.every(p=>p.map.getSource('lab-cursor').serialize().data.features.length===1)));
  await page.locator('#numbers').uncheck();const less=await page.locator('.number-marker').count();await page.locator('#numbers').check();assert(await page.locator('.number-marker').count()>less);
  const moving=await page.evaluate(()=>{const start=performance.now();for(const p of window.mbrtLab.panels)p.renderer.replay(start);return window.mbrtLab.panels[0].map.getSource('lab-features').serialize().data.features.find(f=>f.id==='route').geometry.coordinates.length;});
  assert(moving<route.geometry.coordinates.length);
  await page.waitForTimeout(900);assert.equal(await page.evaluate(()=>window.mbrtLab.panels[0].map.getSource('lab-features').serialize().data.features.find(f=>f.id==='route').geometry.coordinates.length),route.geometry.coordinates.length);
  await page.locator('.time-range').first().fill('10');await page.waitForTimeout(200);
  assert(await page.evaluate(()=>window.mbrtLab.panels.every(p=>p.map.getSource('lab-features').serialize().data.features.filter(f=>f.properties.kind==='isochrone').length===1)));
  await page.locator('.time-range').first().fill('30');
  for(const [sample,layer]of [['heatmap','heat'],['extrusion','extrusion'],['compare','compare'],['measure','measure']]){
    await page.locator(`[data-sample="${sample}"]`).first().click();await page.waitForTimeout(500);
    assert(await page.evaluate(id=>window.mbrtLab.panels.every(p=>p.map.getLayoutProperty('lab-'+id,'visibility')==='visible'),layer));
  }
  await page.screenshot({path:output+'/mbrt-lab-detail.png',fullPage:true});
  await page.locator('[data-camera="WORLD"]').click();await page.waitForTimeout(600);
  assert(await page.evaluate(()=>window.mbrtLab.panels.every(p=>p.map.getSource('lab-features').serialize().data.features.length===1&&p.map.getSource('lab-features').serialize().data.features[0].id==='arc')));
  await page.screenshot({path:output+'/mbrt-lab-world.png',fullPage:true});
  // Style reconstruction uses a local style, so this also runs without a tile service.
  await page.evaluate(()=>{for(const p of window.mbrtLab.panels)p.map.setStyle({version:8,sources:{},layers:[{id:'ground-2',type:'background',paint:{'background-color':'#17212a'}}]});});await settled();
  await page.locator('[data-camera="CITY"]').click();await page.waitForTimeout(600);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:output+'/mbrt-lab-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(layerErrors,[]);
  const result={ok:true,checks:['real fixture','offline resources','three renderers','camera sync','selection sync','chart cursor','numbers','arrival path','time contours','future slots','world arc','style reconstruction','mobile width','no runtime or GL validation errors'],screenshots:output};
  await writeFile(output+'/mbrt-lab-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally {await browser.close();}
