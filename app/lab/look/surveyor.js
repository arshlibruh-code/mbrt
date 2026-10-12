export default {
  id:'surveyor', name:'SURVEYOR', subtitle:'Crosshairs, chainage, field coordinates',
  color: { latest:'#089bdf', older:'#ffffff', waiting:'#efb654', error:'#e76859', ground:'#101715', panel:'#17201c', muted:'#b0beb4', hair:'#34443a', casing:'#101713', low:'#089bdf', medium:'#efb654', steep:'#e76859' },
  type: { family:'Quantico', size:11, weight:400, tracking:'.015em', coordinateSize:9 },
  line: { route:2.4, straight:1.3, arc:1.6, casing:6, selected:5, boundary:1, area:1, dash:[6,3], arcDash:[2,2], glow:0, glowWidth:0, ticksKm:5, arrowKm:10, tickLengthKm:.25 },
  area: { buffer:.018, isochrone:.025, polygon:.065, boundary:.018, hatch:true, hatchSpacingKm:1.7, hatchLengthKm:.28, doubleBoundary:true },
  pin: { size:24, hoverScale:1.12, selectedScale:1.08, shape:'crosshair', clusterDistance:38 },
  label: { box:false, leader:true, coordinates:true, gap:25, padding:3, width:165, priorityGap:5 },
  chart: { width:400, height:100, stroke:1.2, fill:.04, grid:.3, cursor:1 },
  motion: { duration:600, pinDrop:18, damping:8, fade:160 },
  sample: { heatRadius:20, extrusionMeters:650, compareOffset:6, measureWidth:1 },
};
