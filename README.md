# School Greening Dashboard 🌳🌍
https://cwh.surge.sh
The **School Greening Dashboard** is a sophisticated, data-driven web application for prioritizing environmental interventions in Los Angeles schools. It helps identify campuses that would benefit most from greening initiatives based on various environmental, climatic, and social factors.


## 🌟 Key Features

### 1. Weighted Scoring Engine
Located in the **"Scoring"** tab, this engine allows you to calculate a *Custom Greening Index* by adjusting weights for variables such as:
- **Infiltration Potential**
- **Canopy Heat Relief**
- **Community Opportunity**
The map and statistical leaderboard update dynamically as you tweak these parameters.

### 2. Multi-layered Data Visualization
Toggle between numerous regional datasets in the left sidebar to add context constraints. Included layers:
- CalEnviroScreen 5.0
- Tree Equity Score 
- USFS Tree Canopy Coverage
- Groundwater and Stormwater capture areas

### 3. Advanced Search & Granular Details
Search for specific schools (e.g., "Abraham Lincoln Elementary") to snap the map to their location. Clicking on schools opens the **"Feature Details"** panel, providing granular metrics—from soil infiltration capacity to park proximity.

### 4. Real-time Analytics & Leaderboard
The **"Statistics"** tab offers a live leaderboard ranking the top 20 schools according to the active metric, complemented by a distribution chart showing the spread of scores across the currently visible map area.


## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/michaelaadamsjr/CWH-Dashboard.git
   ```
2. Navigate into the project directory:
   ```bash
   cd CWH-Dashboard
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

### Running the Application Local
To start the local development server, run:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

### Building for Production
To build the app for production use:
```bash
npm run build
```
The optimized files will be output to the `dist/` folder.

## 🛠 Built With
- **React** & **Vite**
- **Leaflet** & **React-Leaflet** (for interactive mapping)
- **Chart.js** (for analytical distributions)
- **TopoJSON Client** (for vector processing)

---
*Created for the Council for Watershed Health.*
