/**
 * Club-kit rating engine (no-Python version).
 *
 * Replicates tt-ratings.py's flow using the spreadsheet itself as the
 * player database instead of MongoDB:
 *
 *   updateRatingsFromSheet() - reads the active date sheet's scores,
 *     reads current ratings from the Ratings sheet, computes ELO changes
 *     via updateRating() (see CCTTC ELO.gs), and writes the results back
 *     to the Ratings sheet and the date sheet's league columns.
 *
 * Ratings sheet layout (same as the current CCTTC sheet):
 *   A = rank, B = player name, C = current rating, D = last-updated date.
 */

var RATINGS_SHEET_NAME = 'Ratings';
var RATINGS_HISTORY_SHEET_NAME = 'Ratings History';

var SCORE_RANGES = ['I3:U17', 'I20:U34', 'I37:U51'];
var PLAYER_RANGES = ['C3:C8', 'C20:C25', 'C37:C42'];
var LEAGUE_RATING_RANGES = ['D3:F8', 'D20:F25', 'D37:F42'];
var LEAGUE_START_ROWS = [3, 20, 37];

function getCurrentRatings(sheet) {
  var values = sheet.getRange('A2:D').getValues();
  var ratings = {};
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var name = String(row[1]).trim();
    if (!name || name === '') continue;
    var rating = parseFloat(row[2]);
    if (isNaN(rating)) continue;
    ratings[name] = rating;
  }
  return ratings;
}

function parseScoresRow(row) {
  // row is an array from I..U: [p1, '', p2, s1a, s1b, s2a, s2b, ...]
  var p1Name = String(row[0]).trim();
  var p2Name = String(row[2]).trim();
  if (p1Name === '' || p2Name === '') return null;

  var scoreDiffsP1 = [];
  var scoreDiffsP2 = [];
  var hasScores = false;
  for (var k = 3; k + 1 < row.length; k += 2) {
    var s1 = parseFloat(row[k]);
    var s2 = parseFloat(row[k + 1]);
    if (isNaN(s1) || isNaN(s2)) continue;
    if (s1 === 0 && s2 === 0) continue;
    hasScores = true;
    scoreDiffsP1.push(s1 - s2);
    scoreDiffsP2.push(s2 - s1);
  }
  if (!hasScores || scoreDiffsP1.length === 0) return null;

  return {
    p1: p1Name,
    p2: p2Name,
    p1Diffs: scoreDiffsP1,
    p2Diffs: scoreDiffsP2
  };
}

function updateRatingsFromSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var sheetName = sheet.getName();
  Logger.log('Engine start (v4-api) on sheet: ' + sheetName);

  if (sheetName === RATINGS_SHEET_NAME || sheetName === 'Template') {
    SpreadsheetApp.getUi().alert(
      'Run this on a date sheet (e.g., 08-02-2026), not on the Ratings sheet.');
    return;
  }

  var ratingsSheet = ss.getSheetByName(RATINGS_SHEET_NAME);
  if (!ratingsSheet) {
    SpreadsheetApp.getUi().alert("Ratings sheet not found.");
    return;
  }

  var currentRatings = getCurrentRatings(ratingsSheet);
  var changes = {};       // name -> sum of ELO changes
  var needsRating = {};   // players seen without a rating
  var matchByRow = {};    // [league][rowIndex] -> {p1Change, p2Change}

  for (var l = 0; l < 3; l++) {
    var scoreValues = sheet.getRange(SCORE_RANGES[l]).getValues();
    var playerValues = sheet.getRange(PLAYER_RANGES[l]).getValues();

    for (var j = 0; j < scoreValues.length; j++) {
      var parsed = parseScoresRow(scoreValues[j]);
      if (!parsed) continue;

      var p1Rating = currentRatings[parsed.p1];
      var p2Rating = currentRatings[parsed.p2];
      if (p1Rating === undefined) needsRating[parsed.p1] = true;
      if (p2Rating === undefined) needsRating[parsed.p2] = true;
      if (p1Rating === undefined || p2Rating === undefined) continue;

      var newP1 = updateRating(p1Rating, p2Rating, parsed.p1Diffs);
      var newP2 = updateRating(p2Rating, p1Rating, parsed.p2Diffs);

      changes[parsed.p1] = (changes[parsed.p1] || 0) + (newP1 - p1Rating);
      changes[parsed.p2] = (changes[parsed.p2] || 0) + (newP2 - p2Rating);
      if (!matchByRow[l]) matchByRow[l] = {};
      matchByRow[l][j] = {
        p1Change: newP1 - p1Rating,
        p2Change: newP2 - p2Rating
      };
    }

    if (playerValues && playerValues.length > 0) {
      Logger.log('League ' + (l + 1) + ' players: ' +
        playerValues.filter(function (r) { return r[0] && String(r[0]).trim() !== ''; })
          .map(function (r) { return String(r[0]).trim(); }).join(', '));
    }
  }

  // Report unrated players (admin must type an initial rating, then re-run).
  var unrated = Object.keys(needsRating);
  if (unrated.length > 0) {
    Logger.log('Players needing an initial rating in the Ratings sheet: ' + unrated.join(', '));
  }

  // Build updated ratings list.
  var newRatings = {};
  var allNames = {};
  for (var name in currentRatings) allNames[name] = true;
  for (var name in changes) allNames[name] = true;

  for (var name in allNames) {
    var base = currentRatings[name] !== undefined ? currentRatings[name] : null;
    if (base === null) continue; // unrated player: skip until admin assigns a rating
    // Ratings live on the USATT quarter-point scale. ELO changes are already
    // 0.25 multiples, so this is normally a no-op; it only snaps ratings that
    // were hand-entered off-grid (e.g. 1000.10 -> 1000.00).
    newRatings[name] = roundQuarter(base + (changes[name] || 0));
  }

  // Sort descending by rating.
  var sortedNames = Object.keys(newRatings).sort(function (a, b) {
    return newRatings[b] - newRatings[a];
  });

  var today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy');

  // Preserve existing D-column dates; only players whose rating actually
  // changed this run get today's date (D = "last date the rating changed").
  var existingDates = {};
  var curValues = ratingsSheet.getRange('A2:D').getValues();
  for (var ci = 0; ci < curValues.length; ci++) {
    var cName = String(curValues[ci][1]).trim();
    if (cName !== '') existingDates[cName] = curValues[ci][3];
  }

  // Write to Ratings sheet (A=rank, B=name, C=rating, D=date).
  var outRows = [];
  for (var i = 0; i < sortedNames.length; i++) {
    var name = sortedNames[i];
    var changed = (changes[name] || 0) !== 0;
    var dVal = changed ? today : (existingDates[name] !== undefined ? existingDates[name] : '');
    outRows.push([i + 1, name, round2(newRatings[name]), dVal]);
  }
  if (outRows.length > 0) {
    ratingsSheet.getRange('A2:D' + (outRows.length + 1)).setValues(outRows);
  }

  // Participating players = everyone who appeared in a scored match this run.
  // Only these get a Ratings History entry for today; non-participants keep
  // their existing history untouched.
  var participated = {};
  for (var pn in changes) participated[pn] = true;
  var participants = [];
  for (var oi = 0; oi < outRows.length; oi++) {
    var oname = String(outRows[oi][1]).trim();
    if (oname !== '' && participated[oname]) {
      participants.push({ name: oname, rating: outRows[oi][2], date: outRows[oi][3] });
    }
  }

  // Resolve the date sheet's ID once for the API write (mirrors Python).
  var sheetId = null;
  if (typeof Sheets !== 'undefined') {
    var sheetsMeta = Sheets.Spreadsheets.get(ss.getId()).sheets;
    for (var si = 0; si < sheetsMeta.length; si++) {
      if (sheetsMeta[si].properties.title === sheetName) {
        sheetId = sheetsMeta[si].properties.sheetId;
        break;
      }
    }
  }

  // Write per-league rating display on the date sheet (D/E/F columns).
  for (var l = 0; l < 3; l++) {
    var playerValues = sheet.getRange(PLAYER_RANGES[l]).getValues();
    var leagueRows = [];
    for (var j = 0; j < playerValues.length; j++) {
      var name = String(playerValues[j][0]).trim();
      if (name === '') {
        leagueRows.push(['', '', '']);
      } else if (newRatings[name] !== undefined) {
        var oldVal = currentRatings[name] !== undefined ? currentRatings[name] : newRatings[name];
        var diff = newRatings[name] - oldVal;
        // Write old/new ratings and the diff as strings (2 decimals) so
        // "1000.00" stays literal; each ends with one trailing '.' (colored to
        // match the column background below) because trailing spaces get
        // trimmed on Android and would break the right-justified alignment.
        var dStr = oldVal.toFixed(2) + '.';
        var diffStr = padDiff(diff);
        var fStr = newRatings[name].toFixed(2) + '.';
        leagueRows.push([dStr, diffStr, fStr]);
      } else {
        leagueRows.push(['', '', '']);
      }
    }
    if (leagueRows.length > 0 && sheetId !== null) {
      // Write D/E/F via the Sheets API updateCells with explicit stringValue,
      // mirroring tt-ratings.py's set_new_ratings. Apps Script's setValues and
      // setRichTextValues both parse a leading '+' as a formula (writing
      // "=+22.50."); an explicit stringValue does not. The trailing '.' is
      // colored #c9daf8 (the column background) via textFormatRuns so it is
      // invisible but holds real width on every platform.
      var blue = { red: 0.7882353, green: 0.85490197, blue: 0.972549 };
      var rowsData = [];
      for (var j = 0; j < leagueRows.length; j++) {
        var cells = [];
        for (var c = 0; c < 3; c++) {
          var txt = leagueRows[j][c];
          var cell = {
            userEnteredValue: { stringValue: txt },
            userEnteredFormat: {
              numberFormat: { type: 'TEXT', pattern: '@' },
              horizontalAlignment: 'RIGHT'
            }
          };
          if (txt !== '') {
            // Black run at index 0 keeps the visible text black (a lone dot run
            // would bleed its color across the whole cell); the trailing '.' is
            // then colored #c9daf8 so it is invisible against the background.
            var runs = [{
              startIndex: 0,
              format: { foregroundColor: { red: 0, green: 0, blue: 0 } }
            }];
            if (txt.charAt(txt.length - 1) === '.') {
              runs.push({
                startIndex: txt.length - 1,
                format: { foregroundColor: blue }
              });
            }
            cell.textFormatRuns = runs;
          }
          cells.push(cell);
        }
        rowsData.push({ values: cells });
      }
      var startRow = LEAGUE_START_ROWS[l] - 1; // 0-indexed
      var endRow = startRow + leagueRows.length;
      Sheets.Spreadsheets.batchUpdate({
        requests: [{
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: startRow,
              endRowIndex: endRow,
              startColumnIndex: 3, // D
              endColumnIndex: 6    // G exclusive
            },
            rows: rowsData,
            fields: 'userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'
          }
        }]
      }, ss.getId());
      // Diagnostic: confirm nothing in D/E/F came back as a formula ('=' prefix).
      var check = sheet.getRange(LEAGUE_RATING_RANGES[l]).getValues();
      for (var ci = 0; ci < check.length; ci++) {
        for (var cj = 0; cj < check[ci].length; cj++) {
          if (String(check[ci][cj]).charAt(0) === '=') {
            Logger.log('Engine: WARNING - ' + LEAGUE_RATING_RANGES[l] + ' cell ' +
              ci + ',' + cj + ' stored as formula: ' + check[ci][cj]);
          }
        }
      }
    } else if (typeof Sheets === 'undefined') {
      SpreadsheetApp.getUi().alert(
        'Enable the "Google Sheets API" advanced service first: in the Apps Script editor, ' +
        'click + next to Services, add "Sheets", click Save, then run again.');
      return;
    }
  }

  // Write ELO change into column J (index 1) of each score row, and color the
  // winner's name cell green (column I for a P1 win, column K for a P2 win).
  // Only rows that actually carry game scores get a change; an empty row with
  // the same player pair must NOT inherit another match's change.
  for (var l = 0; l < 3; l++) {
    var range = sheet.getRange(SCORE_RANGES[l]);
    var values = range.getValues();
    var bg = range.getBackgrounds();
    for (var j = 0; j < values.length; j++) {
      values[j][1] = '';            // clear stale ELO change first
      // Clear any stale winner highlight on this row's name cells; a row with
      // no winner this run must not stay green.
      bg[j][0] = null;
      bg[j][2] = null;
      var rowHasScores = values[j].length > 4 &&
        !isNaN(parseFloat(values[j][3])) && !isNaN(parseFloat(values[j][4]));
      if (!rowHasScores) continue;
      var mc = matchByRow[l] && matchByRow[l][j];
      if (!mc) continue;
      values[j][1] = round2(Math.abs(mc.p1Change)).toFixed(2);
      if (mc.p1Change > 0) {
        bg[j][0] = '#c5eec5';       // P1 won -> highlight their name cell
      } else if (mc.p2Change > 0) {
        bg[j][2] = '#c5eec5';       // P2 won -> highlight their name cell
      }
    }
    range.setValues(values);
    range.setBackgrounds(bg);
  }

  // Append today's ratings for participating players to the Ratings History
  // tab (only players who actually played get a value in today's column).
  var histCount = updateRatingsHistory(participants, today);

  Logger.log('Engine updateRatingsFromSheet complete.');
  ss.toast('Ratings updated for ' + sortedNames.length + ' players (history: ' + histCount + ').', 'Done', 3);

  if (unrated.length > 0) {
    SpreadsheetApp.getUi().alert(
      'These players had no rating and were skipped (add a rating to the Ratings sheet, then run again):\n' +
      unrated.join(', '));
  }
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function roundQuarter(v) {
  // Snap to the USATT quarter-point scale (x.00/.25/.50/.75).
  return Math.round(v * 4) / 4;
}

