// --- Estado ---
let dataRows = [];      // filas del Excel en formato normalizado
let years = [];         // años disponibles
let comunasLayer = null;

// --- Mapa ---
const map = L.map('map').setView([-53.0, -70.9], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

// --- Cargar comunas desde GeoJSON (OJO al nombre del archivo) ---
fetch('comunas_magallanes.geojson')
  .then((response) => {
    if (!response.ok) {
      throw new Error(`No se pudo cargar comunas_magallanes.geojson (HTTP ${response.status}). 
Revisa que el archivo exista en el repo y esté en la raíz.`);
    }
    return response.json();
  })
  .then((data) => {

    const comunasLayer = L.geoJSON(data, {
      style: () => ({
        color: "#444",
        weight: 1,
        fillOpacity: 0.2
      }),
      onEachFeature: (feature, layer) => {
        const nombreComuna =
          feature?.properties?.Comuna ||
          feature?.properties?.COMUNA ||
          feature?.properties?.NOM_COMUNA ||
          feature?.properties?.nombre ||
          "Comuna";

        layer.bindTooltip(nombreComuna, { sticky: true });

        layer.on('click', () => {
          onZonaClick(feature, layer, nombreComuna);
        });
      }
    }).addTo(map);

    map.fitBounds(comunasLayer.getBounds());
    setStatus("Comunas cargadas. Haz clic en una comuna.");
  })
  .catch((err) => {
    console.error(err);
    setStatus("ERROR: No se pudo cargar el GeoJSON de comunas. Revisa consola (F12).");
  });
// --- UI ---
const excelFile = document.getElementById('excelFile');
const yearSelect = document.getElementById('yearSelect');
const results = document.getElementById('results');
const statusEl = document.getElementById('status');

document.getElementById('exportZonas').addEventListener('click', exportZonas);

excelFile.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;

  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  const sheetName = wb.SheetNames[0]; // si quieres: wb.SheetNames.find(n => n.toLowerCase() === 'datos')
  const ws = wb.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });
  dataRows = normalizeRows(raw);

  years = [...new Set(dataRows.map(r => r.anio))].sort((a,b)=>a-b);
  populateYears(years);
  setStatus(`Excel cargado: ${dataRows.length} filas, años: ${years.join(", ")}`);
  results.innerHTML = `<div class="small">Ahora dibuja o selecciona una zona para ver promedios.</div>`;
});

yearSelect.addEventListener('change', () => {
  // si el usuario ya seleccionó una zona, debe volver a hacer clic para recalcular
  setStatus("Año cambiado. Haz clic en una zona para recalcular.");
});

// --- Funciones de datos ---
function normalizeRows(rows) {
  // Normaliza tipos y nombres esperados
  return rows.map((r, idx) => {
    const lat = Number(r.lat ?? r.Lat ?? r.LAT);
    const lon = Number(r.lon ?? r.Lon ?? r.LON ?? r.long ?? r.Long);

    const anio = Number(r.anio ?? r.Año ?? r.ANO ?? r.year);
    return {
      _row: idx+2,
      id_estancia: String(r.id_estancia ?? r.ID ?? r.estancia ?? ""),
      lat, lon, anio,
      pct_destete: numOrNull(r.pct_destete),
      pct_senalada: numOrNull(r.pct_senalada),
      peso_vara: numOrNull(r.peso_vara),
      n_corderos: numOrNull(r.n_corderos),
      n_borregos: numOrNull(r.n_borregos),
      n_ovejas: numOrNull(r.n_ovejas),
      n_carneros: numOrNull(r.n_carneros),
    };
  }).filter(r => isFinite(r.lat) && isFinite(r.lon) && isFinite(r.anio));
}

function numOrNull(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return isFinite(n) ? n : null;
}

function populateYears(years) {
  yearSelect.innerHTML = "";
  const optAll = document.createElement('option');
  optAll.value = "ALL";
  optAll.textContent = "Todos";
  yearSelect.appendChild(optAll);

  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  });
}

// --- Click en zona: calcular promedios ---
function onZonaClick(feature, layer, zonaNameFromLayer) {
  if (!dataRows.length) {
    results.innerHTML = "Primero carga un Excel.";
    return;
  }

  const selectedYear = yearSelect.value;
  const poly = layer.toGeoJSON();

  const points = dataRows
    .filter(r => selectedYear === "ALL" ? true : r.anio === Number(selectedYear))
    .filter(r => turf.booleanPointInPolygon(turf.point([r.lon, r.lat]), poly));

  const zonaName =
    zonaNameFromLayer ||
    feature?.properties?.Comuna ||
    feature?.properties?.COMUNA ||
    feature?.properties?.NOM_COMUNA ||
    "Comuna";

  renderBenchmark(zonaName, points, selectedYear);
}
}

