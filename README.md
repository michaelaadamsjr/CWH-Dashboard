# School Greening Dashboard

Live site: [cwh.surge.sh](https://cwh.surge.sh)

[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E)](https://vitejs.dev/)
[![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=Leaflet&logoColor=white)](https://leafletjs.com/)

The **School Greening Dashboard** is a sophisticated, data-driven web application for prioritizing environmental interventions in Los Angeles schools. It helps identify campuses that would benefit most from greening initiatives based on various environmental, climatic, and social factors. Created for the **Council for Watershed Health**.

---

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Built With](#architecture--built-with)
- [Getting Started](#getting-started)
- [Deployment](#deployment)

---

## Overview

The purpose of this project is to provide a comprehensive, interactive map interface that helps researchers, urban planners, and the Council for Watershed Health identify schools with the highest need and best opportunities for greening projects. By overlaying multiple datasets and allowing custom weighting strategies, this tool empowers data-informed decision making.

> [!TIP]
> **New User?** Check out our detailed [User Tutorial](TUTORIAL.md) to learn how to navigate the map, toggle layers, and build custom scoring scenarios.

## Key Features

### 1. Weighted Scoring Engine
Located in the **Scoring** tab, this engine allows you to calculate a *Custom Greening Index* by dynamically adjusting weights for key variables:
- **Infiltration Potential:** Likelihood of successful stormwater capture.
- **Canopy Heat Relief:** Need for shade based on current canopy coverage and urban heat island effects.
- **Community Opportunity:** Social vulnerability metrics and community need indicators.

The map and statistical leaderboard update in real-time as these parameters are adjusted.

### 2. Multi-layered Data Visualization
Toggle between numerous regional datasets in the left sidebar to add context and constraints to the analysis. Current included spatial layers:
- CalEnviroScreen 5.0
- Tree Equity Score 
- USFS Tree Canopy Coverage
- Groundwater and Stormwater capture areas
- Water quality subbasins and watershed boundaries
- Detailed Storm Drain Networks (Catch Basins, Gravity Mains, Open Channels)

### 3. Advanced Search & Granular Details
Search for specific schools (e.g., "Abraham Lincoln Elementary") to snap the map directly to their location. Clicking on schools or interacting with map elements opens the **Feature Details** panel, providing granular metrics ranging from soil infiltration capacity to park proximity.

### 4. Real-time Analytics & Leaderboard
The **Statistics** tab offers a live leaderboard ranking the top 20 schools according to the active metric. This is complemented by a responsive distribution chart showing the spread of scores across the currently visible map area.

---

## Architecture & Built With

This application employs a modern web development stack optimized for performance with large spatial datasets:
- **Frontend Core:** React & Vite
- **Interactive Mapping:** Leaflet & React-Leaflet
- **Data Visualizations:** Chart.js
- **Spatial Processing:** TopoJSON Client and highly-optimized custom binary data buffers to improve load times for massive polygon and line network datasets.

---

## Getting Started

For a comprehensive guide on how to navigate the application, configure data layers, and build custom scoring scenarios, please see our detailed [User Tutorial](TUTORIAL.md).

---

## Deployment

To build the app for production:
```bash
npm run build
```
The optimized HTML, CSS, JavaScript, and binary data assets will be generated in the `dist/` directory.

---
*Created for the Council for Watershed Health.*
