/**
 * Manual USATT alignment for the club-kit spreadsheet.
 *
 * Run by the OPERATOR whenever he wants (typically after new USATT ratings are
 * submitted), e.g. via the "Equalize Ratings" button on the Ratings tab. This
 * is NOT an automatic/triggered job - the operator decides when.
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
 *   4. Requires at least 3 valid official ratings; otherwise it skips and logs.
 *   5. Writes the shifted rating back to the Ratings tab (C/D).
 *   6. Applies the SAME uniform offset to every historical rating on the
 *      "Ratings Graph" tab (column C in the long/tidy Player|Date|Rating
 *      layout) so the line chart stays continuous - without this, the
 *      pre-alignment points would sit on the old scale and the graph would
 *      show a step-change bump at the alignment date.
 *   7. Writes the result to an "Alignment Log" sheet for review/revert.
 *
 * Combined Ratings tab columns:
 *   A=rank  B=name  C=club rating  D=club rating date  E=Equalize button
 *   F=USATT rating  G=USATT date earned  H=Show Inactive button
 *   I-J blank  K=Hide Inactive button  CB=primary emails  CE=secondary emails
 *
 * Staleness: a rating older than SETUP staleness years is VOID. It is NOT
 * deleted - it stays in the sheet but turns RED. Valid ratings are GREEN.
 */

var ALIGN_RATINGS_SHEET = 'Ratings';
var ALIGN_GRAPH_SHEET = 'Rating History';
var ALIGN_GRAPH_HEADER_ROW = 1;
var ALIGN_LOG_SHEET = 'Alignment Log';
var ALIGN_DEFAULT_STALENESS_YEARS = 2;

function alignToUSATT() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratings = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  if (!ratings) {
    Logger.log('Ratings sheet not found; alignment aborted.');
    return;
  }

  var stalenessYears = getSetupValue(ss, 'USATT staleness (years)', ALIGN_DEFAULT_STALENESS_YEARS);

  // Read rank/name/club/date + USATT rating/date in one pass (A..G).
  var rows = [];      // {row, name, club, official, date, stale}
  var validCount = 0;
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
    if (!isStale && !isNaN(club)) validCount++;
  }

  // Color the official-rating column (F): green = valid, red = stale.
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].official === null) continue;
    var color = rows[i].stale ? '#ea9999' : '#b6d7a8';
    ratings.getRange('F' + rows[i].row).setBackground(color);
    ratings.getRange('G' + rows[i].row).setFontColor(rows[i].stale ? '#cc0000' : '#000000');
  }

  // Refresh the USATT date-column validation note.
  ratings.getRange('G2').setNote('Enter the date this USATT rating was ACHIEVED (not the date it was submitted). '
    + 'Ratings older than ' + stalenessYears + ' years turn red and are excluded from the annual USATT alignment.');

  if (validCount < 3) {
    var msg = 'Alignment skipped: only ' + validCount + ' player(s) with a valid (non-stale) official rating. Need at least 3.';
    Logger.log(msg);
    appendLog(ss, new Date(), null, 'SKIPPED', msg);
    ss.toast(msg, 'USATT Alignment', 5);
    return;
  }

  // Mean of (club - official) over valid players.
  var totalDiff = 0;
  var validNames = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].official !== null && !rows[i].stale && !isNaN(rows[i].club)) {
      totalDiff += (rows[i].club - rows[i].official);
      validNames.push(rows[i].name);
    }
  }
  var offset = totalDiff / validCount;

  // Apply the shift to every club rating (including unrated-official players).
  var todayStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy');
  for (var i = 0; i < rows.length; i++) {
    if (isNaN(rows[i].club)) continue;
    // USATT ratings live on a quarter-point scale (x.00/.25/.50/.75), so round
    // every aligned rating to the nearest quarter.
    var newRating = roundQuarter(rows[i].club - offset);
    ratings.getRange('C' + rows[i].row).setValue(newRating);
    ratings.getRange('D' + rows[i].row).setValue(todayStr);
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

  var applied = -offset;
  var summary = 'Applied USATT alignment offset of ' + round2(offset) +
    ' (' + (applied < 0 ? '' : '+') + round2(applied) + ' to every rating, rounded to the nearest 0.25). ' +
    'Historical ratings on the Ratings Graph tab (long/tidy layout, column C) shifted by the same offset to keep the chart continuous. ' +
    'Based on ' + validCount + ' valid official rating(s): ' + validNames.join(', ');
  Logger.log(summary);
  appendLog(ss, new Date(), round2(offset), 'APPLIED', summary);
  ss.toast('USATT alignment applied (offset ' + round2(-offset) + ').', 'Done', 5);
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
