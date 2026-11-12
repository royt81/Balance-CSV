let parsedData = [], summaryRows = [], hasExtra = false;
let sortCol = 'contract', sortDir = 1; // 1 = asc, -1 = desc
let billingRows = [], singleContract = false;
let billSortCol = 'sendKey', billSortDir = 1;

// Drag & drop + all event wiring (no inline handlers — required for MV3 CSP)
const dz = document.getElementById('dropzone');
dz.addEventListener('click',     () => document.getElementById('fileInput').click());
dz.addEventListener('dragover',  e  => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
dz.addEventListener('drop',      e  => { e.preventDefault(); dz.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
document.getElementById('fileInput').addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
document.getElementById('exportBtn').addEventListener('click', exportExcel);
document.getElementById('resetBtn').addEventListener('click', resetApp);
document.getElementById('contractFilter').addEventListener('change', filterTx);
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
    renderSummary();
    renderTransactions();

    // Single-contract mode: show the Payment History tab and open it by default
    const billTab = document.getElementById('billingTab');
    billTab.style.display = singleContract ? '' : 'none';
    if (singleContract) {
      renderBilling();
      switchTab('billing', billTab);
    } else {
      switchTab('summary', document.querySelector('.tab[data-tab="summary"]'));
    }
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

    const r = {
      step:     row[0].trim(),
      tx:       txFull,
      invoiceId: sepIdx > -1 ? txFull.slice(0, sepIdx).trim() : txFull,
      action:    sepIdx > -1 ? txFull.slice(sepIdx + 3).trim() : '',
      debit:    pn(row[2]),
      credit:   pn(row[3]),
      balance:  pn(row[4]),
      contract,
      dueDate:  (row[6] || '').trim(),
      sendDate: (row[7] || '').trim(),
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

  const map = {};
  for (const r of parsedData) {
    if (!map[r.contract]) {
      map[r.contract] = { contract: r.contract, debit: 0, credit: 0,
        name: '', meter: '', iban: '', address: '', malo: '' };
    }
    map[r.contract].debit  += r.debit;
    map[r.contract].credit += r.credit;
    if (hasExtra && r.name    && !map[r.contract].name)    map[r.contract].name    = r.name;
    if (hasExtra && r.meter   && !map[r.contract].meter)   map[r.contract].meter   = r.meter;
    if (hasExtra && r.iban    && !map[r.contract].iban)    map[r.contract].iban    = r.iban;
    if (hasExtra && r.address && !map[r.contract].address) map[r.contract].address = r.address;
    if (hasExtra && r.malo    && !map[r.contract].malo)    map[r.contract].malo    = r.malo;
  }
  summaryRows = Object.values(map)
    .sort((a, b) => a.contract.localeCompare(b.contract))
    .map(r => ({ ...r, balance: Math.round((r.debit - r.credit) * 100) / 100 }));

  singleContract = summaryRows.length === 1;
  billingRows = singleContract ? buildBillingRows() : [];
}

// ---- Single-contract Payment History -------------------------------------

// Human-readable labels for billing periods, e.g. "43881414-2601-BA1" -> "Abschlag Januar 2026"
const MONTHS_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const TYPE_LABELS = { BA1: 'Abschlag', BB1: 'Rechnung', BC1: 'Rechnung und Abschlag' };

function describeInvoice(invoiceId) {
  const parts = invoiceId.split('-');
  if (parts.length < 3) return invoiceId;
  const m = parts[1].match(/^(\d{2})(\d{2})$/);
  let monthLabel = '';
  if (m) {
    const mm = parseInt(m[2], 10);
    if (mm >= 1 && mm <= 12) monthLabel = MONTHS_DE[mm - 1] + ' 20' + m[1];
  }
  const typeLabel = TYPE_LABELS[parts[2]] || parts[2];
  return monthLabel ? (typeLabel + ' ' + monthLabel) : typeLabel;
}

// Convert "DD.MM.YYYY" -> "YYYYMMDD" for chronological sorting; '' if not matching.
function dateKey(d) {
  const m = (d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? m[3] + m[2] + m[1] : '';
}

// Group all transactions of the single contract into one row per billing,
// with a chronological event trail and a payment status.
function buildBillingRows() {
  const map = {};
  for (const r of parsedData) {
    if (!map[r.invoiceId]) {
      map[r.invoiceId] = {
        invoiceId: r.invoiceId,
        sendDate: r.sendDate, dueDate: r.dueDate,
        sendKey: dateKey(r.sendDate), dueKey: dateKey(r.dueDate),
        debit: 0, credit: 0, invoiced: 0, paid: 0, cancelled: 0, events: [],
      };
    }
    const g = map[r.invoiceId];
    g.debit  += r.debit;
    g.credit += r.credit;
    // Classify: recall re-debits reverse payments (not new invoicing);
    // beendet/Gutschrift credits cancel the claim (they are not payments).
    const a = r.action || r.tx;
    if (a.includes('zurückgerufen'))      { g.paid -= r.debit; g.cancelled += r.credit; }
    else if (a.includes('Zahlung'))       { g.paid += r.credit; g.invoiced += r.debit; }
    else                                  { g.invoiced += r.debit; g.cancelled += r.credit; }
    g.events.push({ step: parseInt(r.step, 10) || 0, action: a, debit: r.debit, credit: r.credit });
    if (!g.sendDate && r.sendDate) { g.sendDate = r.sendDate; g.sendKey = dateKey(r.sendDate); }
    if (!g.dueDate  && r.dueDate)  { g.dueDate  = r.dueDate;  g.dueKey  = dateKey(r.dueDate); }
  }

  return Object.values(map).map(g => {
    g.events.sort((a, b) => a.step - b.step);
    const balance = Math.round((g.debit - g.credit) * 100) / 100; // = invoiced - paid - cancelled
    g.invoiced  = Math.round(g.invoiced  * 100) / 100;
    g.paid      = Math.round(g.paid      * 100) / 100;
    g.cancelled = Math.round(g.cancelled * 100) / 100;

    let lastPay = -1, lastRecall = -1, hasRecall = false, hasCredit = false, hasEnd = false;
    g.events.forEach((e, i) => {
      const a = e.action;
      if (a.includes('zurückgerufen')) { lastRecall = i; hasRecall = true; }
      else if (a.includes('Zahlung'))  { lastPay = i; }
      if (a.includes('Gutschrift')) hasCredit = true;
      if (a.includes('beendet'))    hasEnd = true;
    });

    let status, statusClass;
    if (Math.abs(balance) <= 0.005) {
      if (lastPay > -1 && lastPay > lastRecall) { status = hasRecall ? 'Paid (after recall)' : 'Paid'; statusClass = 'st-paid'; }
      else if (hasCredit)                       { status = 'Credited'; statusClass = 'st-credit'; }
      else if (hasEnd)                          { status = hasRecall ? 'Closed (after recall)' : 'Closed'; statusClass = 'st-muted'; }
      else                                      { status = 'Settled'; statusClass = 'st-paid'; }
    } else if (balance > 0) {
      if (lastRecall > lastPay) { status = 'Payment recalled – open'; statusClass = 'st-warn'; }
      else if (lastPay === -1)  { status = 'Open – no payment'; statusClass = 'st-open'; }
      else                      { status = 'Partially paid'; statusClass = 'st-open'; }
    } else { status = 'Overpaid'; statusClass = 'st-credit'; }

    const trail = g.events
      .filter(e => !e.action.includes('erstellt'))
      .map(e => e.action + ' ' + fmt(e.debit || e.credit))
      .join('  →  ') || '–';

    return { ...g, balance, status, statusClass, trail, hasRecall, label: describeInvoice(g.invoiceId) };
  }).sort((a, b) => (a.sendKey || '').localeCompare(b.sendKey || '') || a.invoiceId.localeCompare(b.invoiceId));
}

function renderBilling() {
  const contract = summaryRows[0] ? summaryRows[0].contract : '';
  const tI = billingRows.reduce((s, r) => s + r.invoiced, 0);
  const tP = billingRows.reduce((s, r) => s + r.paid, 0);
  const tX = billingRows.reduce((s, r) => s + r.cancelled, 0);
  const tB = tI - tP - tX;
  const hasCancelled = tX > 0.005;
  const paidCount   = billingRows.filter(r => r.statusClass === 'st-paid').length;
  const openCount   = billingRows.filter(r => r.balance > 0.005).length;
  const recallCount = billingRows.filter(r => r.hasRecall).length;

  document.getElementById('billingHeader').textContent = 'Payment History – Contract ' + contract;

  document.getElementById('billingKpis').innerHTML =
    "<div class='kpi neutral'><div class='label'>Billings</div><div class='value'>" + billingRows.length + "</div></div>" +
    "<div class='kpi ok'><div class='label'>Paid / Settled</div><div class='value'>" + paidCount + "</div></div>" +
    "<div class='kpi debt'><div class='label'>Open</div><div class='value'>" + openCount + "</div></div>" +
    "<div class='kpi credit-val'><div class='label'>With Recall</div><div class='value'>" + recallCount + "</div></div>" +
    "<div class='kpi " + (tB > 0.005 ? 'debt' : tB < -0.005 ? 'credit-val' : 'ok') + "'><div class='label'>Open Balance</div><div class='value' style='font-size:1.1rem'>" + fmt(tB) + "</div></div>";

  const cols = [
    { key: 'invoiceId', label: 'Billing' },
    { key: 'sendKey',   label: 'Issued' },
    { key: 'dueKey',    label: 'Due' },
    { key: 'invoiced',  label: 'Invoiced', num: true },
    { key: 'paid',      label: 'Paid',     num: true },
    ...(hasCancelled ? [{ key: 'cancelled', label: 'Cancelled', num: true }] : []),
    { key: 'balance',   label: 'Open',     num: true },
    { key: 'status',    label: 'Payment' },
    { key: 'trail',     label: 'Events (in order)' },
  ];

  let thead = '<tr>';
  cols.forEach(c => {
    const active = billSortCol === c.key;
    const arrow  = active ? (billSortDir === 1 ? ' ▲' : ' ▼') : ' ⇅';
    thead += "<th class='sortable" + (c.num ? ' num' : '') + "' data-col='" + c.key + "'>"
           + c.label + "<span class='sort-arrow" + (active ? ' active' : '') + "'>" + arrow + "</span></th>";
  });
  thead += '</tr>';

  const sorted = [...billingRows].sort((a, b) => {
    const va = a[billSortCol] ?? '';
    const vb = b[billSortCol] ?? '';
    return typeof va === 'string' ? billSortDir * va.localeCompare(vb) : billSortDir * (va - vb);
  });

  const tbody = sorted.map(r =>
    "<tr><td><div>" + r.label + "</div><div class='sub-id'>" + r.invoiceId + "</div></td>" +
    "<td>" + (r.sendDate || '') + "</td>" +
    "<td>" + (r.dueDate || '') + "</td>" +
    "<td class='num'>" + fmt(r.invoiced) + "</td>" +
    "<td class='num'>" + fmt(r.paid) + "</td>" +
    (hasCancelled ? "<td class='num'>" + (r.cancelled ? fmt(r.cancelled) : '') + "</td>" : '') +
    "<td class='num'>" + fmt(r.balance) + "</td>" +
    "<td class='" + r.statusClass + "'>" + r.status + "</td>" +
    "<td class='trail'>" + r.trail + "</td></tr>"
  ).join('');

  let tfoot = "<tr><td>TOTAL</td><td></td><td></td>";
  tfoot += "<td class='num'>" + fmt(tI) + "</td><td class='num'>" + fmt(tP) + "</td>";
  if (hasCancelled) tfoot += "<td class='num'>" + fmt(tX) + "</td>";
  tfoot += "<td class='num'>" + fmt(tB) + "</td><td></td><td></td></tr>";

  document.getElementById('billingTable').innerHTML =
    "<thead>" + thead + "</thead><tbody>" + tbody + "</tbody><tfoot>" + tfoot + "</tfoot>";

  document.querySelectorAll('#billingTable th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      billSortDir = billSortCol === col ? billSortDir * -1 : 1;
      billSortCol = col;
      renderBilling();
    });
  });
}

// Parse a German-formatted number: dots are thousands separators, comma is decimal.
function pn(s) {
  if (!s || !s.trim()) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}
function fmt(n) { return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function maskIban(raw) {
  if (!raw || raw === 'TRANSFER') return raw || '';
  const clean = raw.replace(/\s+/g, '');
  if (clean.length < 8) return raw;
  return clean.slice(0, 4) + ' •••• •••• ' + clean.slice(-4);
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
  const debtCount   = summaryRows.filter(r => r.balance >  0.005).length;
  const creditCount = summaryRows.filter(r => r.balance < -0.005).length;

  document.getElementById('kpis').innerHTML =
    "<div class='kpi neutral'><div class='label'>Total Contracts</div><div class='value'>" + summaryRows.length + "</div></div>" +
    "<div class='kpi debt'><div class='label'>With Debt</div><div class='value'>" + debtCount + "</div></div>" +
    "<div class='kpi credit-val'><div class='label'>With Credit Surplus</div><div class='value'>" + creditCount + "</div></div>" +
    "<div class='kpi neutral'><div class='label'>Total Invoiced</div><div class='value' style='font-size:1.1rem'>" + fmt(tD) + "</div></div>" +
    "<div class='kpi ok'><div class='label'>Total Paid</div><div class='value' style='font-size:1.1rem'>" + fmt(tC) + "</div></div>" +
    "<div class='kpi " + (tB > 0.005 ? 'debt' : tB < -0.005 ? 'credit-val' : 'ok') + "'><div class='label'>Net Balance</div><div class='value' style='font-size:1.1rem'>" + fmt(tB) + "</div></div>";

  const cols = [
    { key: 'contract', label: 'Contract' },
    ...(hasExtra ? [
      { key: 'name',    label: 'Partner' },
      { key: 'meter',   label: 'Meter No.' },
      { key: 'malo',    label: 'MaLo' },
      { key: 'address', label: 'Address' },
    ] : []),
    { key: 'debit',   label: 'Total Debit',  num: true },
    { key: 'credit',  label: 'Total Credit', num: true },
    { key: 'balance', label: 'Balance',       num: true },
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
    const cls = r.balance > 0.005 ? 'badge-debt' : r.balance < -0.005 ? 'badge-credit' : 'badge-ok';
    let row = "<tr><td>" + r.contract + "</td>";
    if (hasExtra) {
      row += "<td>" + (r.name || '') + "</td>";
      row += "<td>" + (r.meter || '') + "</td>";
      row += "<td>" + (r.malo || '') + "</td>";
      row += "<td class='td-address'>" + (r.address || '') + "</td>";
    }
    row += "<td class='num'>" + fmt(r.debit) + "</td>";
    row += "<td class='num'>" + fmt(r.credit) + "</td>";
    row += "<td class='num " + cls + "'>" + fmt(r.balance) + "</td></tr>";
    return row;
  }).join('');

  let tfoot = "<tr><td>TOTAL</td>";
  if (hasExtra) tfoot += "<td></td><td></td><td></td><td></td>";
  tfoot += "<td class='num'>" + fmt(tD) + "</td><td class='num'>" + fmt(tC) + "</td><td class='num'>" + fmt(tB) + "</td></tr>";

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
  const sel = document.getElementById('contractFilter');
  sel.innerHTML = '<option value="">All contracts</option>';
  [...new Set(parsedData.map(r => r.contract))].sort().forEach(c => {
    sel.innerHTML += "<option value='" + c + "'>" + c + (hasExtra && parsedData.find(r => r.contract === c)?.name ? ' – ' + parsedData.find(r => r.contract === c).name : '') + "</option>";
  });
  filterTx();
}

function filterTx() {
  const q = document.getElementById('txFilter').value.toLowerCase();
  const c = document.getElementById('contractFilter').value;
  const rows = parsedData.filter(r =>
    (!c || r.contract === c) &&
    (!q || r.tx.toLowerCase().includes(q) || r.contract.includes(q) || (r.name || '').toLowerCase().includes(q))
  );

  let thead = "<tr><th>#</th><th>Transaction</th><th class='num'>Debit</th><th class='num'>Credit</th><th class='num'>Running Balance</th><th>Contract</th>";
  if (hasExtra) thead += "<th>Partner</th><th>IBAN</th><th>Meter</th><th>MaLo</th><th>Address</th>";
  thead += "<th>Due Date</th><th>Send Date</th></tr>";

  const tbody = rows.map(r => {
    let row = "<tr><td>" + r.step + "</td><td>" + r.tx + "</td>" +
      "<td class='num'>" + (r.debit ? fmt(r.debit) : '') + "</td>" +
      "<td class='num'>" + (r.credit ? fmt(r.credit) : '') + "</td>" +
      "<td class='num'>" + fmt(r.balance) + "</td>" +
      "<td>" + r.contract + "</td>";
    if (hasExtra) {
      row += "<td>" + (r.name || '') + "</td>";
      row += "<td class='iban'>" + maskIban(r.iban || '') + "</td>";
      row += "<td>" + (r.meter || '') + "</td>";
      row += "<td>" + (r.malo || '') + "</td>";
      row += "<td class='wrap'>" + (r.address || '') + "</td>";
    }
    row += "<td>" + r.dueDate + "</td><td>" + r.sendDate + "</td></tr>";
    return row;
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

  const s1h = ['Contract Number'];
  if (hasExtra) s1h.push('Partner Name', 'Meter Number', 'MaLo', 'Address');
  s1h.push('Total Debit', 'Total Credit', 'Balance');
  const s1 = [s1h];
  let tD = 0, tC = 0;
  for (const r of summaryRows) {
    const row = [r.contract];
    if (hasExtra) row.push(r.name, r.meter, r.malo, r.address);
    row.push(r.debit, r.credit, r.balance);
    s1.push(row);
    tD += r.debit; tC += r.credit;
  }
  const totRow = ['TOTAL'];
  if (hasExtra) totRow.push('', '', '', '');
  totRow.push(tD, tC, tD - tC);
  s1.push(totRow);
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1['!cols'] = hasExtra
    ? [{wch:16},{wch:20},{wch:16},{wch:14},{wch:30},{wch:14},{wch:14},{wch:14}]
    : [{wch:16},{wch:14},{wch:14},{wch:14}];

  const s2h = ['Step', 'Transaction', 'Debit', 'Credit', 'Running Balance', 'Contract Number'];
  if (hasExtra) s2h.push('Partner Name', 'IBAN (masked)', 'Meter Number', 'MaLo', 'Address');
  s2h.push('Due Date', 'Send Date');
  const s2 = [s2h];
  for (const r of parsedData) {
    const row = [r.step, r.tx, r.debit || '', r.credit || '', r.balance, r.contract];
    if (hasExtra) row.push(r.name || '', maskIban(r.iban || ''), r.meter || '', r.malo || '', r.address || '');
    row.push(r.dueDate, r.sendDate);
    s2.push(row);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2['!cols'] = hasExtra
    ? [{wch:6},{wch:45},{wch:12},{wch:12},{wch:16},{wch:14},{wch:20},{wch:20},{wch:16},{wch:14},{wch:30},{wch:12},{wch:12}]
    : [{wch:6},{wch:45},{wch:12},{wch:12},{wch:16},{wch:14},{wch:12},{wch:12}];

  if (singleContract && billingRows.length) {
    const s0 = [['Billing', 'Invoice ID', 'Issued', 'Due', 'Invoiced', 'Paid', 'Cancelled', 'Open', 'Payment', 'Events (in order)']];
    let bI = 0, bP = 0, bX = 0;
    for (const r of billingRows) {
      s0.push([r.label, r.invoiceId, r.sendDate, r.dueDate, r.invoiced, r.paid, r.cancelled || '', r.balance, r.status, r.trail]);
      bI += r.invoiced; bP += r.paid; bX += r.cancelled;
    }
    s0.push(['TOTAL', '', '', '', bI, bP, bX, bI - bP - bX, '', '']);
    const ws0 = XLSX.utils.aoa_to_sheet(s0);
    ws0['!cols'] = [{wch:26},{wch:18},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:22},{wch:60}];
    XLSX.utils.book_append_sheet(wb, ws0, 'Payment History');
  }
  XLSX.utils.book_append_sheet(wb, ws1, 'Contract Summary');
  XLSX.utils.book_append_sheet(wb, ws2, 'All Transactions');
  XLSX.writeFile(wb, document.getElementById('fileBadge').textContent.replace('.csv', '') + '_report.xlsx');
}

function resetApp() {
  document.getElementById('dropzone').style.display = '';
  document.getElementById('toolbar').style.display = 'none';
  document.getElementById('tabs').style.display = 'none';
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-summary').classList.add('active');
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('fileInput').value = '';
  document.getElementById('billingTab').style.display = 'none';
  parsedData = []; summaryRows = []; billingRows = [];
  hasExtra = false; singleContract = false;
  billSortCol = 'sendKey'; billSortDir = 1;
  ['kpis', 'summaryTable', 'txTable', 'billingKpis', 'billingTable'].forEach(id => document.getElementById(id).innerHTML = '');
}
