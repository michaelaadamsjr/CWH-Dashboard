# School Greening Dashboard: User Tutorial

Welcome to the School Greening Dashboard! This interactive tool helps identify and prioritize schools for greening interventions (like tree planting and stormwater capture) across Los Angeles. 

Here is a quick guide on how to navigate the platform and make the most out of its features.

---

## 1. The Interactive Map
The map is the heart of the dashboard. The primary layer represents campuses containing the entire California School Campus Database (CSCD) dataset, which is the main polygon dataset of this application. Other layers and colors represent the underlying environmental or social data.

- **Navigation:** Click and drag to pan around. Scroll to zoom in and out. 
- **Search:** Use the search bar to find a specific school (e.g., "Abraham Lincoln Elementary") and snap the map right to it.
- **Hover & Click:** Hover over a school to see its name and basic information. Click on a school to bring up its **Feature Details** on the right side panel.
- **Clustering:** When zoomed out, schools and trees group into clusters. Click a cluster or zoom in to break them apart.

## 2. Left Sidebar: Data Layers
The left panel controls what you see on the map. It allows you to toggle multiple regional datasets on and off to add geographic context.

### Distinct Layer Types:
- **Schools & Parks:** Toggle the entire CSCD dataset (the main polygon dataset), specific greening opportunity sites (like GSA sites), and existing parks.
- **Environmental & Social Constraints (Datasets):** Turn on layers like CalEnviroScreen 5.0 (pollution burden) and Tree Equity Score to visualize community need.
- **Water Infrastructure (Storm Drain Networks):** View granular data like catch basins, gravity mains, and open channels to understand stormwater capture boundaries.
- **Boundaries:** Turn on watershed boundaries and local subbasins for regional context.

*Tip: You can switch your basemap between Light, Dark, and Satellite at the top of the layer list!*

## 3. Right Sidebar: Action Panels
The right panel contains four distinct tabs that control analysis and display data. 

### A. Feature Details Tab
When you click a school on the map, this tab populates with highly granular metrics about that specific campus. 
- **What it shows:** Soil infiltration capacity, proximity to parks, current tree canopy percentage, pollution burden, etc.
- **Co-located Schools:** If multiple schools share a campus, this panel aggregates them so you can see all relevant data in one place instead of clicking overlapping points.

### B. Scoring Tab (The Engine)
This is the most powerful feature of the dashboard. It allows you to calculate a **Custom Greening Index**.
- **Sliding Weights:** You will see sliders representing different variables: *Infiltration Potential*, *Canopy Heat Relief*, *Community Opportunity*, etc.
- **How to use:** Adjust the sliders to reflect your organization's priorities (they must sum to 100%). 
- **Real-time Map Updates:** The moment you finish adjusting the weights, the map recolors the schools, highlighting the locations that best fit your custom criteria.

### C. Statistics Tab
Used in tandem with the map and scoring engine, this tab gives you a high-level view of your current map viewport.
- **Leaderboard:** Ranks the top 20 schools in the current view area based on your active custom score.
- **Distribution Chart:** A dynamic histogram that shows the mathematical spread of scores for all schools currently visible on the screen.

### D. Definitions Tab
Not sure what a specific term means? The definitions tab acts as a glossary for all the environmental, climatic, and social variables used in the dashboard.

---

## Quick Start Example: Prioritizing Shade

1. Open the **Left Sidebar** and turn on the `Tree Equity Score` layer.
2. Open the **Right Sidebar** and click the **Scoring** tab.
3. Slide **Canopy Heat Relief** up to `60%`. 
4. Slide **Community Opportunity** to `40%`, and drop the remaining sliders to `0%`.
5. Watch the map automatically recolor to highlight schools in high-need neighborhoods lacking shade.
6. Click the **Statistics** tab to see your newly generated Top 20 leaderboard for shade-intervention candidates!
