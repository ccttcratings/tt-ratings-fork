/**
 * Manual USATT alignment for the club-kit spreadsheet.
 *
 * Run by the OPERATOR whenever he wants (typically after new USATT ratings are
 * submitted), e.g. via the "Equalize Ratings" button on the System/Rules tab
 * (cell B40). This is NOT an automatic/triggered job - the operator decides when.
 *
 * How it works:
 *   1. For each player with an Official USATT Rating (Ratings tab column F)
 *      whose Rating Date (column G) is NOT stale (default: within 2 years),
 *      compute (club rating - official rating). The live club rating is read
 *      from the Ratings tab (column C), the canonical source used by games.
 *   2. Take the mean of those differences.
 *   3. Shift EVERY player's club rating by that mean so official-rated players
 *      land as close as possible to their official rating (mean = least-squares
 *      optimal offset).
 *   4. Requires at least 1 valid official rating; otherwise it skips and logs.
 *   5. Prompts with a confirmation dialog listing each player's club vs USATT
 *      rating and the computed uniform offset; nothing is written until the
 *      operator clicks Continue.
 *   6. Writes the shifted rating back to the Ratings tab (C/D).
 *   7. Applies the SAME uniform offset to every historical rating on the
 *      "Ratings Graph" tab (column C in the long/tidy Player|Date|Rating
 *      layout) so the line chart stays continuous - without this, the
 *      pre-alignment points would sit on the old scale and the graph would
 *      show a step-change bump at the alignment date.
 *   8. Writes the result to an "Alignment Log" sheet for review/revert.
 *
 * Combined Ratings tab columns:
 *   A=rank  B=name  C=club rating  D=club rating date  E=Player Ratings Graph link
 *   F=USATT rating  G=USATT date earned  H=Show Inactive button
 *   I-J blank  K=Hide Inactive button  CZ=primary emails  DC=secondary emails
 *   (The Equalize button lives on the System/Rules tab at B40.)
 *
 * Staleness: a rating older than SETUP staleness years is VOID. It is NOT
 * deleted - it stays in the sheet but turns RED. Valid ratings are GREEN.
 */

var ALIGN_RATINGS_SHEET = '🔵 Ratings';
var ALIGN_GRAPH_SHEET = 'Ratings History';
var ALIGN_GRAPH_HEADER_ROW = 1;
var ALIGN_LOG_SHEET = 'Alignment Log';
var ALIGN_DEFAULT_STALENESS_YEARS = 2;

function alignToUSATT() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(ALIGN_RATINGS_SHEET)) {
    Logger.log('Ratings sheet not found; alignment aborted.');
    return;
  }

  var algo = computeAlignment(ss);
  if (algo.validCount < 1) {
    var msg = 'Alignment skipped: only ' + algo.validCount +
      ' player(s) with a valid (non-stale) official rating. Need at least 1.';
    Logger.log(msg);
    ss.toast(msg, 'USATT Alignment', 5);
    return;
  }

  var html = buildAlignmentDialogHtml(algo.proposed, algo.offset, algo.stalenessYears);
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(560).setHeight(500),
    'Confirm USATT Alignment');
}

/**
 * Shared computation for the alignment: read the Ratings sheet, color the
 * official-rating columns (green = valid, red = stale), refresh the validation
 * note, and compute the uniform offset (mean of club - official over valid
 * players, rounded to the quarter grid). Returns rows, proposed, validCount,
 * offset, and stalenessYears. No ratings are modified.
 */
