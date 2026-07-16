let parsedData = [], summaryRows = [], hasExtra = false;
let sortCol = 'sendKey', sortDir = 1; // 1 = asc, -1 = desc

// Drag & drop + all event wiring (no inline handlers — required for MV3 CSP)
const dz = document.getElementById('dropzone');
dz.addEventListener('click',     () => document.getElementById('fileInput').click());
dz.addEventListener('dragover',  e  => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
dz.addEventListener('drop',      e  => { e.preventDefault(); dz.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
document.getElementById('fileInput').addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
document.getElementById('exportBtn').addEventListener('click', exportExcel);
document.getElementById('resetBtn').addEventListener('click', resetApp);
document.getElementById('invoiceFilter').addEventListener('change', filterTx);
document.getElementById('txFilter').addEventListener('input', filterTx);
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', function () { switchTab(this.dataset.tab, this); });
});

function processFile(file) {
  const r = new FileReader();
  r.onload = e => {
    parseCSV(e.target.result);
    document.getElementById('fileBadge').textContent = file.name;
    document.getElementById('rowBadge').textContent = parsedData.length + ' transactions';
    document.getElementById('modeBadge').textContent = hasExtra ? 'Extended format' : 'Basic format';
    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('toolbar').style.display = 'flex';
    document.getElementById('tabs').style.display = 'flex';
    renderAccountInfo();
    renderSummary();
    renderTransactions();
  };
  r.readAsText(file, 'UTF-8');
}

function parseCSV(text) {
  const lines = text.split('\n');
  parsedData = [];
  const header = lines[0].split(';').map(h => h.trim().toLowerCase());
  hasExtra = header.length >= 18 || header.some(h => h.includes('malo') || h.includes('meter') || h.includes('iban'));

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(';');
    if (row.length < 6) continue;
    const contract = row[5].trim();
    if (!contract || !/^\d+$/.test(contract)) continue;

    const txFull = (row[1] || '').trim();
    const sepIdx = txFull.indexOf(' - ');
    const invoiceId = sepIdx > -1 ? txFull.slice(0, sepIdx).trim() : txFull;
    const action    = sepIdx > -1 ? txFull.slice(sepIdx + 3).trim() : '';
    const idParts   = invoiceId.split('-');
    const period    = idParts.length >= 2 ? idParts[1] : '';
    const billCode  = idParts.length >= 3 ? idParts[2] : '';

    const r = {
      step:      row[0].trim(),
      tx:        txFull,
      invoiceId, action, period, billCode,
      debit:     pn(row[2]),
      credit:    pn(row[3]),
      balance:   pn(row[4]),
      contract,
      dueDate:   (row[6] || '').trim(),
      sendDate:  (row[7] || '').trim(),
    };

    if (hasExtra && row.length >= 18) {
      r.firstName = (row[10] || '').trim();
      r.lastName  = (row[11] || '').trim();
      r.name      = (r.firstName + ' ' + r.lastName).trim();
      r.meter     = (row[12] || '').trim();
      r.iban      = (row[13] || '').trim();
      r.city      = (row[14] || '').trim();
      r.street    = (row[15] || '').trim();
      r.houseNo   = (row[16] || '').trim();
      r.malo      = (row[17] || '').trim();
      r.address   = [r.street, r.houseNo].filter(Boolean).join(' ') + (r.city ? ', ' + r.city : '');
    }
    parsedData.push(r);
  }

  // Group transactions into one row per invoice/billing item
  const map = {};
  for (const r of parsedData) {
    if (!map[r.invoiceId]) {
      map[r.invoiceId] = {
        invoiceId: r.invoiceId, period: r.period, billCode: r.billCode,
        sendDate: r.sendDate, dueDate: r.dueDate, sendKey: dateKey(r.sendDate), dueKey: dateKey(r.dueDate),
        debit: 0, credit: 0, actions: [],
        name: '', meter: '', iban: '', address: '', malo: '',
      };
    }
    const g = map[r.invoiceId];
    g.debit  += r.debit;
    g.credit += r.credit;
    if (r.action) g.actions.push(r.action);
    if (!g.sendDate && r.sendDate) { g.sendDate = r.sendDate; g.sendKey = dateKey(r.sendDate); }
    if (!g.dueDate && r.dueDate)   { g.dueDate  = r.dueDate;  g.dueKey  = dateKey(r.dueDate); }
    if (hasExtra) {
      if (r.name    && !g.name)    g.name    = r.name;
      if (r.meter   && !g.meter)   g.meter   = r.meter;
      if (r.iban    && !g.iban)    g.iban    = r.iban;
      if (r.address && !g.address) g.address = r.address;
      if (r.malo    && !g.malo)    g.malo    = r.malo;
    }
  }

  summaryRows = Object.values(map).map(g => {
    const balance = Math.round((g.debit - g.credit) * 100) / 100;
    let status, statusClass;
    if (Math.abs(balance) <= 0.005) {
      if (g.actions.some(a => a.includes('Zahlung') && !a.includes('Gutschrift'))) { status = 'Paid'; statusClass = 'badge-ok'; }
      else if (g.actions.some(a => a.includes('Gutschrift'))) { status = 'Credited'; statusClass = 'badge-credit'; }
      else if (g.actions.some(a => a.includes('beendet'))) { status = 'Closed'; statusClass = 'badge-ok'; }
      else { status = 'Settled'; statusClass = 'badge-ok'; }
    } else if (balance > 0) {
      status = 'Open'; statusClass = 'badge-debt';
    } else {
      status = 'Credit balance'; statusClass = 'badge-credit';
    }
    return { ...g, balance, status, statusClass, label: describeInvoice(g.invoiceId) };
  }).sort((a, b) => (a.sendKey || '').localeCompare(b.sendKey || '') || a.invoiceId.localeCompare(b.invoiceId));
}

