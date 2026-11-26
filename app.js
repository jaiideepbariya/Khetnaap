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

// 9. Bilingual Support (English <-> Hindi)
const TRANSLATIONS = {
  en: {
    appTitle: 'KhetNaap',
    subtitle: 'Tap field corners on satellite map',
    myLocation: '📍 My Location',
    searchPlaceholder: 'Search village, town, or area (e.g., Mhow, Dhar, Indore)...',
    searchBtn: 'Search',
    startWalk: '🚶 Start GPS Walk',
    stopWalk: '⏹ Stop Walk',
    finishWalk: '✓ Finish Plot',
    acres: 'Acres',
    hectares: 'Hectares',
    bigha: 'Bigha (MP/Std)',
    sqm: 'Sq. Meters',
    perimeterLabel: 'Boundary Perimeter:',
    plotPlaceholder: 'Plot name (e.g., North Wheat Khet)',
    savePlot: 'Save Plot',
    sharePlot: 'Share Link',
    clearPlot: 'Clear',
    disclaimer: '*Approximate satellite measurement for farming & planning—not a legal revenue survey.',
    langToggleLabel: 'हिंदी'
  },
  hi: {
    appTitle: 'खेतनाप (KhetNaap)',
    subtitle: 'सैटेलाइट मैप पर खेत के कोने चुनें',
    myLocation: '📍 मेरी लोकेशन',
    searchPlaceholder: 'गाँव, कस्बा या क्षेत्र खोजें (जैसे महू, धार, इंदौर)...',
    searchBtn: 'खोजें',
    startWalk: '🚶 जीपीएस वॉक शुरू करें',
    stopWalk: '⏹ वॉक रोकें',
    finishWalk: '✓ खेत पूरा करें',
    acres: 'एकड़ (Acres)',
    hectares: 'हेक्टेयर (Hectares)',
    bigha: 'बीघा (Bigha)',
    sqm: 'वर्ग मीटर (Sq. m)',
    perimeterLabel: 'मेढ़ की लंबाई:',
    plotPlaceholder: 'खेत का नाम (जैसे उत्तरी गेहूँ खेत)',
    savePlot: 'सेव करें',
    sharePlot: 'लिंक शेयर करें',
    clearPlot: 'साफ़ करें',
    disclaimer: '*यह खेती और योजना के लिए अनुमानित माप है—कानूनी या खसरा सर्वे नहीं।',
    langToggleLabel: 'English'
  }
};

let currentLang = localStorage.getItem('khetnaap_lang') || 'en';

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('khetnaap_lang', lang);
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) el.placeholder = dict[key];
  });

  const langBtn = document.getElementById('lang-btn');
  if (langBtn) langBtn.textContent = dict.langToggleLabel;

  const walkBtn = document.getElementById('walk-toggle-btn');
  if (walkBtn) {
    walkBtn.textContent = watchId !== null ? dict.stopWalk : dict.startWalk;
  }

  updateWalkStatusText();
}

document.getElementById('lang-btn').addEventListener('click', () => {
  applyLanguage(currentLang === 'en' ? 'hi' : 'en');
});

// 10. Walk-the-Boundary Live GPS Tracking
let watchId = null;
let walkedCoords = []; // Array of [lat, lng]
let walkPolyline = null;
let lastAccuracy = null;

const walkToggleBtn = document.getElementById('walk-toggle-btn');
const walkFinishBtn = document.getElementById('walk-finish-btn');
const walkStatusEl = document.getElementById('walk-status');

function updateWalkStatusText() {
  if (!walkStatusEl) return;
  const accText = lastAccuracy ? ` (±${Math.round(lastAccuracy)}m)` : '';
  if (watchId !== null) {
    walkStatusEl.textContent =
      currentLang === 'hi'
        ? `रिकॉर्डिंग जारी: ${walkedCoords.length} बिंदु${accText}`
        : `Recording: ${walkedCoords.length} pts${accText}`;
  } else {
    walkStatusEl.textContent =
      currentLang === 'hi'
        ? `जीपीएस वॉक बंद (${walkedCoords.length} बिंदु)`
        : `GPS Walk: Idle (${walkedCoords.length} pts)`;
  }
}

function haversineMeters(a, b) {
  const from = turf.point([a[1], a[0]]);
  const to = turf.point([b[1], b[0]]);
  return turf.distance(from, to, { units: 'meters' });
}