function computeAlignment(ss) {
  var ratings = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  var stalenessYears = getSetupValue(ss, 'USATT staleness (years)', ALIGN_DEFAULT_STALENESS_YEARS);

  // Read rank/name/club/date + USATT rating/date in one pass (A..G).
  var rows = [];      // {row, name, club, official, date, stale}
  var validCount = 0;
  var totalDiff = 0;
  var proposed = [];  // {name, club, official, diff}
  var ratingsValues = ratings.getRange('A2:G').getValues();
  for (var i = 0; i < ratingsValues.length; i++) {
    var name = String(ratingsValues[i][1]).trim();
    if (name === '') break;
    var club = parseFloat(ratingsValues[i][2]);
    var official = parseFloat(ratingsValues[i][5]);
    var dateRaw = ratingsValues[i][6];

    if (isNaN(official)) {
      rows.push({ row: i + 2, name: name, club: club, official: null, date: null, stale: false });
      continue;
    }
    var d = parseDate(dateRaw);
    var isStale = isDateStale(d, stalenessYears);
    rows.push({ row: i + 2, name: name, club: club, official: official, date: d, stale: isStale });
    if (!isStale && !isNaN(club)) {
      validCount++;
      totalDiff += (club - official);
      proposed.push({ name: name, club: club, official: official, diff: round2(club - official) });
    }
  }

  // Color the official-rating column (F): green = valid, red = stale.
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].official === null) continue;
    var color = rows[i].stale ? '#ea9999' : '#b6d7a8';
    ratings.getRange('F' + rows[i].row).setBackground(color);
    ratings.getRange('G' + rows[i].row).setFontColor(rows[i].stale ? '#cc0000' : '#000000');
  }

  // Refresh the USATT date-column validation note across every G data cell so
  // the guidance pops up whenever any G cell is clicked.
  refreshGColumnNotes(ratings, stalenessYears);

  // All ratings live on the USATT quarter-point scale (x.00/.25/.50/.75), so
  // rounding each shifted rating is unnecessary as long as the offset itself is
  // a quarter number: quarter - quarter is always on the grid. Round the offset
  // once here, then apply it uniformly with no per-rating rounding.
  var offset = roundQuarter(totalDiff / validCount);
  return { rows: rows, proposed: proposed, validCount: validCount, offset: offset, stalenessYears: stalenessYears };
}

function buildAlignmentDialogHtml(proposed, offset, stalenessYears) {
  var rowsHtml = '';
  for (var i = 0; i < proposed.length; i++) {
    var p = proposed[i];
    var diff = p.diff;
    rowsHtml += '<tr><td>' + escapeHtml(p.name) + '</td><td>' + round2(p.club) + '</td><td>' +
      round2(p.official) + '</td><td>' + (diff < 0 ? '' : '+') + diff + '</td></tr>';
  }
  var applied = -offset;
  var sign = applied < 0 ? '' : '+';
  return '<!DOCTYPE html><html><head><base target="_top"><style>body{font-family:Arial}' +
    ' table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:3px 6px;font-size:12px}' +
    ' th{background:#f0f0f0} .list{overflow-y:auto;max-height:200px;border:1px solid #ccc}' +
    ' button{margin-top:8px;padding:6px 16px;font-weight:bold}</style></head><body>' +
    '<h3>Confirm USATT Alignment</h3>' +
    '<p>Based on <b>' + proposed.length + '</b> valid official rating(s) (older than ' + stalenessYears +
    ' years are excluded):</p>' +
    '<div class="list"><table><tr><th>Player</th><th>Club</th><th>USATT</th><th>Diff (club-USATT)</th></tr>' +
    rowsHtml + '</table></div>' +
    '<p>Continue applies the mean of the differences above, <b>' + sign + round2(applied) + '</b>, ' +
    'to <b>every</b> rating on the Ratings tab and shifts the Rating History so the chart stays continuous.</p>' +
    '<div><button id="contBtn" onclick="doContinue()">Continue</button>' +
    ' <button onclick="google.script.host.close()">Cancel</button></div>' +
    '<div id="status"></div>' +
    '<script>' +
    'function doContinue() {' +
    '  document.getElementById("contBtn").disabled = true;' +
    '  document.getElementById("status").textContent = "Applying...";' +
    '  google.script.run.withSuccessHandler(onDone).applyAlignment();' +
    '}' +
    'function onDone(result) {' +
    '  if (result.ok) {' +
    '    document.getElementById("status").textContent = result.message;' +
    '    setTimeout(function(){ google.script.host.close(); }, 1500);' +
    '  } else {' +
    '    document.getElementById("contBtn").disabled = false;' +
    '    document.getElementById("status").textContent = result.message;' +
    '  }' +
    '}' +
    '</script></body></html>';
}

