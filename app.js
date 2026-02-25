// --- Estado ---
let dataRows = [];
let years = [];
let comunasLayer = null;

// --- Mapa ---
const map = L.map('map').setView([-53.0, -70.9], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

// --- UI ---
const excelFile = document.getElementById('excelFile');
const yearSelect = document.getElementById('yearSelect');
const results = document.getElementById('results');
const statusEl = document.getElementById('status');

// Si tu HTML tiene el botón exportZonas pero ya no lo usarás, lo desactivamos:
const exportBtn = document.getElementById('exportZonas');
if (exportBtn) {
  exportBtn.disabled = true;
  exportBtn.title = "Deshabilitado (usando comunas como zonas fijas).";
}

// --- Cargar comunas desde GeoJSON ---
fetch('comunas_magallanes.geojson')  // ✅ OJO: una sola extensión
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status} al cargar comunas_magallanes.geojson`);
    return response.json();
  })
  .then((data) => {
    comunasLayer = L.geoJSON(data, {
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
          feature?.properties?.Name ||
          "Comuna";

        layer.bindTooltip(nombreComuna, { sticky: true });

        layer.on('click', () => {
          onZonaClick(feature, layer, nombreComuna);
        });
      }
    }).addTo(map);

    map.fitBounds(comunasLayer.getBounds());
    setStatus("Comunas cargadas. Carga un Excel y haz clic en una comuna.");
  })
  .catch((err) => {
    console.error(err);
    setStatus("ERROR cargando comunas. Revisa F12 → Console.");
  });

// --- Cargar Excel ---
excelFile.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;

  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });
  dataRows = normalizeRows(raw);

  years = [...new Set(dataRows.map(r => r.anio))].sort((a, b) => a - b);
  populateYears(years);

  setStatus(`Excel cargado: ${dataRows.length} filas. Años: ${years.join(", ")}`);
  results.innerHTML = `<div class="small">Haz clic en una comuna para ver promedios.</div>`;
});

yearSelect.addEventListener('change', () => {
  setStatus("Año cambiado. Haz clic en una comuna para recalcular.");
});

// --- Funciones de datos ---
function normalizeRows(rows) {
  return rows.map((r, idx) => {
    const lat = Number(r.lat ?? r.Lat ?? r.LAT);
    const lon = Number(r.lon ?? r.Lon ?? r.LON ?? r.long ?? r.Long);
    const anio = Number(r.anio ?? r.Año ?? r.ANO ?? r.year);

    return {
      _row: idx + 2,
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

function populateYears(yearsArr) {
  yearSelect.innerHTML = "";
  const optAll = document.createElement('option');
  optAll.value = "ALL";
  optAll.textContent = "Todos";
  yearSelect.appendChild(optAll);

  yearsArr.forEach(y => {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  });
}

// --- Click en comuna: calcular promedios ---
function onZonaClick(feature, layer, zonaNameFromLayer) {
  if (!dataRows.length) {
    results.innerHTML = "Primero carga un Excel.";
    return;
  }

  const selectedYear = yearSelect.value;
  const poly = layer.toGeoJSON(); // Polygon/MultiPolygon válido para Turf

  const points = dataRows
    .filter(r => selectedYear === "ALL" ? true : r.anio === Number(selectedYear))
    .filter(r => turf.booleanPointInPolygon(turf.point([r.lon, r.lat]), poly));

  renderBenchmark(zonaNameFromLayer || "Comuna", points, selectedYear);
}

function mean(arr) {
  const vals = arr.filter(v => v !== null && v !== undefined && isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sum(arr) {
  const vals = arr.filter(v => v !== null && v !== undefined && isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

function renderBenchmark(zonaName, rowsInZona, selectedYear) {
  const n = rowsInZona.length;

  const avgDestete = mean(rowsInZona.map(r => r.pct_destete));
  const avgSenalada = mean(rowsInZona.map(r => r.pct_senalada));
  const avgPesoVara = mean(rowsInZona.map(r => r.peso_vara));

  const totCorderos = sum(rowsInZona.map(r => r.n_corderos));
  const totBorregos = sum(rowsInZona.map(r => r.n_borregos));
  const totOvejas = sum(rowsInZona.map(r => r.n_ovejas));
  const totCarneros = sum(rowsInZona.map(r => r.n_carneros));

  let histHtml = "";
  if (selectedYear === "ALL") {
    const byYear = groupBy(rowsInZona, r => r.anio);
    const yearsSorted = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    const histRows = yearsSorted.map(y => {
      const rr = byYear[y];
      return `
        <tr>
          <td>${y}</td>
          <td>${fmt(mean(rr.map(r => r.pct_destete)))}</td>
          <td>${fmt(mean(rr.map(r => r.pct_senalada)))}</td>
          <td>${fmt(mean(rr.map(r => r.peso_vara)))}</td>
        </tr>`;
    }).join("");

    histHtml = `
      <h3>Histórico (promedios)</h3>
      <table>
        <thead><tr><th>Año</th><th>% Destete</th><th>% Señalada</th><th>Peso vara</th></tr></thead>
        <tbody>${histRows}</tbody>
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
  return (Math.round(x * 10) / 10).toString();
}

function fmtInt(x) {
  if (x === null || x === undefined) return "—";
  return Math.round(x).toString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}