// Human-readable labels for billing periods, e.g. "81525561-2501-BA1" -> "Abschlag Januar 2025"
const MONTHS_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const TYPE_LABELS = { BA1: 'Abschlag', BB1: 'Rechnung', BC1: 'Rechnung und Abschlag' };

function describeInvoice(invoiceId) {
  const parts = invoiceId.split('-');
  if (parts.length < 3) return invoiceId;
  const period = parts[1]; // e.g. "2501"
  const code   = parts[2]; // e.g. "BA1"
  let monthLabel = '';
  const m = period.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const mm = parseInt(m[2], 10);
    if (mm >= 1 && mm <= 12) monthLabel = MONTHS_DE[mm - 1] + ' 20' + m[1];
  }
  const typeLabel = TYPE_LABELS[code] || code;
  return monthLabel ? (typeLabel + ' ' + monthLabel) : typeLabel;
}

// Parse a German-formatted number: dots are thousands separators, comma is decimal.
function pn(s) {
  if (!s || !s.trim()) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}
function fmt(n) { return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Convert "DD.MM.YYYY" -> "YYYYMMDD" for chronological sorting; '' if not matching.
function dateKey(d) {
  const m = (d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? m[3] + m[2] + m[1] : '';
}

function maskIban(raw) {
  if (!raw || raw === 'TRANSFER') return raw || '';
  const clean = raw.replace(/\s+/g, '');
  if (clean.length < 8) return raw;
  return clean.slice(0, 4) + ' •••• •••• ' + clean.slice(-4);
}

function renderAccountInfo() {
  const card = document.getElementById('accountInfo');
  if (!parsedData.length) { card.innerHTML = ''; card.style.display = 'none'; return; }
  const contract = parsedData[0].contract;
  const first = summaryRows.find(r => r.name) || summaryRows[0] || {};

  let html = "<div class='card-header'><span>Account Overview</span></div><div class='account-grid'>";
  html += infoItem('Contract Number', contract);
  if (hasExtra) {
    html += infoItem('Partner', first.name);
    html += infoItem('Address', first.address);
    html += infoItem('Meter No.', first.meter);
    html += infoItem('MaLo', first.malo);
    html += infoItem('IBAN', maskIban(first.iban));
  }
  html += '</div>';
  card.innerHTML = html;
  card.style.display = '';
}
function infoItem(label, value) {
  return "<div class='account-item'><div class='label'>" + label + "</div><div class='value'>" + (value || '–') + '</div></div>';
}

function getSortedRows() {
  return [...summaryRows].sort((a, b) => {
    const va = a[sortCol] ?? '';
    const vb = b[sortCol] ?? '';
    return typeof va === 'string'
      ? sortDir * va.localeCompare(vb)
      : sortDir * (va - vb);
  });
}

function renderSummary() {
  const tD = summaryRows.reduce((s, r) => s + r.debit, 0);
  const tC = summaryRows.reduce((s, r) => s + r.credit, 0);
  const tB = tD - tC;
  const openCount  = summaryRows.filter(r => r.status === 'Open').length;
  const paidCount  = summaryRows.filter(r => r.status === 'Paid' || r.status === 'Settled' || r.status === 'Closed').length;
  const credCount  = summaryRows.filter(r => r.status === 'Credited' || r.status === 'Credit balance').length;

  document.getElementById('kpis').innerHTML =
    "<div class='kpi neutral'><div class='label'>Total Invoices</div><div class='value'>" + summaryRows.length + "</div></div>" +
    "<div class='kpi ok'><div class='label'>Paid / Settled</div><div class='value'>" + paidCount + "</div></div>" +
    "<div class='kpi debt'><div class='label'>Open</div><div class='value'>" + openCount + "</div></div>" +
    "<div class='kpi credit-val'><div class='label'>Credited</div><div class='value'>" + credCount + "</div></div>" +
    "<div class='kpi neutral'><div class='label'>Total Invoiced</div><div class='value' style='font-size:1.1rem'>" + fmt(tD) + "</div></div>" +
    "<div class='kpi ok'><div class='label'>Total Settled</div><div class='value' style='font-size:1.1rem'>" + fmt(tC) + "</div></div>" +
    "<div class='kpi " + (tB > 0.005 ? 'debt' : tB < -0.005 ? 'credit-val' : 'ok') + "'><div class='label'>Open Balance</div><div class='value' style='font-size:1.1rem'>" + fmt(tB) + "</div></div>";

  const cols = [
    { key: 'invoiceId', label: 'Billing' },
    { key: 'sendKey',   label: 'Sent', display: 'sendDate' },
    { key: 'dueKey',    label: 'Due',  display: 'dueDate' },
    { key: 'debit',     label: 'Invoiced', num: true },
    { key: 'credit',    label: 'Settled',  num: true },
    { key: 'balance',   label: 'Open Balance', num: true },
    { key: 'status',    label: 'Status' },
  ];

  let thead = '<tr>';
  cols.forEach(c => {
    const active = sortCol === c.key;
    const arrow  = active ? (sortDir === 1 ? ' ▲' : ' ▼') : ' ⇅';
    thead += "<th class='sortable" + (c.num ? ' num' : '') + "' data-col='" + c.key + "'>"
           + c.label + "<span class='sort-arrow" + (active ? ' active' : '') + "'>" + arrow + "</span></th>";
  });
  thead += '</tr>';

  const sorted = getSortedRows();
  const tbody = sorted.map(r => {
    let row = "<tr><td><div>" + r.label + "</div><div class='sub-id'>" + r.invoiceId + "</div></td>";
    row += "<td>" + (r.sendDate || '') + "</td>";
    row += "<td>" + (r.dueDate || '') + "</td>";
    row += "<td class='num'>" + fmt(r.debit) + "</td>";
    row += "<td class='num'>" + fmt(r.credit) + "</td>";
    row += "<td class='num'>" + fmt(r.balance) + "</td>";
    row += "<td class='" + r.statusClass + "'>" + r.status + "</td></tr>";
    return row;
  }).join('');

  let tfoot = "<tr><td>TOTAL</td><td></td><td></td>";
  tfoot += "<td class='num'>" + fmt(tD) + "</td><td class='num'>" + fmt(tC) + "</td><td class='num'>" + fmt(tB) + "</td><td></td></tr>";

  document.getElementById('summaryTable').innerHTML =
    "<thead>" + thead + "</thead><tbody>" + tbody + "</tbody><tfoot>" + tfoot + "</tfoot>";

  document.querySelectorAll('#summaryTable th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortDir = sortCol === col ? sortDir * -1 : 1;
      sortCol = col;
      renderSummary();
    });
  });
}

