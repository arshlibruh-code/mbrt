export default {
  id: 'reticle', name: 'RETICLE / HUD', subtitle: 'Brackets, leaders, boxed readouts',
  color: { latest:'#089bdf', older:'#f1f2f3', waiting:'#efb654', error:'#e76859', ground:'#0c141d', panel:'#111b25', muted:'#96a8b8', hair:'#2a3d4d', casing:'#081019', low:'#089bdf', medium:'#efb654', steep:'#e76859' },
  type: { family:'Quantico', size:11, weight:700, tracking:'.035em', coordinateSize:9 },
  line: { route:3.2, straight:1.6, arc:2.2, casing:7, selected:6, boundary:1.4, area:1.2, dash:[3,2], arcDash:[7,2], glow:0, glowWidth:0, ticksKm:10, arrowKm:8, tickLengthKm:.18 },
  area: { buffer:.055, isochrone:.045, polygon:.12, boundary:.025, hatch:false, hatchSpacingKm:1.5, hatchLengthKm:.18, doubleBoundary:false },
  pin: { size:24, hoverScale:1.17, selectedScale:1.1, shape:'bracket', clusterDistance:38 },
  label: { box:true, leader:true, coordinates:false, gap:24, padding:5, width:165, priorityGap:5 },
  chart: { width:400, height:100, stroke:1.8, fill:.12, grid:.2, cursor:1 },
  motion: { duration:600, pinDrop:26, damping:8, fade:160 },
  sample: { heatRadius:24, extrusionMeters:650, compareOffset:7, measureWidth:1.5 },
};
