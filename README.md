# MBRT

**MBRT** (Map Based Research Tool) is an interactive, chat-based mapping application that combines natural language processing with Mapbox GL JS to enable conversational map interactions. Built with agentic workflows using the ReAct pattern, the application interprets user queries and automatically visualizes geographic data on an interactive map.

## Features

### Natural Language Mapping

The application understands natural language queries and automatically classifies them into different workflow types:

- **Point Markers**: Add single or multiple location markers by asking "add marker on [location]" or "show me [city]"
- **Routes & Lines**: Generate routes between locations using Mapbox Directions API or draw direct lines connecting multiple points
- **Buffers & Geofences**: Create circular buffers around points with customizable radius (e.g., "add 10km buffer around this point")
- **Isochrones**: Visualize reachable areas within specified travel times or distances using different transportation modes
- **Polygons**: Draw custom polygons connecting multiple locations or coordinates
- **Elevation Profiles**: Display elevation charts along routes and lines using Mapbox terrain data and Plotly visualization rendered on the map. No seperate containers.

### Agentic Workflows

The application implements six specialized agents that follow a ReAct (Reason + Act) pattern:

1. **Point Agent**: Extracts and displays location coordinates from natural language queries
2. **Line Agent**: Handles route generation and direct line drawing between locations
3. **Buffer Agent**: Creates geofences and buffers around specified points
4. **Isochrone Agent**: Calculates and visualizes reachable areas based on travel time/distance
5. **Polygon Agent**: Draws custom polygons from coordinate sets
6. **Elevation Agent**: Generates elevation profiles along linear features

Each agent follows a multi-step workflow:
- Query type detection
- Coordinate extraction via Perplexity API
- Data validation and refinement
- Map visualization

### Command System

A comprehensive command system accessible via `@` prefix provides map control and feature management:

**Map Control**
- `@reset` / `@rs` / `@home`: Reset map to default view
- `@zoom [level]`: Set zoom level
- `@terrain`: Toggle 3D terrain visualization
- `@user location`: Get and display current location

**Style Management**
- `@dark` / `@light` / `@satellite` / `@streets`: Switch map styles
- `@navigation day` / `@navigation night`: Navigation-specific styles
- `@outdoors`: Outdoor recreation style

**Feature Management**
- `@clean` / `@cl`: Remove all features from map
- `@clean markers` / `@clean lines` / `@clean buffers`: Remove specific feature types
- `@feature`: Select and interact with existing map features

**Information**
- `@help` / `@h`: Show all available commands
- `@info` / `@i`: Display map status and feature counts

### Feature Selection

The `@feature` command enables interactive feature selection:

- View all currently displayed features (markers, lines, buffers, polygons, isochrones)
- Select features for use in subsequent operations (e.g., create buffer around selected point, generate elevation profile for selected line)
- Visual selection indicators highlight selected features on the map
- Real-time map navigation to selected features

### Visual Features

- **Custom Markers**: Numbered circular markers with blue theme
- **Route Visualization**: Color-coded routes with white stroke effects
- **Animated Buffers**: Dotted stroke animations for geofences
- **Elevation Charts**: Embedded Plotly charts displaying elevation profiles along routes
- **Selection Indicators**: Visual highlighting of selected features
- **Mobile Responsive**: Optimized for mobile devices with keyboard handling

## Technology Stack

- **Frontend**: Vanilla JavaScript, Vite
- **Mapping**: Mapbox GL JS v3.16.0
- **AI/ML**: Perplexity API (sonar model) for natural language processing
- **Visualization**: Plotly.js for elevation profiles
- **Build Tool**: Vite
- **Styling**: Custom CSS with Quantico font

## Project Structure

```
mapbox-mcp/
├── agents/              # Agentic workflow implementations
│   ├── pointAgent.js
│   ├── lineAgent.js
│   ├── bufferAgent.js
│   ├── isochroneAgent.js
│   ├── polygonAgent.js
│   └── elevationAgent.js
├── utils/               # Utility functions
│   ├── queryDetector.js       # Query type classification
│   ├── coordinateParser.js    # Coordinate extraction
│   ├── mapDisplay.js          # Map visualization
│   ├── commands.js            # Command system
│   ├── apiHelpers.js          # Perplexity API wrapper
│   └── elevationHelpers.js   # Elevation calculations
├── services/            # External API services
│   ├── directions.js         # Mapbox Directions API
│   └── isochrone.js          # Mapbox Isochrone API
├── app.js              # Main application entry point
├── config.js           # Configuration management
├── index.html          # HTML structure
└── styles.css          # Application styles
```

## Getting Started

### Prerequisites

- Node.js 18 or higher
- Mapbox Access Token (get from [Mapbox Account](https://account.mapbox.com/access-tokens/))
- Perplexity API Key (get from [Perplexity Settings](https://www.perplexity.ai/settings/api))

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mapbox-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your API keys
# MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
# PERPLEXITY_API_KEY=your_perplexity_key_here
```

Required environment variables:
- `MAPBOX_ACCESS_TOKEN`: Your Mapbox public access token (starts with `pk.`)
- `PERPLEXITY_API_KEY`: Your Perplexity API key (starts with `pplx-`)

4. Start the development server:
```bash
npm run dev
```

5. Open the application in your browser at the provided local URL (typically `http://localhost:8000`)

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Usage Examples

**Add a marker:**
```
add marker on New York
```

**Create a route:**
```
show me route from San Francisco to Los Angeles
```

**Create a buffer:**
```
add 50km buffer around this point
```

**Generate elevation profile:**
```
@feature
[Select a line]
show elevation profile
```

**Switch map style:**
```
@dark
@satellite
```

**Clean all features:**
```
@clean
```

## Architecture

The application follows an agentic workflow architecture where:

1. User input is classified by the query detector
2. Appropriate agent is selected based on query type
3. Agent follows ReAct pattern: Reason → Act → Reflect → Refine
4. Results are visualized on the map using Mapbox GL JS
5. Features are registered in a feature registry for selection and interaction

## Performance

The application includes performance tracking to monitor:
- API call latencies
- Query processing times
- Agent execution times
- Overall workflow duration

## License

ISC

