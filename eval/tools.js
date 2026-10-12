// The model's whole job: turn one chat message into one of these calls (a plan for several steps).
// Places stay as names; the geocoder resolves them, never the model.

const place = { type: "string", description: 'A place name as the user meant it, e.g. "Koramangala, Bengaluru". "@selected" = the feature the user picked on the map, "@me" = the user\'s location.' };
const places = { type: "array", items: place, minItems: 1 };
const trip = { ...places, minItems: 2 }; // a route or line needs two ends; with fewer, reply clarify
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
    { waypoints: trip, profile }, ["waypoints", "profile"]),
  tool("line", "Straight line segments joining places in order (as the crow flies, not a road route).",
    { places: trip }, ["places"]),
  tool("buffer", "Circle of a fixed radius around each center. radius_km has one value per center, or a single value for all. Convert miles and metres to km.",
    { centers: places, radius_km: { type: "array", items: { type: "number" } } }, ["centers", "radius_km"]),
  tool("isochrone", "Area reachable from a center within a travel time (unit minutes) or travel distance (unit km). One value per contour.",
    { center: place, profile, unit: { type: "string", enum: ["minutes", "km"] }, values: { type: "array", items: { type: "number" } } },
    ["center", "profile", "unit", "values"]),
  tool("polygon", "Filled polygon whose vertices are the given places.",
    { vertices: { ...places, minItems: 3 } }, ["vertices"]),
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
  tool("plan", "The request needs two or more map actions (or the user says \"do it\" to several things you proposed). Write each step as a short standalone request that names its places and numbers, in the order to run them.",
    { steps: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 } }, ["steps"]),
  tool("reply", "No map action fits: the request is missing something (clarify), asks for something this map cannot do (unsupported), or is small talk (chat). When you propose ideas, put up to 3 ready-to-run map requests in suggestions, each under 8 words with real places and numbers, like \"15 min walk from Cubbon Park\".",
    {
      kind: { type: "string", enum: ["clarify", "unsupported", "chat"] },
      text: { type: "string" },
      suggestions: { type: "array", items: { type: "string" }, maxItems: 3 },
    }, ["kind", "text"]),
];

export const SYSTEM = `You control a map. Answer every message by calling exactly one tool, never with plain text.
When the message asks for two or more map actions, call plan with one step per action.
Earlier turns show what you did and what came of it; "it", "that", "there" and "now make it..." refer to them.
Keep place names as the user wrote them, adding the city or region when it is obvious, and never invent coordinates.
"here" or "my location" means "@me"; "this point", "this line" or "the selected one" means "@selected".
If the message is missing a place or number the tool needs, call reply with kind "clarify". Use "@me" or "@selected" only when the user's words point to them.
Default profile is driving.`;

// One shape for the app server and the eval, so the model always sees the same thing.
// history: up to 3 earlier turns, each {user, calls: [{tool, args, result}]}; context: what the map shows now.
export const MAX_CALLS = 5;
export function chatMessages({ message, history = [], context = {} }) {
  const view = [
    context.near && `The map is centered near ${context.near} (zoom ${context.zoom}).`,
    context.selected && `Selected on the map: ${context.selected}.`,
    context.me && `The user's location is known, so "@me" works.`,
  ].filter(Boolean);
  const messages = [{ role: "system", content: [SYSTEM, ...view].join("\n") }];
  history.forEach((turn, t) => {
    messages.push({ role: "user", content: turn.user });
    const ids = turn.calls.map((_, i) => `call_${t}_${i}`);
    messages.push({ role: "assistant", content: "", tool_calls: turn.calls.map((c, i) => ({ id: ids[i], type: "function", function: { name: c.tool, arguments: JSON.stringify(c.args) } })) });
    turn.calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: ids[i], content: c.result || "done" }));
  });
  messages.push({ role: "user", content: message });
  return messages;
}
