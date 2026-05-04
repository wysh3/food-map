import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';

const TILE_SERVER_URL = import.meta.env.VITE_TILE_SERVER_URL || 'http://localhost:3000';

// Indian cities coordinates
const CITIES = {
  mumbai: { center: [72.8777, 19.0760], zoom: 11 },
  delhi: { center: [77.2090, 28.6139], zoom: 11 },
  bangalore: { center: [77.5946, 12.9716], zoom: 11 },
  hyderabad: { center: [78.4867, 17.3850], zoom: 11 },
  chennai: { center: [80.2707, 13.0827], zoom: 11 },
  pune: { center: [73.8567, 18.5204], zoom: 11 },
  kolkata: { center: [88.3639, 22.5726], zoom: 11 },
  india: { center: [78.9629, 20.5937], zoom: 5 }
};

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const popup = useRef(null);
  const [stats, setStats] = useState(null);
  const [performance, setPerformance] = useState({ fps: 60, tileCount: 0 });
  const [selectedCity, setSelectedCity] = useState('india');

  useEffect(() => {
    // Fetch stats
    fetch(`${TILE_SERVER_URL}/api/stats`)
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error('Failed to fetch stats:', err));
  }, []);

  useEffect(() => {
    if (map.current) return; // Initialize map only once

    // Create popup
    popup.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: '300px'
    });

    // Initialize map
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          },
          'restaurants': {
            type: 'vector',
            tiles: [`${TILE_SERVER_URL}/tiles/{z}/{x}/{y}.mvt`],
            minzoom: 6,
            maxzoom: 18
          }
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#f8f9fa'
            }
          },
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            paint: {
              'raster-opacity': 0.7
            }
          },
          {
            id: 'restaurant-clusters',
            type: 'circle',
            source: 'restaurants',
            'source-layer': 'restaurants',
            filter: ['==', ['get', 'type'], 'cluster'],
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['get', 'count'],
                10, 20,
                50, 30,
                100, 40,
                500, 50,
                1000, 60
              ],
              'circle-color': [
                'interpolate',
                ['linear'],
                ['get', 'count'],
                10, '#FED766',
                50, '#FE9920',
                100, '#FE6B35',
                500, '#F94144'
              ],
              'circle-opacity': 0.8,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff'
            }
          },

          {
            id: 'restaurant-points',
            type: 'circle',
            source: 'restaurants',
            'source-layer': 'restaurants',
            filter: ['==', ['get', 'type'], 'restaurant'],
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13, 6,
                16, 10,
                18, 14
              ],
              'circle-color': [
                'interpolate',
                ['linear'],
                ['get', 'rating'],
                0, '#94A3B8',
                3, '#60A5FA',
                4, '#34D399',
                5, '#10B981'
              ],
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff'
            }
          }
        ]
      },
      center: CITIES.india.center,
      zoom: CITIES.india.zoom,
      maxZoom: 18,
      minZoom: 4
    });

    // Add navigation controls
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add scale control
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    // Click handler for restaurant points
    map.current.on('click', 'restaurant-points', async (e) => {
      if (e.features.length === 0) return;

      const feature = e.features[0];
      const { id, name, cuisine, rating, city } = feature.properties;

      // Fetch full details
      try {
        const response = await fetch(`${TILE_SERVER_URL}/api/restaurants/${id}`);
        const restaurant = await response.json();

        const html = `
          <div style="padding: 8px;">
            <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #1e293b;">${restaurant.name}</h3>
            <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">
              <strong>Cuisine:</strong> ${restaurant.cuisine}
            </div>
            <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">
              <strong>Rating:</strong> ⭐ ${restaurant.rating}/5
            </div>
            <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">
              <strong>Location:</strong> ${restaurant.area}, ${restaurant.city}
            </div>
            <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">
              ${restaurant.lat.toFixed(4)}, ${restaurant.lon.toFixed(4)}
            </div>
          </div>
        `;

        popup.current
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map.current);
      } catch (err) {
        console.error('Failed to fetch restaurant details:', err);
      }
    });

    // Change cursor on hover
    map.current.on('mouseenter', 'restaurant-points', () => {
      map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'restaurant-points', () => {
      map.current.getCanvas().style.cursor = '';
    });

  }, []);

  const flyToCity = (cityKey) => {
    const city = CITIES[cityKey];
    map.current.flyTo({
      center: city.center,
      zoom: city.zoom,
      duration: 2000
    });
    setSelectedCity(cityKey);
  };

  return (
    <div className="app">
      <div ref={mapContainer} className="map-container" />
      
      {/* Header */}
      <div className="header">
        <h1>🍽️ Food Delivery Map</h1>
        <p>Vector Tiles + Server-Side Clustering</p>
      </div>

      {/* City selector */}
      <div className="city-selector">
        <h3>Jump to City:</h3>
        <div className="city-buttons">
          {Object.keys(CITIES).map(cityKey => (
            <button
              key={cityKey}
              onClick={() => flyToCity(cityKey)}
              className={selectedCity === cityKey ? 'active' : ''}
            >
              {cityKey.charAt(0).toUpperCase() + cityKey.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats panel */}
      {stats && (
        <div className="stats-panel">
          <h3>📊 Statistics</h3>
          <div className="stat">
            <span className="label">Total Restaurants:</span>
            <span className="value">{parseInt(stats.total_restaurants).toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="label">Cities:</span>
            <span className="value">{stats.total_cities}</span>
          </div>
          <div className="stat">
            <span className="label">Avg Rating:</span>
            <span className="value">⭐ {parseFloat(stats.avg_rating).toFixed(2)}</span>
          </div>
          <div className="stat">
            <span className="label">Active:</span>
            <span className="value">{parseInt(stats.active_restaurants).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Performance monitor */}
      <div className="performance-panel">
        <h3>⚡ Performance</h3>
        <div className="stat">
          <span className="label">Status:</span>
          <span className="value">Live</span>
        </div>
      </div>

      {/* Legend */}
      <div className="legend">
        <h3>Legend</h3>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#F94144' }}></div>
          <span>Cluster (500+)</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#FE6B35' }}></div>
          <span>Cluster (100-500)</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#10B981' }}></div>
          <span>Restaurant (4.5+ ⭐)</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#60A5FA' }}></div>
          <span>Restaurant (3-4 ⭐)</span>
        </div>
      </div>

      {/* Instructions */}
      <div className="instructions">
        <p>💡 <strong>Tip:</strong> Zoom in to see clusters break apart into individual restaurants. Click any restaurant for details.</p>
      </div>
    </div>
  );
}

export default App;
