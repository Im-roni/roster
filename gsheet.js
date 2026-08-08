// ---------- Google Sheets live source ----------
const SHEET_ID = '1DaxP_dHESicOXeqR4Nnv4v-PJDURMwev';

function gvizUrl(sheetName) {
  const q = encodeURIComponent(sheetName);
  const bust = Date.now();
  const reqId = Math.floor(Math.random() * 1e9);
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;reqId:${reqId}&sheet=${q}&_=${bust}`;
}

// Parses the JSONP-wrapped response Google returns from the gviz endpoint.
function parseGvizResponse(text) {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end === -1) throw new Error('Unexpected response shape');
  const json = JSON.parse(text.slice(start + 1, end));
  if (json.status === 'error') {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Sheet query failed';
    throw new Error(msg);
  }
  return json.table; // { cols, rows }
}

// Converts gviz's "Date(y,m,d)" cell value into an ISO date string (m is 0-indexed).
function gvizDateToISO(v) {
  if (typeof v !== 'string') return null;
  const m = v.match(/^Date\((\d+),(\d+),(\d+)/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.toISOString().slice(0, 10);
}

function cellValue(cell) {
  if (!cell) return null;
  return cell.v !== undefined ? cell.v : null;
}

async function fetchSheetTable(sheetName) {
  const res = await fetch(gvizUrl(sheetName), {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseGvizResponse(text);
}

// Rebuilds a month record in the same shape as the original static export.
function parseMonthTable(table, team) {
  const rows = table.rows.map(r => r.c || []);
  if (rows.length < 3) throw new Error('Sheet too short');

  const row0 = rows[0];
  const row1 = rows[1];

  const dateCols = [];
  row0.forEach((cell, i) => {
    const iso = gvizDateToISO(cellValue(cell));
    if (iso) dateCols.push(i);
  });
  if (!dateCols.length) throw new Error('No date columns found');

  const dates = dateCols.map(i => gvizDateToISO(cellValue(row0[i])));
  const dayNames = dateCols.map(i => {
    const v = cellValue(row1[i]);
    return v === null ? '' : String(v);
  });

  const employees = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    const nameCell = row[0];
    const name = cellValue(nameCell);
    if (name === null || String(name).trim() === '') break;
    const days = dateCols.map(i => {
      const v = cellValue(row[i]);
      return v === null ? null : String(v);
    });
    employees.push({ name: String(name).trim(), days });
  }

  const first = new Date(dates[0]);
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return {
    team,
    year: first.getUTCFullYear(),
    month: first.getUTCMonth() + 1,
    monthLabel,
    dates,
    dayNames,
    employees
  };
}