/**
 * Server side of the alignment confirmation: recompute the proposal from the
 * sheet, then apply the uniform offset to every club rating (Ratings tab C/D)
 * and to every historical rating (Rating History tab column C) so the chart
 * stays continuous. Logs APPLIED in the Alignment Log and toasts.
 */
function applyAlignment() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratings = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  if (!ratings) return { ok: false, message: 'Ratings sheet not found.' };

  var algo = computeAlignment(ss);
  if (algo.validCount < 1) {
    return { ok: false, message: 'No valid official rating found; nothing to apply.' };
  }
  var offset = algo.offset;

  // Apply the shift to every club rating (including unrated-official players).
  var todayStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy');
  var values = ratings.getRange('A2:C').getValues();
  var updated = 0;
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][1]).trim();
    if (name === '') break;
    var club = parseFloat(values[i][2]);
    if (isNaN(club)) continue;
    var row = i + 2;
    ratings.getRange('C' + row).setValue(round2(club - offset));
    ratings.getRange('D' + row).setValue(todayStr);
    updated++;
  }

  // Shift every historical rating on the hidden Rating History tab (long/tidy
  // layout: column C = Rating) by the same uniform offset so the line chart
  // stays continuous across the alignment. Without this the pre-alignment
  // points would remain on the old scale and the graph would show a
  // step-change bump right at the alignment date. We apply the raw offset (not
  // the per-player quarter-rounded amount) so all players' lines move together
  // and keep their relative shape.
  var graph = ss.getSheetByName(ALIGN_GRAPH_SHEET);
  if (graph) {
    shiftHistoricalRatings(graph, offset);
  }

  var validNames = [];
  for (var k = 0; k < algo.proposed.length; k++) validNames.push(algo.proposed[k].name);

  var applied = -offset;
  var sign = applied < 0 ? '' : '+';
  var summary = 'Applied USATT alignment offset of ' + round2(offset) +
    ' (' + sign + round2(applied) + ' to every rating; quarter-grid preserved). ' +
    'Historical ratings on the Ratings Graph tab (long/tidy layout, column C) shifted by the same offset to keep the chart continuous. ' +
    'Based on ' + algo.validCount + ' valid official rating(s): ' + validNames.join(', ');
  Logger.log(summary);
  appendLog(ss, new Date(), round2(offset), 'APPLIED', summary);
  ss.toast('USATT alignment applied (offset ' + sign + round2(applied) + ').', 'Done', 5);
  return { ok: true, message: 'Applied ' + sign + round2(applied) + ' to ' + updated + ' player(s).' };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Open a modal dialog listing every past bump (USATT alignment runs and manual
 * tweaks) with its date, and let the operator shift ALL ratings by a manually
 * entered amount. The amount must be a quarter number; non-quarter input is
 * rounded to the nearest 0.25. Reverting a past bump = applying its negative.
 * All bumps are recorded in the "Alignment Log" sheet so the history shown in
 * this dialog is self-maintaining.
 */
function tweakRatings() {
  var html = HtmlService.createHtmlOutput(buildTweakDialogHtml())
      .setWidth(480).setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, 'Tweak / Revert Ratings');
}

