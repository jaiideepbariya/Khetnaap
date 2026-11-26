// 1. Initialize map centered on Central India (Madhya Pradesh)
const map = L.map('map').setView([22.7196, 75.8577], 16);

// 2. Free Satellite Tiles (Esri World Imagery) + Village/Road Labels Overlay
const satelliteLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Tiles © Esri' }
).addTo(map);

const labelsLayer = L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19 }
).addTo(map);

// 3. Layer group to hold drawn field polygons
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// 4. Configure Leaflet.draw polygon tool
const drawControl = new L.Control.Draw({
  edit: { featureGroup: drawnItems, remove: true },
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: '#facc15', weight: 3, fillOpacity: 0.25 }
    },
    polyline: false,
    rectangle: false,
    circle: false,
    marker: false,
    circlemarker: false
  }
});
map.addControl(drawControl);

let currentSqMeters = 0;
let currentGeoJSON = null;

// 5. Calculate Area & Perimeter with Turf.js
function updateMeasurements(layer) {
  currentGeoJSON = layer.toGeoJSON();
  currentSqMeters = turf.area(currentGeoJSON);

  // Convert polygon ring to line to compute perimeter in meters
  const line = turf.polygonToLine(currentGeoJSON);
  const perimeterKm = turf.length(line, { units: 'kilometers' });
  const perimeterMeters = perimeterKm * 1000;

  const acres = currentSqMeters / 4046.85642;
  const hectares = currentSqMeters / 10000;
  const bighaFactor = parseFloat(document.getElementById('bigha-preset').value);
  const bigha = currentSqMeters / bighaFactor;

  document.getElementById('area-acres').textContent = acres.toFixed(2);
  document.getElementById('area-hectares').textContent = hectares.toFixed(2);
  document.getElementById('area-bigha').textContent = bigha.toFixed(2);
  document.getElementById('area-sqm').textContent = Math.round(currentSqMeters).toLocaleString();
  document.getElementById('perimeter-m').textContent = `${Math.round(perimeterMeters)} m`;
}

function resetMeasurements() {
  currentSqMeters = 0;
  currentGeoJSON = null;
  document.getElementById('area-acres').textContent = '0.00';
  document.getElementById('area-hectares').textContent = '0.00';
  document.getElementById('area-bigha').textContent = '0.00';
  document.getElementById('area-sqm').textContent = '0';
  document.getElementById('perimeter-m').textContent = '0 m';
}

// Drawing events
map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers(); // Keep one active plot at a time
  drawnItems.addLayer(e.layer);
  updateMeasurements(e.layer);
});

map.on(L.Draw.Event.EDITED, (e) => {
  e.layers.eachLayer((layer) => updateMeasurements(layer));
});

map.on(L.Draw.Event.DELETED, () => resetMeasurements());

// Recalculate Bigha when state preset changes
document.getElementById('bigha-preset').addEventListener('change', () => {
  const layers = drawnItems.getLayers();
  if (layers.length > 0) updateMeasurements(layers[0]);
});

// 6. Live GPS Location Finder
document.getElementById('locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('GPS is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 18);
      L.circleMarker([latitude, longitude], {
        radius: 7, color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1
      }).addTo(map).bindPopup('You are here').openPopup();
    },
    () => alert('Unable to fetch GPS. Make sure location permission is enabled over HTTPS.'),
    { enableHighAccuracy: true }
  );
});

// 7. Save & Load Plots using localStorage
function renderSavedPlots() {
  const saved = JSON.parse(localStorage.getItem('khetnaap_plots') || '[]');
  const container = document.getElementById('saved-list');
  container.innerHTML = '';

  saved.forEach((plot, index) => {
    const div = document.createElement('div');
    div.className = 'saved-item';
    div.innerHTML = `
      <span><strong>${plot.name}</strong> — ${plot.acres} Acres (${plot.bigha} Bigha)</span>
      <div>
        <button onclick="loadPlot(${index})">View</button>
        <button onclick="deletePlot(${index})">✕</button>
      </div>
    `;
    container.appendChild(div);
  });
}

document.getElementById('save-btn').addEventListener('click', () => {
  if (!currentGeoJSON || currentSqMeters === 0) {
    alert('Draw a field boundary on the map first!');
    return;
  }
  const name = document.getElementById('plot-name').value.trim() || `Khet #${Date.now().toString().slice(-4)}`;
  const saved = JSON.parse(localStorage.getItem('khetnaap_plots') || '[]');

  saved.unshift({
    name,
    acres: document.getElementById('area-acres').textContent,
    bigha: document.getElementById('area-bigha').textContent,
    geojson: currentGeoJSON
  });

  localStorage.setItem('khetnaap_plots', JSON.stringify(saved));
  document.getElementById('plot-name').value = '';
  renderSavedPlots();
});

window.loadPlot = (index) => {
  const saved = JSON.parse(localStorage.getItem('khetnaap_plots') || '[]');
  const plot = saved[index];
  if (!plot) return;

  drawnItems.clearLayers();
  const layer = L.geoJSON(plot.geojson, {
    style: { color: '#facc15', weight: 3, fillOpacity: 0.25 }
  }).getLayers()[0];

  drawnItems.addLayer(layer);
  map.fitBounds(layer.getBounds());
  updateMeasurements(layer);
};

window.deletePlot = (index) => {
  const saved = JSON.parse(localStorage.getItem('khetnaap_plots') || '[]');
  saved.splice(index, 1);
  localStorage.setItem('khetnaap_plots', JSON.stringify(saved));
  renderSavedPlots();
};

document.getElementById('clear-btn').addEventListener('click', () => {
  drawnItems.clearLayers();
  resetMeasurements();
});

renderSavedPlots();

// 8. Free OpenStreetMap Nominatim Place / Village Search
const searchInput = document.getElementById('place-search-input');
const searchBtn = document.getElementById('place-search-btn');
let searchMarker = null;

async function searchPlace() {
  const query = searchInput.value.trim();
  if (!query) {
    alert('Please enter a village, town, or area name.');
    searchInput.focus();
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = '...';

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Network error (${response.status})`);
    }

    const results = await response.json();
    if (!results || results.length === 0) {
      alert('Place not found. Try adding the district or state name (e.g., "Village Name, District").');
      return;
    }

    const place = results[0];
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    const targetZoom = place.boundingbox ? 16 : 15;

    map.setView([lat, lon], targetZoom);

    if (searchMarker) {
      map.removeLayer(searchMarker);
    }

    searchMarker = L.circleMarker([lat, lon], {
      radius: 7,
      color: '#ffffff',
      fillColor: '#f97316',
      fillOpacity: 1
    })
      .addTo(map)
      .bindPopup(place.display_name)
      .openPopup();
  } catch (err) {
    console.error('Nominatim search failed:', err);
    alert('Could not search right now. Check your internet connection and try again.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

searchBtn.addEventListener('click', searchPlace);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchPlace();
  }
});