function padDiff(diff) {
  // '+X.XX.' for increase, '-X.XX.' for decrease, '0.00.' for no change. The
  // trailing '.' is colored to match the column background (see caller) so it
  // is invisible but occupies real width (trailing spaces get trimmed).
  var sign = diff > 0 ? '+' : '';
  return sign + round2(diff).toFixed(2) + '.';
}

/**
 * Append today's ratings for participating players to the Ratings History tab.
 *
 * Dated columns start at column I (index 9 in 1-based A1 terms). The column
 * whose header matches today is filled with each participant's rating; if no
 * such column exists yet it is appended on the right. Only players who played
 * a scored match get a value today; everyone else's history stays untouched.
 * New names (not yet in column B) are appended at the bottom.
 *
 * Mirrors the Python flow's update_ratings_history_tab, but writes ONLY
 * participating players instead of every rated player.
 *
 * @param {Array.<{name: string, rating: number, date: string}>} participants
 * @param {string} todayStr Date as 'MM-dd-yyyy' (already resolved in the sheet's time zone).
 * @return {number} Number of players written to today's column.
 */
function updateRatingsHistory(participants, todayStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hist = ss.getSheetByName(RATINGS_HISTORY_SHEET_NAME);
  if (!hist) {
    hist = createRatingsHistoryTab(ss);
    if (!hist) return 0;
  }

  var today = parseDatedHeader(todayStr);
  if (!today) return 0;

  // Scan dated headers (from column I onward) for today's column.
  var headers = [];
  if (hist.getLastColumn() >= 9) {
    headers = hist.getRange(1, 9, 1, hist.getLastColumn() - 8).getValues()[0];
  }
  var colIndex = -1;   // 0-based column index (I = 8)
  var lastCol = 8;     // 0-based index of the last dated column
  for (var i = 0; i < headers.length; i++) {
    var hd = parseDatedHeader(headers[i]);
    if (!hd) continue;
    lastCol = 8 + i;
    if (isSameDay(hd, today)) {
      colIndex = lastCol;
      break;
    }
  }

  if (colIndex === -1) {
    colIndex = lastCol + 1;
    var headerCell = hist.getRange(1, colIndex + 1);
    headerCell.setValue(today);
    headerCell.setNumberFormat('MMM d, yy');
  }

  // Name -> row map from column B so we write into the right player's row.
  var bVals = hist.getRange('B2:B').getValues();
  var nameRow = {};
  var lastRow = 1;
  for (var r = 0; r < bVals.length; r++) {
    var nm = String(bVals[r][0]).trim();
    if (nm === '') continue;
    nameRow[nm] = r + 2;
    lastRow = r + 2;
  }

  var colNum = colIndex + 1; // 1-based column number for getRange
  var written = 0;
  for (var p = 0; p < participants.length; p++) {
    var pname = String(participants[p].name).trim();
    if (pname === '') continue;
    var row = nameRow[pname];
    if (!row) {
      lastRow++;
      row = lastRow;
      hist.getRange('B' + row).setValue(pname);
      nameRow[pname] = row;
    }
    hist.getRange(row, colNum).setValue(round2(participants[p].rating));
    written++;
  }
  return written;
}

/** Create the Ratings History tab with the standard header row if it is missing. */
function createRatingsHistoryTab(ss) {
  var tab = ss.getSheetByName(RATINGS_HISTORY_SHEET_NAME);
  if (tab) return tab;
  var newTab = ss.insertSheet(RATINGS_HISTORY_SHEET_NAME);
  newTab.getRange('A1:H1').setValues([['', 'Player Names', 'USATT Ratings', 'Date Earned',
    '', 'Club Ratings', 'Date Earned', 'Ratings History']]);
  return newTab;
}

/** Parse a header cell value (Date, Excel serial, or date string) into a Date, or null. */
function parseDatedHeader(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    return new Date(Math.round((v - 25569) * 86400000));
  }
  if (typeof v === 'string') {
    v = v.trim();
    if (v === '') return null;
    var parts = v.split(/[-/]/);
    if (parts.length === 3) {
      var a = parseInt(parts[0], 10);
      var b = parseInt(parts[1], 10);
      var y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      // 'MM-dd-yyyy' first; fall back to 'dd-MM-yyyy' when the first number
      // cannot be a month (e.g. a day > 12).
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return new Date(y, a - 1, b);
      if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return new Date(y, b - 1, a);
    }
    var d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
