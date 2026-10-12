// The model's whole job: turn one chat message into exactly one of these calls.
// Places stay as names; the geocoder resolves them, never the model.

const place = { type: "string", description: 'A place name as the user meant it, e.g. "Koramangala, Bengaluru". "@selected" = the feature the user picked on the map, "@me" = the user\'s location.' };
const places = { type: "array", items: place };
const profile = { type: "string", enum: ["driving", "walking", "cycling"] };

const tool = (name, description, properties, required) => ({
  name,
  description,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export const TOOLS = [
  tool("markers", "Drop pins on one or more places. Also for 'where is X' and 'top N places in Y' (pick the N places yourself).",
    { places }, ["places"]),
  tool("route", "Road or path route through waypoints in travel order. Also for travel distance or time between places.",
    { waypoints: places, profile }, ["waypoints", "profile"]),
  tool("line", "Straight line segments joining places in order (as the crow flies, not a road route).",
    { places }, ["places"]),
  tool("buffer", "Circle of a fixed radius around each center. radius_km has one value per center, or a single value for all. Convert miles and metres to km.",
    { centers: places, radius_km: { type: "array", items: { type: "number" } } }, ["centers", "radius_km"]),
  tool("isochrone", "Area reachable from a center within a travel time (unit minutes) or travel distance (unit km). One value per contour.",
    { center: place, profile, unit: { type: "string", enum: ["minutes", "km"] }, values: { type: "array", items: { type: "number" } } },
    ["center", "profile", "unit", "values"]),
  tool("polygon", "Filled polygon whose vertices are the given places.",
    { vertices: places }, ["vertices"]),
  tool("elevation_profile", "Height profile along a line. Use waypoints ['@selected'] for a line the user picked, else the route waypoints.",
    { waypoints: places, profile }, ["waypoints", "profile"]),
  tool("boundary", "Official administrative outline of a named region (country, state, district, city).",
    { place }, ["place"]),
  tool("map", "Change the map itself: style (street, satellite, dark), zoom level, center on coordinates, toggle 3D terrain, clear layers, or locate the user.",
    {
      action: { type: "string", enum: ["style", "zoom", "center", "terrain", "clear", "locate"] },
      style: { type: "string", enum: ["street", "satellite", "dark"] },
      zoom: { type: "number" },
      lat: { type: "number" },
      lon: { type: "number" },
      clear: { type: "string", enum: ["all", "markers", "routes", "lines", "buffers", "isochrones", "polygons"] },
    }, ["action"]),
  tool("reply", "No map action fits: the request is missing something (clarify), asks for something this map cannot do (unsupported), or is small talk (chat).",
    { kind: { type: "string", enum: ["clarify", "unsupported", "chat"] }, text: { type: "string" } }, ["kind", "text"]),
];

export const SYSTEM = `You control a map. Answer every message by calling exactly one tool, never with plain text.
Keep place names as the user wrote them, adding the city or region when it is obvious, and never invent coordinates.
"here" or "my location" means "@me"; "this point", "this line" or "the selected one" means "@selected".
Default profile is driving.`;
