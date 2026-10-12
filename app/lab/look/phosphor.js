export default {
  id:'phosphor', name:'PHOSPHOR', subtitle:'Luminous trace, sparse numerical signal',
  color: { latest:'#089bdf', older:'#e8f6f4', waiting:'#efb654', error:'#e76859', ground:'#0a1418', panel:'#0e1d22', muted:'#97b8bc', hair:'#24454b', casing:'#071419', low:'#089bdf', medium:'#efb654', steep:'#e76859' },
  type: { family:'Quantico', size:11, weight:400, tracking:'.06em', coordinateSize:9 },
  line: { route:2, straight:1.2, arc:1.7, casing:5, selected:4, boundary:1, area:1, dash:[1,3], arcDash:[9,2], glow:3, glowWidth:10, ticksKm:10, arrowKm:12, tickLengthKm:.14 },
  area: { buffer:.045, isochrone:.04, polygon:.07, boundary:.025, hatch:false, hatchSpacingKm:1.5, hatchLengthKm:.18, doubleBoundary:false },
  pin: { size:22, hoverScale:1.2, selectedScale:1.13, shape:'trace', clusterDistance:38 },
  label: { box:false, leader:false, coordinates:false, gap:21, padding:3, width:160, priorityGap:7 },
  chart: { width:400, height:100, stroke:1.5, fill:.08, grid:.13, cursor:1 },
  motion: { duration:600, pinDrop:22, damping:8, fade:160 },
  sample: { heatRadius:30, extrusionMeters:650, compareOffset:7, measureWidth:1.2 },
};
