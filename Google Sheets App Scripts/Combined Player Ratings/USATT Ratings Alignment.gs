/**
 * Annual USATT alignment for the club-kit spreadsheet.
 *
 * Every January 1st (set up as a time-driven trigger), this script nudges all
 * club ratings toward the official USATT ratings of players who have them, so
 * that the club scale matches the USATT scale.
 *
 * How it works:
 *   1. For each player with an Official USATT Rating (column E) whose Rating
 *      Date (column F) is NOT stale (default: within 2 years), compute
 *      (club rating - official rating).
 *   2. Take the mean of those differences.
 *   3. Shift EVERY player's club rating by that mean so official-rated players
 *      land as close as possible to their official rating (mean = least-squares
 *      optimal offset).
 *   4. Requires at least 3 valid official ratings; otherwise it skips and logs.
 *   5. Writes the result to an "Alignment Log" sheet for review/revert.
 *
 * Ratings sheet columns:
 *   A=rank  B=name  C=club rating  D=last updated  E=official USATT rating
 *   F=USATT rating date (the date the rating was ACHIEVED, not entered)
 *
 * Staleness: a rating older than SETUP staleness years is VOID. It is NOT
 * deleted - it stays in the sheet but turns RED. Valid ratings are GREEN.
 */

var ALIGN_RATINGS_SHEET = 'Ratings';
var ALIGN_LOG_SHEET = 'Alignment Log';
var ALIGN_DEFAULT_STALENESS_YEARS = 2;

function alignToUSATT() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ALIGN_RATINGS_SHEET);
  if (!sheet) {
    Logger.log('Ratings sheet not found; alignment aborted.');
    return;
  }

  var stalenessYears = getSetupValue(ss, 'USATT staleness (years)', ALIGN_DEFAULT_STALENESS_YEARS);

  var values = sheet.getRange('B2:F').getValues();
  var rows = [];      // {name, club, official, date}
  var validCount = 0;

  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][0]).trim();
    if (name === '') break;
    var club = parseFloat(values[i][1]);
    var official = parseFloat(values[i][3]);
    var dateRaw = values[i][4];

    if (isNaN(club)) continue;

    if (!isNaN(official)) {
      var d = parseDate(dateRaw);
      var isStale = isDateStale(d, stalenessYears);
      rows.push({ row: i + 2, name: name, club: club, official: official, date: d, stale: isStale });
      if (!isStale) validCount++;
    } else {
      rows.push({ row: i + 2, name: name, club: club, official: null, stale: false });
    }
  }

  // Color the official-rating column: green = valid, red = stale.
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].official === null) continue;
    var color = rows[i].stale ? '#ea9999' : '#b6d7a8';
    sheet.getRange('E' + rows[i].row).setBackground(color);
    sheet.getRange('F' + rows[i].row).setFontColor(rows[i].stale ? '#cc0000' : '#000000');
  }

  // Refresh column E/F header labels and date-column validation note.
  sheet.getRange('E1').setValue('Official USATT Rating');
  sheet.getRange('F1').setValue('USATT Rating Date');
  sheet.getRange('E1:F1').setFontWeight('bold');
  var note = sheet.getRange('F2');
  note.setNote('Enter the date this USATT rating was ACHIEVED (not the date it was submitted). '
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
    if (rows[i].official !== null && !rows[i].stale) {
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
    sheet.getRange('C' + rows[i].row).setValue(newRating);
    sheet.getRange('D' + rows[i].row).setValue(todayStr);
  }

  var applied = -offset;
  var summary = 'Applied USATT alignment offset of ' + round2(offset) +
    ' (' + (applied < 0 ? '' : '+') + round2(applied) + ' to every rating, rounded to the nearest 0.25). ' +
    'Based on ' + validCount + ' valid official rating(s): ' + validNames.join(', ');
  Logger.log(summary);
  appendLog(ss, new Date(), round2(offset), 'APPLIED', summary);
  ss.toast('USATT alignment applied (offset ' + round2(-offset) + ').', 'Done', 5);
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
