// ======================
// Configuración
// ======================
const EXCEL_URL = "benchmark.xlsx";              // en la raíz del repo
const COMUNAS_GEOJSON_URL = "comunas_magallanes.geojson";

// ======================
// Estado
// ======================
let dataRows = [];
let years = [];
let comunasLayer = null;
let lastComunaClicked = null;

// ======================
// UI
// ======================
const yearSelect = document.getElementById('yearSelect');
const results = document.getElementById('results');
const statusEl = document.getElementById('status');
const debugEl = document.getElementById('debug');

function setStatus(msg) { statusEl.textContent = msg; }
function setDebug(msg) { debugEl.textContent = msg || ""; }

// Normaliza textos para comparar comunas (sin tildes, sin mayúsculas)
function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// ======================
// Mapa
// ======================
const map = L.map('map').setView([-53.0, -70.9], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

// ======================
// Cargar comunas
// ======================
async function loadComunas() {
  const res = await fetch(`${COMUNAS_GEOJSON_URL}?v=${Date.now()}`); // evita caché
  if (!res.ok) throw new Error(`No se pudo cargar ${COMUNAS_GEOJSON_URL}. HTTP ${res.status}`);
  const geo = await res.json();

  comunasLayer = L.geoJSON(geo, {
    style: () => ({
      color: "#444",
      weight: 1,
      fillOpacity: 0.2
    }),
    onEachFeature: (feature, layer) => {
      const nombre =
        feature?.properties?.Comuna ||
        feature?.properties?.COMUNA ||
        feature?.properties?.NOM_COMUNA ||
        feature?.properties?.nombre ||
        feature?.properties?.Name ||
        "Comuna";

      layer.bindTooltip(nombre, { sticky: true });

      layer.on('click', () => {
        lastComunaClicked = nombre;
        onComunaClick(nombre);
      });
    }
  }).addTo(map);

  map.fitBounds(comunasLayer.getBounds());
}

// ======================
// Cargar Excel desde GitHub Pages
// ======================
async function loadExcel() {
  if (typeof XLSX === "undefined") {
    throw new Error("XLSX no está cargado. Revisa que xlsx.full.min.js esté antes de app.js en index.html.");
  }

  // cache-busting para que al actualizar el Excel en GitHub se refleje rápido
  const res = await fetch(`${EXCEL_URL}?v=${Date.now()}`);
  if (!res.ok) throw new Error(`No se pudo cargar ${EXCEL_URL}. HTTP ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });
  dataRows = normalizeRows(raw);

  if (!dataRows.length) {
    throw new Error("No se encontraron filas válidas. Asegura columnas 'comuna' y 'anio' en benchmark.xlsx");
  }

  years = [...new Set(dataRows.map(r => r.anio))].sort((a, b) => a - b);
  populateYears(years);
}

// ======================
// Inicialización
// ======================
(async function init() {
  try {
    setStatus("Cargando comunas…");
    await loadComunas();

    setStatus("Cargando datos (benchmark.xlsx)…");
    await loadExcel();

    setStatus(`Listo: ${dataRows.length} filas cargadas. Haz clic en una comuna.`);
    setDebug("");
    results.innerHTML = `<div class="small">Haz clic en una comuna para ver promedios.</div>`;
  } catch (err) {
    console.error(err);
    setStatus("ERROR inicializando. Revisa consola (F12).");
    setDebug(String(err));
  }
})();

// ======================
// Año (filtro)
// ======================
yearSelect.addEventListener('change', () => {
  setStatus("Año cambiado. Haz clic en una comuna para recalcular.");
  // opcional: recalcular automáticamente la última comuna clickeada
  if (lastComunaClicked) onComunaClick(lastComunaClicked);
});

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

// ======================
// Normalización de filas Excel
// ======================
function normalizeRows(rows) {
  return rows.map((r, idx) => {
    const comunaRaw = r.comuna ?? r.Comuna ?? r.COMUNA ?? r["Comuna (INE)"] ?? "";
    const comuna = String(comunaRaw || "").trim();

    const anio = Number(r.anio ?? r.Año ?? r.ANO ?? r.year ?? r.Year);

    return {
      _row: idx + 2,
      comuna,
      anio,

      pct_destete: numOrNull(r.pct_destete ?? r.Pct_destete ?? r["%destete"] ?? r["% destete"]),
      pct_senalada: numOrNull(r.pct_senalada ?? r.Pct_senalada ?? r["%señalada"] ?? r["% senalada"] ?? r["% señalada"]),
      peso_vara: numOrNull(r.peso_vara ?? r.Peso_vara ?? r["peso vara"]),

      n_corderos: numOrNull(r.n_corderos ?? r.Corderos),
      n_borregos: numOrNull(r.n_borregos ?? r.Borregos),
      n_ovejas: numOrNull(r.n_ovejas ?? r.Ovejas),
      n_carneros: numOrNull(r.n_carneros ?? r.Carneros),
    };
  }).filter(r => r.comuna && isFinite(r.anio));
}

function numOrNull(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return isFinite(n) ? n : null;
}

// ======================
// Click comuna -> cálculo
// ======================
function onComunaClick(comunaNameFromMap) {
  if (!dataRows.length) {
    results.innerHTML = "Aún no se cargan datos (benchmark.xlsx).";
    return;
  }

  const selectedYear = yearSelect.value;

  const target = normalizeName(comunaNameFromMap);

  const rowsInComuna = dataRows
    .filter(r => selectedYear === "ALL" ? true : r.anio === Number(selectedYear))
    .filter(r => normalizeName(r.comuna) === target);

  renderBenchmark(comunaNameFromMap, rowsInComuna, selectedYear);
}

// ======================
// Métricas
// ======================
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

function groupBy(arr, keyFn) {
  return arr.reduce((acc, x) => {
    const k = keyFn(x);
    (acc[k] = acc[k] || []).push(x);
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

// ======================
// Render
// ======================
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
    const ys = Object.keys(byYear).map(Number).sort((a, b) => a - b);

    const histRows = ys.map(y => {
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
        <tbody>${histRows || ""}</tbody>
      </table>`;
  }

  // Nota útil cuando no hay match
  const warn = (n === 0)
    ? `<div class="small" style="margin-top:8px;">
         ⚠ No hay filas para esta comuna con el filtro actual. Revisa que en el Excel la columna <b>comuna</b>
         tenga el mismo nombre que el mapa (sinónimos/tildes se normalizan, pero "Natales" vs "Puerto Natales" no).
       </div>`
    : "";

  results.innerHTML = `
    <div class="small">Comuna seleccionada:</div>
    <h2 style="margin-top:6px;">${escapeHtml(zonaName)}</h2>
    <div class="small">Filtro año: <b>${selectedYear}</b> | Registros: <b>${n}</b></div>
    ${warn}

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