function renderTransactions() {
  const sel = document.getElementById('invoiceFilter');
  sel.innerHTML = '<option value="">All invoices</option>';
  [...new Set(parsedData.map(r => r.invoiceId))].sort().forEach(id => {
    sel.innerHTML += "<option value='" + id + "'>" + describeInvoice(id) + ' (' + id + ')' + "</option>";
  });
  filterTx();
}

function filterTx() {
  const q  = document.getElementById('txFilter').value.toLowerCase();
  const id = document.getElementById('invoiceFilter').value;
  const rows = [...parsedData]
    .filter(r => (!id || r.invoiceId === id) &&
      (!q || r.tx.toLowerCase().includes(q) || r.invoiceId.toLowerCase().includes(q)))
    .sort((a, b) => dateKey(a.sendDate).localeCompare(dateKey(b.sendDate)) || a.step.localeCompare(b.step, undefined, { numeric: true }));

  let thead = "<tr><th>#</th><th>Billing</th><th>Action</th><th class='num'>Debit</th><th class='num'>Credit</th><th class='num'>Running Balance</th><th>Due Date</th><th>Sent / Booked</th></tr>";

  const tbody = rows.map(r => {
    return "<tr><td>" + r.step + "</td><td><div>" + describeInvoice(r.invoiceId) + "</div><div class='sub-id'>" + r.invoiceId + "</div></td><td>" + (r.action || r.tx) + "</td>" +
      "<td class='num'>" + (r.debit ? fmt(r.debit) : '') + "</td>" +
      "<td class='num'>" + (r.credit ? fmt(r.credit) : '') + "</td>" +
      "<td class='num'>" + fmt(r.balance) + "</td>" +
      "<td>" + r.dueDate + "</td><td>" + r.sendDate + "</td></tr>";
  }).join('');

  document.getElementById('txTable').innerHTML =
    "<thead>" + thead + "</thead><tbody>" + tbody + "</tbody>";
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

function exportExcel() {
  const wb = XLSX.utils.book_new();

  const s1h = ['Billing', 'Invoice / Period', 'Sent', 'Due', 'Invoiced', 'Settled', 'Open Balance', 'Status'];
  const s1 = [s1h];
  let tD = 0, tC = 0;
  for (const r of getSortedRows()) {
    s1.push([r.label, r.invoiceId, r.sendDate, r.dueDate, r.debit, r.credit, r.balance, r.status]);
    tD += r.debit; tC += r.credit;
  }
  s1.push(['TOTAL', '', '', '', tD, tC, tD - tC, '']);
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1['!cols'] = [{wch:26},{wch:18},{wch:12},{wch:12},{wch:12},{wch:12},{wch:14},{wch:14}];

  const s2h = ['Step', 'Billing', 'Invoice / Period', 'Action', 'Debit', 'Credit', 'Running Balance', 'Due Date', 'Sent / Booked'];
  const s2 = [s2h];
  for (const r of [...parsedData].sort((a, b) => dateKey(a.sendDate).localeCompare(dateKey(b.sendDate)) || a.step.localeCompare(b.step, undefined, { numeric: true }))) {
    s2.push([r.step, describeInvoice(r.invoiceId), r.invoiceId, r.action || r.tx, r.debit || '', r.credit || '', r.balance, r.dueDate, r.sendDate]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2['!cols'] = [{wch:6},{wch:26},{wch:18},{wch:24},{wch:12},{wch:12},{wch:16},{wch:12},{wch:12}];

  XLSX.utils.book_append_sheet(wb, ws1, 'Invoice Summary');
  XLSX.utils.book_append_sheet(wb, ws2, 'All Transactions');
  XLSX.writeFile(wb, document.getElementById('fileBadge').textContent.replace('.csv', '') + '_single_report.xlsx');
}

function resetApp() {
  document.getElementById('dropzone').style.display = '';
  document.getElementById('toolbar').style.display = 'none';
  document.getElementById('tabs').style.display = 'none';
  document.getElementById('accountInfo').style.display = 'none';
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-summary').classList.add('active');
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('fileInput').value = '';
  parsedData = []; summaryRows = [];
  hasExtra = false;
  ['kpis', 'summaryTable', 'txTable', 'accountInfo'].forEach(id => document.getElementById(id).innerHTML = '');
}
