function doGet(e) {
  const action = (e.parameter.action || "").toLowerCase();
  if (action === "getdata") return getData_();
  if (action === "getzones") return getZones_();
  return ContentService.createTextOutput("OK. Use ?action=getData o ?action=getZones");
}

function doPost(e) {
  const action = (e.parameter.action || "").toLowerCase();
  const payload = JSON.parse(e.postData.contents || "{}");

  if (action === "uploaddata") return uploadData_(payload);
  if (action === "savezones") return saveZones_(payload);
  return json_({ ok:false, error:"Acción no soportada" });
}

function getData_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("datos");
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const rows = values.map(r => Object.fromEntries(headers.map((h,i)=>[h, r[i]])));
  return json_({ ok:true, rows });
}

function uploadData_(payload) {
  const sh = SpreadsheetApp.getActive().getSheetByName("datos");
  sh.clearContents();

  const headers = payload.headers;
  const rows = payload.rows;

  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);

  return json_({ ok:true, n: rows.length });
}

function getZones_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("zonas");
  const values = sh.getDataRange().getValues();
  values.shift(); // headers
  const features = values
    .filter(r => r[0] && r[1])
    .map(r => {
      const name = r[0];
      const feature = JSON.parse(r[1]);
      feature.properties = feature.properties || {};
      feature.properties.name = name;
      return feature;
    });
  return json_({ ok:true, geojson: { type:"FeatureCollection", features } });
}

function saveZones_(payload) {
  const sh = SpreadsheetApp.getActive().getSheetByName("zonas");
  sh.clearContents();
  sh.getRange(1,1,1,2).setValues([["name","geojson"]]);

  const features = payload.geojson.features || [];
  const rows = features.map(f => [f.properties?.name || "Zona", JSON.stringify(f)]);
  if (rows.length) sh.getRange(2,1,rows.length,2).setValues(rows);

  return json_({ ok:true, n: rows.length });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