function startWalkTracking() {
  if (!navigator.geolocation) {
    alert(currentLang === 'hi' ? 'इस ब्राउज़र में GPS उपलब्ध नहीं है।' : 'Geolocation is not supported in this browser.');
    return;
  }

  drawnItems.clearLayers();
  resetMeasurements();
  walkedCoords = [];
  lastAccuracy = null;

  if (walkPolyline) {
    map.removeLayer(walkPolyline);
  }
  walkPolyline = L.polyline([], { color: '#38bdf8', weight: 4, dashArray: '6, 6' }).addTo(map);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      lastAccuracy = accuracy;
      const pt = [latitude, longitude];

      // Ignore wildly inaccurate fixes (> 35m) or duplicate jitter (< 2.5m)
      if (accuracy > 35) {
        updateWalkStatusText();
        return;
      }

      const prev = walkedCoords[walkedCoords.length - 1];
      if (!prev || haversineMeters(prev, pt) >= 2.5) {
        walkedCoords.push(pt);
        walkPolyline.addLatLng(pt);
        map.panTo(pt, { animate: true });
      }

      walkFinishBtn.disabled = walkedCoords.length < 3;
      updateWalkStatusText();
    },
    (err) => {
      alert(
        currentLang === 'hi'
          ? `GPS त्रुटि: ${err.message} (HTTPS और लोकेशन अनुमति जाँचें)`
          : `GPS error: ${err.message} (Ensure HTTPS and location permission are enabled)`
      );
      stopWalkTracking();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );

  walkToggleBtn.classList.add('recording');
  walkFinishBtn.disabled = true;
  applyLanguage(currentLang);
}

function stopWalkTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  walkToggleBtn.classList.remove('recording');
  walkFinishBtn.disabled = walkedCoords.length < 3;
  applyLanguage(currentLang);
}

function finishWalkPlot() {
  stopWalkTracking();
  if (walkedCoords.length < 3) {
    alert(currentLang === 'hi' ? 'खेत का क्षेत्रफल निकालने के लिए कम से कम 3 बिंदु चाहिए।' : 'Walk at least 3 distinct points around the field first.');
    return;
  }

  if (walkPolyline) {
    map.removeLayer(walkPolyline);
    walkPolyline = null;
  }

  const polygonLayer = L.polygon(walkedCoords, {
    color: '#facc15',
    weight: 3,
    fillOpacity: 0.25
  });

  drawnItems.clearLayers();
  drawnItems.addLayer(polygonLayer);
  map.fitBounds(polygonLayer.getBounds(), { padding: [20, 20] });
  updateMeasurements(polygonLayer);
}

walkToggleBtn.addEventListener('click', () => {
  if (watchId !== null) {
    stopWalkTracking();
  } else {
    startWalkTracking();
  }
});

walkFinishBtn.addEventListener('click', finishWalkPlot);

// 11. Shareable Plot Link & Summary
function buildShareUrl() {
  const payload = {
    n: document.getElementById('plot-name').value.trim() || 'Shared Khet',
    a: document.getElementById('area-acres').textContent,
    b: document.getElementById('area-bigha').textContent,
    g: currentGeoJSON
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = new URL(window.location.href);
  url.searchParams.set('plot', encoded);
  return { url: url.toString(), payload };
}

document.getElementById('share-btn').addEventListener('click', async () => {
  if (!currentGeoJSON || currentSqMeters === 0) {
    alert(currentLang === 'hi' ? 'पहले मैप पर खेत बनाएं या GPS वॉक पूरा करें।' : 'Draw a field or finish a GPS walk first before sharing.');
    return;
  }

  const { url, payload } = buildShareUrl();
  const summaryText =
    currentLang === 'hi'
      ? `${payload.n}: ${payload.a} एकड़ (${payload.b} बीघा)\nलिंक: ${url}`
      : `${payload.n}: ${payload.a} Acres (${payload.b} Bigha)\nLink: ${url}`;

  try {
    if (navigator.share) {
      await navigator.share({ title: 'KhetNaap Plot', text: summaryText, url });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(summaryText);
      alert(currentLang === 'hi' ? 'शेयर लिंक कॉपी हो गया है!' : 'Share link copied to clipboard!');
    } else {
      prompt('Copy this share link:', url);
    }
  } catch (err) {
    // User cancelled share sheet or clipboard blocked
    if (err && err.name !== 'AbortError') {
      prompt('Copy this share link:', url);
    }
  }
});

// Load plot automatically if opened via ?plot=... link
(function loadPlotFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('plot');
  if (!encoded) return;

  try {
    const decoded = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!decoded || !decoded.g) return;

    if (decoded.n) {
      document.getElementById('plot-name').value = decoded.n;
    }

    const layer = L.geoJSON(decoded.g, {
      style: { color: '#facc15', weight: 3, fillOpacity: 0.25 }
    }).getLayers()[0];

    if (layer) {
      drawnItems.clearLayers();
      drawnItems.addLayer(layer);
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
      updateMeasurements(layer);
    }
  } catch (err) {
    console.warn('Invalid shared plot URL parameter:', err);
  }
})();

applyLanguage(currentLang);