function buildTweakDialogHtml() {
  return '<!DOCTYPE html><html><head><base target="_top"><style>body{font-family:Arial} ' +
    'table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:3px 6px;font-size:12px} ' +
    'th{background:#f0f0f0} input{padding:5px;width:200px} button{margin-top:6px}</style></head><body>' +
    '<h3>Tweak / Revert All Ratings</h3>' +
    '<p>Enter a quarter amount (e.g. <b>12.50</b> or <b>-5.25</b>) to add to or subtract ' +
    'from every rating. Non-quarter entries are rounded to the nearest 0.25. To revert a past ' +
    'bump, apply its negative.</p>' +
    '<input id="amount" type="text" placeholder="e.g. 12.50 or -5.25">' +
    '<div><button id="applyBtn" onclick="doApply()">Apply</button>' +
    '<button onclick="google.script.host.close()">Cancel</button></div>' +
    '<div id="status"></div>' +
    '<h3>Past bumps</h3>' +
    '<div id="history"></div>' +
    '<script>' +
    'window.onload = function () { loadHistory(); };' +
    'function loadHistory() {' +
    '  google.script.run.withSuccessHandler(renderHistory).getBumpHistory();' +
    '}' +
    'function renderHistory(rows) {' +
    '  var el = document.getElementById("history");' +
    '  if (!rows || rows.length === 0) { el.innerHTML = "<i>No bumps recorded yet.</i>"; return; }' +
    '  var html = "<table><tr><th>Date</th><th>Status</th><th>Amount</th></tr>";' +
    '  for (var i = 0; i < rows.length; i++) {' +
    '    var r = rows[i];' +
    '    html += "<tr><td>" + r.date + "</td><td>" + r.status + "</td><td>" + r.amount + "</td></tr>";' +
    '  }' +
    '  html += "</table>";' +
    '  el.innerHTML = html;' +
    '}' +
    'function doApply() {' +
    '  var amt = document.getElementById("amount").value;' +
    '  if (!amt || isNaN(parseFloat(amt))) {' +
    '    document.getElementById("status").textContent = "Enter a number.";' +
    '    return;' +
    '  }' +
    '  document.getElementById("applyBtn").disabled = true;' +
    '  document.getElementById("status").textContent = "Applying...";' +
    '  google.script.run.withSuccessHandler(onDone).applyTweak(amt);' +
    '}' +
    'function onDone(result) {' +
    '  document.getElementById("applyBtn").disabled = false;' +
    '  document.getElementById("status").textContent = result.message;' +
    '  if (result.ok) loadHistory();' +
    '}' +
    '</script></body></html>';
}

/**
 * Server side of the Tweak dialog: return every recorded bump (date, status,
 * amount) newest-first from the Alignment Log sheet. Only rows that actually
 * applied an offset (APPLIED / TWEAK) are listed; SKIPPED rows are omitted.
 */
function getBumpHistory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(ALIGN_LOG_SHEET);
  var bumps = [];
  if (!log) return bumps;
  var values = log.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var status = String(values[i][2]);
    if (status !== 'APPLIED' && status !== 'TWEAK') continue;
    var amount = values[i][1] === '' || values[i][1] === null ? '' : round2(parseFloat(values[i][1]));
    bumps.push({ date: values[i][0], status: status, amount: amount });
  }
  return bumps.reverse(); // newest first
}

/**
 * Server side of the Tweak dialog: shift every club rating (Ratings tab C/D)
 * and every historical rating (Rating History tab column C) by the entered
 * amount. The amount is rounded to the nearest 0.25 (quarter grid); zero is
 * rejected. The bump is appended to the Alignment Log for history/revert.
 */
function applyTweak(amountText) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratings = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  if (!ratings) return { ok: false, message: 'Ratings sheet not found.' };

  var amount = roundQuarter(parseFloat(String(amountText).replace(/,/g, '').trim()));
  if (isNaN(amount) || amount === 0) {
    return { ok: false, message: 'Enter a non-zero quarter number.' };
  }
  var todayStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy');

  // Shift current club ratings and stamp D with today's date.
  var values = ratings.getRange('A2:C').getValues();
  var updated = 0;
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][1]).trim();
    if (name === '') break;
    var club = parseFloat(values[i][2]);
    if (isNaN(club)) continue;
    var row = i + 2;
    ratings.getRange('C' + row).setValue(round2(club + amount));
    ratings.getRange('D' + row).setValue(todayStr);
    updated++;
  }

  // Shift historical ratings by the same amount so the chart stays continuous.
  var graph = ss.getSheetByName(ALIGN_GRAPH_SHEET);
  if (graph) shiftHistoricalRatings(graph, -amount);

  var sign = amount > 0 ? '+' : '';
  var summary = 'Manual tweak: ' + sign + round2(amount) + ' applied to every rating (' +
    updated + ' player(s)); historical ratings shifted to keep the chart continuous.';
  Logger.log(summary);
  appendLog(ss, new Date(), round2(amount), 'TWEAK', summary);
  return { ok: true, message: 'Applied ' + sign + round2(amount) + ' to ' + updated + ' player(s).' };
}