function featureToTurfPolygon(geojson) {
  // Soporta Polygon y MultiPolygon
  return geojson;
}

function mean(arr) {
  const vals = arr.filter(v => v !== null && v !== undefined && isFinite(v));
  if (!vals.length) return null;
  const s = vals.reduce((a,b)=>a+b,0);
  return s / vals.length;
}

function sum(arr) {
  const vals = arr.filter(v => v !== null && v !== undefined && isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0);
}

function renderBenchmark(zonaName, rowsInZona, selectedYear) {
  const n = rowsInZona.length;

  // Promedios (puedes cambiar a ponderados si quieres por nº animales, etc.)
  const avgDestete = mean(rowsInZona.map(r => r.pct_destete));
  const avgSenalada = mean(rowsInZona.map(r => r.pct_senalada));
  const avgPesoVara = mean(rowsInZona.map(r => r.peso_vara));

  // Totales de categorías (normalmente tiene sentido sumar)
  const totCorderos = sum(rowsInZona.map(r => r.n_corderos));
  const totBorregos = sum(rowsInZona.map(r => r.n_borregos));
  const totOvejas = sum(rowsInZona.map(r => r.n_ovejas));
  const totCarneros = sum(rowsInZona.map(r => r.n_carneros));

  // Histórico: serie por año dentro de la zona (si estás en ALL)
  let histHtml = "";
  if (selectedYear === "ALL") {
    const byYear = groupBy(rowsInZona, r => r.anio);
    const yearsSorted = Object.keys(byYear).map(Number).sort((a,b)=>a-b);
    const rows = yearsSorted.map(y => {
      const rr = byYear[y];
      return `
        <tr>
          <td>${y}</td>
          <td>${fmt(mean(rr.map(r=>r.pct_destete)))}</td>
          <td>${fmt(mean(rr.map(r=>r.pct_senalada)))}</td>
          <td>${fmt(mean(rr.map(r=>r.peso_vara)))}</td>
        </tr>`;
    }).join("");
    histHtml = `
      <h3>Histórico (promedios)</h3>
      <table>
        <thead><tr><th>Año</th><th>% Destete</th><th>% Señalada</th><th>Peso vara</th></tr></thead>
        <tbody>${rows || ""}</tbody>
      </table>`;
  }

  results.innerHTML = `
    <div class="small">Zona seleccionada:</div>
    <h2 style="margin-top:6px;">${escapeHtml(zonaName)}</h2>
    <div class="small">Filtro año: <b>${selectedYear}</b> | Registros en zona: <b>${n}</b></div>

    <h3>Promedios</h3>
    <table>
      <tbody>
        <tr><td>% Destete</td><td><b>${fmt(avgDestete)}</b></td></tr>
        <tr><td>% Señalada</td><td><b>${fmt(avgSenalada)}</b></td></tr>
        <tr><td>Peso vara</td><td><b>${fmt(avgPesoVara)}</b></td></tr>
      </tbody>
    </table>

    <h3>Totales por categoría</h3>
    <table>
      <tbody>
        <tr><td>Corderos</td><td><b>${fmtInt(totCorderos)}</b></td></tr>
        <tr><td>Borregos</td><td><b>${fmtInt(totBorregos)}</b></td></tr>
        <tr><td>Ovejas</td><td><b>${fmtInt(totOvejas)}</b></td></tr>
        <tr><td>Carneros</td><td><b>${fmtInt(totCarneros)}</b></td></tr>
      </tbody>
    </table>

    ${histHtml}
  `;
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, x) => {
    const k = keyFn(x);
    acc[k] = acc[k] || [];
    acc[k].push(x);
    return acc;
  }, {});
}

function fmt(x) {
  if (x === null || x === undefined) return "—";
  // formato con 1 decimal
  return (Math.round(x * 10) / 10).toString();
}

function fmtInt(x) {
  if (x === null || x === undefined) return "—";
  return Math.round(x).toString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function setStatus(msg) { statusEl.textContent = msg; }

// Exportar zonas a GeoJSON descargable
function exportZonas() {
  const features = [];
  drawnItems.eachLayer(layer => {
    const gj = layer.toGeoJSON();
    // conservar nombre
    const name = layer.feature?.properties?.name || gj.properties?.name || "Zona";
    gj.properties = { ...(gj.properties||{}), name };
    features.push(gj);
  });

  const geo = { type:"FeatureCollection", features };
  const blob = new Blob([JSON.stringify(geo, null, 2)], { type:"application/geo+json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = "zonas.geojson";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setStatus("GeoJSON exportado. Sube el archivo al repo para que quede guardado.");
}
