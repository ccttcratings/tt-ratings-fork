/**
 * Manual USATT alignment for the club-kit spreadsheet.
 *
 * Run by the OPERATOR whenever he wants (typically after new USATT ratings are
 * submitted), e.g. via the "Equalize Ratings" button on the Ratings History
 * tab. This is NOT an automatic/triggered job - the operator decides when.
 *
 * How it works:
 *   1. For each player with an Official USATT Rating (Ratings History column C)
 *      whose Rating Date (column D) is NOT stale (default: within 2 years),
 *      compute (club rating - official rating). The live club rating is read
 *      from the Ratings tab (column C), the canonical source used by games.
 *   2. Take the mean of those differences.
 *   3. Shift EVERY player's club rating by that mean so official-rated players
 *      land as close as possible to their official rating (mean = least-squares
 *      optimal offset).
 *   4. Requires at least 3 valid official ratings; otherwise it skips and logs.
 *   5. Writes the shifted rating back to the Ratings tab (C/D) AND to the
 *      Ratings History tab Club Rating (F) / Date Earned (G) so both stay in
 *      sync.
 *   6. Applies the SAME uniform offset to every dated historical column
 *      (I onward) so the line chart stays continuous - without this, the
 *      pre-alignment points would sit on the old scale and the graph would
 *      show a step-change bump at the alignment date.
 *   7. Writes the result to an "Alignment Log" sheet for review/revert.
 *
 * Ratings History tab columns:
 *   B=name  C=official USATT rating  D=USATT rating date (date ACHIEVED)
 *   E=Equalize button  F=club rating  G=club rating date  H=spacer
 *   I+=dated historical ratings
 *
 * Staleness: a rating older than SETUP staleness years is VOID. It is NOT
 * deleted - it stays in the sheet but turns RED. Valid ratings are GREEN.
 */

var ALIGN_HISTORY_SHEET = 'Ratings History';
var ALIGN_RATINGS_SHEET = 'Ratings';
var ALIGN_LOG_SHEET = 'Alignment Log';
var ALIGN_DEFAULT_STALENESS_YEARS = 2;

function alignToUSATT() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hist = ss.getSheetByName(ALIGN_HISTORY_SHEET);
  var ratings = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  if (!hist) {
    Logger.log('Ratings History sheet not found; alignment aborted.');
    return;
  }
  if (!ratings) {
    Logger.log('Ratings sheet not found; alignment aborted.');
    return;
  }

  var stalenessYears = getSetupValue(ss, 'USATT staleness (years)', ALIGN_DEFAULT_STALENESS_YEARS);

  // Live club ratings (canonical) from the Ratings tab: name -> rating + row.
  var clubByRow = {};
  var ratingsValues = ratings.getRange('B2:C').getValues();
  for (var i = 0; i < ratingsValues.length; i++) {
    var rName = String(ratingsValues[i][0]).trim();
    if (rName === '') continue;
    var rClub = parseFloat(ratingsValues[i][1]);
    if (!isNaN(rClub)) clubByRow[rName] = { rating: rClub, row: i + 2 };
  }

  // Official USATT ratings + dates live on the Ratings History tab (C/D).
  var rows = [];      // {histRow, name, club, official, date, stale}
  var validCount = 0;
  var histValues = hist.getRange('B2:D').getValues();
  for (var i = 0; i < histValues.length; i++) {
    var name = String(histValues[i][0]).trim();
    if (name === '') break;
    var official = parseFloat(histValues[i][1]);
    var dateRaw = histValues[i][2];
    var club = clubByRow[name] ? clubByRow[name].rating : NaN;

    if (isNaN(official)) {
      rows.push({ histRow: i + 2, name: name, club: club, official: null, date: null, stale: false });
      continue;
    }
    var d = parseDate(dateRaw);
    var isStale = isDateStale(d, stalenessYears);
    rows.push({ histRow: i + 2, name: name, club: club, official: official, date: d, stale: isStale });
    if (!isStale && !isNaN(club)) validCount++;
  }

  // Color the official-rating column: green = valid, red = stale.
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].official === null) continue;
    var color = rows[i].stale ? '#ea9999' : '#b6d7a8';
    hist.getRange('C' + rows[i].histRow).setBackground(color);
    hist.getRange('D' + rows[i].histRow).setFontColor(rows[i].stale ? '#cc0000' : '#000000');
  }

  // Refresh the USATT date-column validation note.
  hist.getRange('D2').setNote('Enter the date this USATT rating was ACHIEVED (not the date it was submitted). '
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
    var ratingsEntry = clubByRow[rows[i].name];
    if (ratingsEntry) {
      ratings.getRange('C' + ratingsEntry.row).setValue(newRating);
      ratings.getRange('D' + ratingsEntry.row).setValue(todayStr);
    }
    hist.getRange('F' + rows[i].histRow).setValue(newRating);
    hist.getRange('G' + rows[i].histRow).setValue(todayStr);
  }

  // Shift every dated historical column (I onward) by the same uniform offset
  // so the line chart stays continuous across the alignment. Without this the
  // pre-alignment points would remain on the old scale and the graph would
  // show a step-change bump right at the alignment date. We apply the raw
  // offset (not the per-player quarter-rounded amount) so all players' lines
  // move together and keep their relative shape.
  shiftHistoricalColumns(hist, offset);

  var applied = -offset;
  var summary = 'Applied USATT alignment offset of ' + round2(offset) +
    ' (' + (applied < 0 ? '' : '+') + round2(applied) + ' to every rating, rounded to the nearest 0.25). ' +
    'Historical dated columns (I onward) shifted by the same offset to keep the chart continuous. ' +
    'Based on ' + validCount + ' valid official rating(s): ' + validNames.join(', ');
  Logger.log(summary);
  appendLog(ss, new Date(), round2(offset), 'APPLIED', summary);
  ss.toast('USATT alignment applied (offset ' + round2(-offset) + ').', 'Done', 5);
}

/**
 * Shift every dated historical rating column (I onward) on the Ratings History
 * tab by the given offset (applied as `value - offset`, matching the club-rating
 * shift). The dated columns start at column I (index 9), and the first column
 * header (I1) is a date - the loop skips it so headers are never touched.
 */
function shiftHistoricalColumns(hist, offset) {
  var startCol = 9; // column I
  var lastCol = hist.getLastColumn();
  var lastRow = hist.getLastRow();
  if (lastCol < startCol || lastRow < 2) return;

  // Grab EVERYTHING from Column I to the end of the sheet in ONE call, shift in
  // memory, then write back in ONE call. (Looping getRange/getValues/setValues
  // per column is slow and would time out as history grows.)
  var numCols = lastCol - startCol + 1;
  var range = hist.getRange(1, startCol, lastRow, numCols);
  var values = range.getValues();

  var totalChanged = false;

  for (var r = 1; r < values.length; r++) { // skip header row (r=0)
    for (var c = 0; c < numCols; c++) {
      var v = values[r][c];
      if (typeof v === 'number' && !isNaN(v)) {
        values[r][c] = round2(v - offset);
        totalChanged = true;
      } else if (typeof v === 'string' && v.trim() !== '' && !isNaN(parseFloat(v))) {
        values[r][c] = round2(parseFloat(v) - offset);
        totalChanged = true;
      }
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