/**
 * Shift every historical rating on the hidden Rating History tab (long/tidy
 * layout: A=Player, B=Date, C=Rating) by the given offset (applied as
 * `value - offset`, matching the club-rating shift). The header row
 * (ALIGN_GRAPH_HEADER_ROW) is skipped so headers are never touched, and the
 * date column (B) is left alone - only the numeric Rating column (C) is
 * shifted.
 */
function shiftHistoricalRatings(hist, offset) {
  var startRow = ALIGN_GRAPH_HEADER_ROW + 1; // first data row (skip header)
  var lastRow = hist.getLastRow();
  if (lastRow < startRow) return;

  // Grab the Rating column (C) in ONE call, shift in memory, write back in ONE
  // call. The hidden "Chart Data" pivot recomputes automatically.
  var range = hist.getRange(startRow, 3, lastRow - startRow + 1, 1);
  var values = range.getValues();

  var totalChanged = false;
  for (var r = 0; r < values.length; r++) {
    var v = values[r][0];
    if (typeof v === 'number' && !isNaN(v)) {
      values[r][0] = round2(v - offset);
      totalChanged = true;
    } else if (typeof v === 'string' && v.trim() !== '' && !isNaN(parseFloat(v))) {
      values[r][0] = round2(parseFloat(v) - offset);
      totalChanged = true;
    }
  }

  if (totalChanged) {
    range.setValues(values);
  }
}

function isDateStale(date, stalenessYears) {
  if (!date) return true; // no date = treat as stale/unreliable
  var limit = new Date();
  limit.setFullYear(limit.getFullYear() - stalenessYears);
  return date < limit;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  var s = String(v).trim();
  // Expect MM-DD-YYYY or MM/DD/YYYY or a Date serial.
  var m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function getSetupValue(ss, key, fallback) {
  var sheet = ss.getSheetByName('Setup');
  if (!sheet) return fallback;
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] && String(values[i][0]).trim().toLowerCase() === String(key).toLowerCase()) {
      var parsed = parseFloat(values[i][1]);
      return isNaN(parsed) ? fallback : parsed;
    }
  }
  return fallback;
}

function appendLog(ss, date, offset, status, message) {
  var sheet = ss.getSheetByName(ALIGN_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ALIGN_LOG_SHEET);
    sheet.appendRow(['Date', 'Offset applied', 'Status', 'Details']);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  sheet.appendRow([
    Utilities.formatDate(date, ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy HH:mm'),
    offset === null ? '' : offset,
    status,
    message
  ]);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function roundQuarter(v) {
  // Round to the nearest 0.25 so ratings stay on the USATT quarter-point scale.
  return Math.round(v * 4) / 4;
}

/**
 * Stamp the USATT-date guidance onto every G cell on the Ratings tab so the
 * note pops up whenever any G cell is clicked. Applies only to the data rows
 * (column A non-empty); the header and trailing blank rows are untouched.
 */
function refreshGColumnNotes(ratings, stalenessYears) {
  var aValues = ratings.getRange('A2:A').getValues();
  var lastDataRow = 1;
  for (var i = 0; i < aValues.length; i++) {
    if (String(aValues[i][0]).trim() !== '') lastDataRow = i + 2;
  }
  if (lastDataRow < 2) return;
  var note = 'Date USATT rating was Achieved (NOT Submitted).  '
    + 'Ratings older than ' + stalenessYears + ' years turn red and are excluded from the USATT alignments.  '
    + 'Click the Equalize Ratings Button after updating the USATT ratings.';
  ratings.getRange('G2:G' + lastDataRow).setNote(note);
}

/**
 * Re-stamp the G-column USATT-date notes every time the spreadsheet is opened
 * so new player rows get the guidance without waiting for an alignment run.
 */
function onOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratings = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  if (!ratings) return;
  var stalenessYears = getSetupValue(ss, 'USATT staleness (years)', ALIGN_DEFAULT_STALENESS_YEARS);
  refreshGColumnNotes(ratings, stalenessYears);
}
