// Copied from main.js for isolation. Share these constants with the app after a look is chosen.
const glyphs = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const STYLES = {
  DARK:'https://tiles.openfreemap.org/styles/dark',
  MAP:'https://tiles.openfreemap.org/styles/liberty',
  SAT:{version:8,glyphs,sources:{
    sat:{type:'raster',tileSize:256,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],maxzoom:18,attribution:'© Esri, Vantor, Earthstar Geographics'},
    labels:{type:'raster',tileSize:256,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],maxzoom:18},
  },layers:[{id:'sat',type:'raster',source:'sat'},{id:'sat-labels',type:'raster',source:'labels'}]},
  OFFLINE:{version:8,sources:{},layers:[{id:'ground',type:'background',paint:{'background-color':'#111923'}}]},
};
export const SKY = {'sky-color':'#88C6FC','sky-horizon-blend':.8,'horizon-color':'#ffffff','horizon-fog-blend':.8,'fog-color':'#88C6FC','fog-ground-blend':.5,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,1,1,12,0]};
export const SKY_DARK = {...SKY,'sky-color':'#0d1b2a','horizon-color':'#3a5068','fog-color':'#0d1b2a'};
