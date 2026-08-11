/**
 * Club-kit rating engine (no-Python version).
 *
 * Replicates tt-ratings.py's flow using the spreadsheet itself as the
 * player database instead of MongoDB:
 *
 *   runRatingsEngine() - reads the active date sheet's scores,
 *     reads current ratings from the Ratings sheet, computes ELO changes
 *     via updateRating() (see CCTTC ELO.gs), and writes the results back
 *     to the Ratings sheet and the date sheet's league columns.
 *
 * Combined Ratings sheet layout (single tab):
 *   A = rank, B = player name, C = club rating, D = last-updated date,
 *   E = Equalize button (instructions below), F = USATT rating,
 *   G = USATT date earned, H = Show Inactive button, I-J blank,
 *   K = Hide Inactive button, CH = primary emails, CK = secondary emails.
 *
 * Dated rating history lives on a hidden "Rating History" tab in long/tidy
 * format: header row 1 (A=Player, B=Date, C=Rating) and one data row per
 * player per session from row 2 onward. The "Ratings Graph" tab shows a
 * checkbox roster (A=Show/Hide checkbox, B=player name, C=color swatch) in a
 * left sidebar with the line chart anchored at column D; a hidden "Chart Data"
 * tab pivots the history into the wide date-by-player grid the chart reads.
 * Series flatline (carry their last rating forward) during inactive periods.
 */

var RATINGS_SHEET_NAME = 'Ratings';
var RATINGS_HISTORY_SHEET_NAME = 'Rating History';
var RATINGS_HISTORY_HEADER_ROW = 1;
var RATINGS_HISTORY_DATA_START_ROW = 2;

var SCORE_RANGES = ['I3:U17', 'I20:U34', 'I37:U51'];
var PLAYER_RANGES = ['C3:C8', 'C20:C25', 'C37:C42'];
var LEAGUE_RATING_RANGES = ['D3:F8', 'D20:F25', 'D37:F42'];
var LEAGUE_START_ROWS = [3, 20, 37];
var POINT_WINNER_RANGES = ['D12', 'D29', 'D46'];

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

function isSuspectedTypo(row) {
  // Implemented in Player Ratings.gs (always deployed, both CCTTC and combined
  // systems) — call it through the global scope so this file never shadows it.
  return globalThis.isSuspectedTypo(row);
}

function runRatingsEngine() {
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

  // New-player check runs BEFORE the typo gate. Any name on the date sheet that
  // is not already in the Ratings sheet triggers a confirmation dialog (new
  // player vs typo). A confirmed new player is prompted for an initial rating
  // and email, inserted at the bottom of the Ratings tab, then the run resumes
  // with the typo gate and the ELO computation.
  var newPlayers = findNewPlayers(sheet);
  if (newPlayers.length > 0) {
    // Remember the date sheet so the chained dialogs (and the resumed run)
    // can find it even if the operator switches tabs while confirming.
    CacheService.getScriptCache().put('engineSheet', sheetName, 600);
    showNewPlayerDialog(newPlayers[0], 0, newPlayers.length);
    return;
  }

  runEngineCore(sheet, sheetName);
}

function runEngineCore(sheet, sheetName) {
  // Typo gate: check for suspected score typos BEFORE computing ratings. If any
  // are found, flag their J cells red and open a modeless dialog so the operator
  // can fix them in the sheet, then click Re-check; once the data is clean the
  // same run continues automatically (typoRecheck -> runRatingsEngine).
  var typos = scanForTypos(sheet);
  if (typos.length > 0) {
    flagTypoRows(sheet, typos);
    showTypoDialog("updateRatings", sheetName, typos);
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratingsSheet = ss.getSheetByName(RATINGS_SHEET_NAME);
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

  // Sort and write the Ratings tab (shared with rerankRatings()).
  var result = writeRatingsTab(ss, ratingsSheet, currentRatings, changes);
  var outRows = result.outRows;
  var newRatings = result.newRatings;
  var today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy');

  // Participating players = everyone who appeared in a scored match this run.
  // Only these get a Ratings Graph entry for today; non-participants keep
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
    } else if (typeof Sheets === 'undefined') {
      SpreadsheetApp.getUi().alert(
        'Enable the "Google Sheets API" advanced service first: in the Apps Script editor, ' +
        'click + next to Services, add "Sheets", click Save, then run again.');
      return;
    }
  }

  // Write the highest point winner for each league to D12/D29/D46: the player
  // in that league (column C) whose rating gain this run is the biggest.
  for (var l = 0; l < 3; l++) {
    var pwPlayerValues = sheet.getRange(PLAYER_RANGES[l]).getValues();
    var pwWinners = [];
    var pwMaxChange = null;
    for (var j = 0; j < pwPlayerValues.length; j++) {
      var pwName = String(pwPlayerValues[j][0]).trim();
      if (pwName === '') continue;
      var pwChange = changes[pwName] !== undefined ? changes[pwName] : 0;
      if (pwMaxChange === null || pwChange > pwMaxChange) {
        pwMaxChange = pwChange;
        pwWinners = [pwName];
      } else if (pwChange === pwMaxChange) {
        pwWinners.push(pwName);
      }
    }
    if (pwMaxChange === null || pwWinners.length === 0) continue;
    // On a tie, sort by current rating (highest first), mirroring the Python engine.
    pwWinners.sort(function (a, b) {
      var ra = newRatings[a] !== undefined ? newRatings[a] : 0;
      var rb = newRatings[b] !== undefined ? newRatings[b] : 0;
      return rb - ra;
    });
    var pwWinnerStr = pwWinners.join(', ');
    sheet.getRange(POINT_WINNER_RANGES[l]).setValue(pwWinnerStr);
    Logger.log('League ' + (l + 1) + ' highest point winner: ' + pwWinnerStr +
      ' (+' + pwMaxChange.toFixed(2) + ')');
  }

  // Write ELO change into column J (index 1) of each score row and color the
  // winner's name cell green (column I for a P1 win, column K for a P2 win).
  // Suspected typos are caught by the gate before this loop runs. Only rows
  // that actually carry game scores get a change; an empty row with the same
  // player pair must NOT inherit another match's change.
  for (var l = 0; l < 3; l++) {
    var range = sheet.getRange(SCORE_RANGES[l]);
    var values = range.getValues();
    var bg = range.getBackgrounds();
    for (var j = 0; j < values.length; j++) {
      values[j][1] = '';            // clear stale ELO change first
      // Clear any stale winner highlight on this row's name cells and any stale
      // typo flag on column J; a row with no winner / no typo this run must not
      // stay highlighted.
      bg[j][0] = null;
      bg[j][1] = null;
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

  // Append today's ratings for participating players to the Ratings Graph tab
  // (only players who actually played get a value in today's column).
  var histCount = updateRatingsHistory(participants, today);

  Logger.log('Engine runRatingsEngine complete.');
  ss.toast('Ratings updated for ' + sortedNames.length + ' players (history: ' + histCount + ').', 'Done', 3);

  if (unrated.length > 0) {
    SpreadsheetApp.getUi().alert(
      'These players had no rating and were skipped (add a rating to the Ratings sheet, then run again):\n' +
      unrated.join(', '));
  }
}

/**
 * Names on the date sheet that have no entry in the Ratings sheet. Runs BEFORE
 * the typo gate so a genuinely new player can be confirmed and added with an
 * initial club rating instead of silently skipping their matches. Order is
 * preserved as names first appear in the sheet (league 1 top to league 3).
 */
function findNewPlayers(sheet) {
  var ratingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATINGS_SHEET_NAME);
  var currentRatings = getCurrentRatings(ratingsSheet);
  var seen = {};
  var newPlayers = [];
  for (var l = 0; l < PLAYER_RANGES.length; l++) {
    var values = sheet.getRange(PLAYER_RANGES[l]).getValues();
    for (var j = 0; j < values.length; j++) {
      var name = String(values[j][0]).trim();
      if (name === '') continue;
      if (currentRatings[name] === undefined && !seen[name]) {
        seen[name] = true;
        newPlayers.push(name);
      }
    }
  }
  return newPlayers;
}

/**
 * One-at-a-time confirmation dialog: "New Player" vs "Typo". Choosing "Typo"
 * cancels the whole run so the operator can fix the spelling and rerun.
 */
function showNewPlayerDialog(name, index, total) {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(buildNewPlayerDialogHtml(name, index, total))
      .setWidth(400).setHeight(240),
    'New player detected');
}

function buildNewPlayerDialogHtml(name, index, total) {
  var safeName = escapeHtml(name);
  return '<!DOCTYPE html><html><head><base target="_top"></head><body>' +
    '<h3>New player detected</h3>' +
    '<p><b>' + safeName + '</b> is not in the Ratings sheet' +
    (total > 1 ? ' (' + (index + 1) + ' of ' + total + ').' : '.') + '</p>' +
    '<p>Is this a new player, or is the name spelled wrong?</p>' +
    '<p>' +
    '<button onclick="newPlayer()">New Player</button> ' +
    '<button onclick="typo()">Typo</button>' +
    '</p>' +
    '<script>' +
    'function newPlayer() {' +
    '  google.script.run.newPlayerRatingDialog(' + JSON.stringify(name) + ');' +
    '}' +
    'function typo() {' +
    '  google.script.run.withSuccessHandler(function () { google.script.host.close(); })' +
    '    .cancelEngineForTypo(' + JSON.stringify(name) + ');' +
    '}' +
    '</script>' +
    '</body></html>';
}

function cancelEngineForTypo(name) {
  SpreadsheetApp.getUi().alert(
    'The "Run Ratings Engine" has been canceled!',
    "Correct the 'player name' spelling and try running the Ratings Engine again.",
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Ask for the initial club rating, then hand off to the email dialog. */
function newPlayerRatingDialog(name) {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(buildNewPlayerRatingDialogHtml(name))
      .setWidth(380).setHeight(230),
    'Initial rating for ' + name);
}

function buildNewPlayerRatingDialogHtml(name) {
  return '<!DOCTYPE html><html><head><base target="_top"></head><body>' +
    '<h3>Initial club rating</h3>' +
    '<p>Enter the starting club rating for <b>' + escapeHtml(name) +
    '</b> (e.g., 1500):</p>' +
    '<p><input id="rating" type="number" step="0.25" min="0" placeholder="e.g. 1500" style="width:150px"></p>' +
    '<p>' +
    '<button id="okBtn" onclick="submitRating()">OK</button> ' +
    '<button onclick="cancel()">Cancel</button>' +
    '</p>' +
    '<div id="status" style="color:#cc0000"></div>' +
    '<script>' +
    'function submitRating() {' +
    '  var r = document.getElementById("rating").value.trim();' +
    '  if (r === "" || isNaN(parseFloat(r))) {' +
    '    document.getElementById("status").textContent = "Enter a numeric rating.";' +
    '    return;' +
    '  }' +
    '  document.getElementById("okBtn").disabled = true;' +
    '  google.script.run.addNewPlayerRating(' + JSON.stringify(name) + ', parseFloat(r));' +
    '}' +
    'function cancel() { google.script.host.close(); }' +
    '</script>' +
    '</body></html>';
}

/**
 * Insert the confirmed new player on the empty row below the lowest-ranked
 * player (rank in A, name in B, rating in C, today in D) and ask for the email.
 */
function addNewPlayerRating(name, rating) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratingsSheet = ss.getSheetByName(RATINGS_SHEET_NAME);
  var newRow = insertNewPlayerRow(ratingsSheet, name, rating);
  showNewPlayerEmailDialog(name, newRow);
}

function insertNewPlayerRow(ratingsSheet, name, rating) {
  // Lowest-ranked player is the last non-empty row in column B (rank 1 is row 2).
  var bValues = ratingsSheet.getRange('B2:B').getValues();
  var lastPlayerRow = 1; // sheet row of the last player; 1 means none yet
  for (var i = 0; i < bValues.length; i++) {
    if (String(bValues[i][0]).trim() !== '') lastPlayerRow = i + 2;
  }
  var newRow = lastPlayerRow + 1;
  ratingsSheet.getRange('A' + newRow).setValue(lastPlayerRow); // rank = lowest + 1
  ratingsSheet.getRange('B' + newRow).setValue(name);
  ratingsSheet.getRange('C' + newRow).setValue(roundQuarter(rating));
  ratingsSheet.getRange('D' + newRow).setValue(
    Utilities.formatDate(new Date(), ratingsSheet.getParent().getSpreadsheetTimeZone(), 'MM-dd-yyyy'));
  return newRow;
}

/** Ask for the player's primary email (written to CH); may be left blank. */
function showNewPlayerEmailDialog(name, row) {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(buildNewPlayerEmailDialogHtml(name, row))
      .setWidth(380).setHeight(230),
    'Email for ' + name);
}

function buildNewPlayerEmailDialogHtml(name, row) {
  return '<!DOCTYPE html><html><head><base target="_top"></head><body>' +
    '<h3>Primary email</h3>' +
    '<p>Enter the primary email for <b>' + escapeHtml(name) + '</b> (optional):</p>' +
    '<p><input id="email" type="text" placeholder="name@example.com" style="width:230px"></p>' +
    '<p>' +
    '<button id="okBtn" onclick="submitEmail()">OK</button> ' +
    '<button onclick="cancel()">Cancel</button>' +
    '</p>' +
    '<script>' +
    'function submitEmail() {' +
    '  var e = document.getElementById("email").value.trim();' +
    '  document.getElementById("okBtn").disabled = true;' +
    '  google.script.run.addNewPlayerEmail(' + JSON.stringify(name) + ', ' + row + ', e);' +
    '}' +
    'function cancel() { google.script.host.close(); }' +
    '</script>' +
    '</body></html>';
}

/**
 * Write the email to CH (index 85), then either present the next new player or
 * resume the run (typo gate + ELO computation). The pending list is re-derived
 * from the sheet so already-inserted players drop out automatically.
 */
function addNewPlayerEmail(name, row, email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratingsSheet = ss.getSheetByName(RATINGS_SHEET_NAME);
  if (email && String(email).trim() !== '') {
    ratingsSheet.getRange(row, 86).setValue(String(email).trim());
  }
  var sheet = resolveEngineSheet();
  var remaining = findNewPlayers(sheet);
  if (remaining.length > 0) {
    showNewPlayerDialog(remaining[0], 0, remaining.length);
  } else {
    runEngineCore(sheet, sheet.getName());
  }
}

function resolveEngineSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cached = CacheService.getScriptCache().get('engineSheet');
  if (cached) {
    var s = ss.getSheetByName(cached);
    if (s) return s;
  }
  return ss.getActiveSheet();
}

/**
 * Re-sort / re-rank the Ratings tab by current rating (descending) after
 * manual rating/name/email edits, without computing any ELO changes.
 * Reuses writeRatingsTab() so there's only one sort/write path.
 */
function rerankRatings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ratingsSheet = ss.getSheetByName(RATINGS_SHEET_NAME);
  if (!ratingsSheet) {
    SpreadsheetApp.getUi().alert("Ratings sheet not found.");
    return;
  }
  writeRatingsTab(ss, ratingsSheet, getCurrentRatings(ratingsSheet), {});
  ss.toast('Ratings tab re-ranked.', 'Done', 3);
}

/**
 * Sort the Ratings tab by rating (descending) and rewrite A-D (rank, name,
 * rating, last-changed date) plus the email columns (CH primary, CK
 * secondary) aligned to the new row order. ELO changes are applied by
 * runRatingsEngine() and passed in as `changes`; rerankRatings() passes
 * an empty map so no rating value changes, only row order.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {GoogleAppsScript.Spreadsheet.Sheet} ratingsSheet
 * @param {Object} currentRatings name -> rating
 * @param {Object} changes name -> ELO change for this run
 * @return {Object} {outRows: Array<Array>, newRatings: Object}
 */
function writeRatingsTab(ss, ratingsSheet, currentRatings, changes) {
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

  // Preserve player emails (CH = primary, CK = secondary) so they follow the
  // players when rankings shuffle. Emails are keyed by name, not by row.
  var emailsByName = {};
  var emailValues = ratingsSheet.getRange('B2:CK').getValues();
  for (var ei = 0; ei < emailValues.length; ei++) {
    var eName = String(emailValues[ei][0]).trim();
    if (eName === '') continue;
    emailsByName[eName] = {
      primary: emailValues[ei][85] !== undefined ? emailValues[ei][85] : '',
      secondary: emailValues[ei][88] !== undefined ? emailValues[ei][88] : ''
    };
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

  // Re-write emails aligned to the new (sorted) row order so they stay with
  // the right player. CH = primary, CK = secondary.
  var hVals = [];
  var kVals = [];
  for (var ori = 0; ori < outRows.length; ori++) {
    var on = String(outRows[ori][1]).trim();
    var em = emailsByName[on] || { primary: '', secondary: '' };
    hVals.push([em.primary || '']);
    kVals.push([em.secondary || '']);
  }
  if (hVals.length > 0) {
    ratingsSheet.getRange('CH2:CH' + (hVals.length + 1)).setValues(hVals);
  }
  if (kVals.length > 0) {
    ratingsSheet.getRange('CK2:CK' + (kVals.length + 1)).setValues(kVals);
  }

  return { outRows: outRows, newRatings: newRatings };
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
 * Append today's ratings for participating players to the hidden Rating
 * History tab.
 *
 * The Rating History tab holds the dated history in long/tidy form that feeds
 * the line chart via the hidden "Chart Data" pivot tab. Header row 1 has
 * A=Player, B=Date, C=Rating and data starts at row 2 (constants
 * RATINGS_HISTORY_HEADER_ROW / RATINGS_HISTORY_DATA_START_ROW), with one data
 * row per player per session. Only players who played a scored match get an
 * entry today; everyone else's history stays untouched. Re-running the engine
 * on the same day overwrites that day's rows instead of duplicating them.
 *
 * @param {Array.<{name: string, rating: number, date: string}>} participants
 * @param {string} todayStr Date as 'MM-dd-yyyy' (already resolved in the sheet's time zone).
 * @return {number} Number of rows written/updated for today.
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

  var headerRow = RATINGS_HISTORY_HEADER_ROW;
  var firstDataRow = RATINGS_HISTORY_DATA_START_ROW;

  // Ensure the header row is present (A=Player, B=Date, C=Rating).
  var curHeader = hist.getRange(headerRow, 1, 1, 3).getValues()[0];
  if (String(curHeader[0]).trim() !== 'Player' ||
      String(curHeader[1]).trim() !== 'Date' ||
      String(curHeader[2]).trim() !== 'Rating') {
    hist.getRange(headerRow, 1, 1, 3).setValues([['Player', 'Date', 'Rating']]);
  }

  // Read existing data rows as key -> row index so we can overwrite today's
  // entries for players who already have a row this day (idempotent re-run).
  var lastRow = hist.getLastRow();
  var existing = {};       // name|date-key -> 0-based row offset in values array
  var values = [];
  if (lastRow >= firstDataRow) {
    values = hist.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, 3).getValues();
  }
  var nextRow = firstDataRow + values.length;
  for (var r = 0; r < values.length; r++) {
    var pn = String(values[r][0]).trim();
    var pd = parseDatedHeader(values[r][1]);
    if (pn === '' || !pd) continue;
    var key = pn.toLowerCase() + '|' + pd.getTime();
    existing[key] = firstDataRow + r;
  }

  var written = 0;
  for (var p = 0; p < participants.length; p++) {
    var pname = String(participants[p].name).trim();
    if (pname === '') continue;
    var rating = round2(participants[p].rating);
    var key = pname.toLowerCase() + '|' + today.getTime();
    if (existing[key] !== undefined) {
      hist.getRange(existing[key], 3).setValue(rating);
    } else {
      hist.getRange(nextRow, 1, 1, 3).setValues([[pname, today, rating]]);
      hist.getRange(nextRow, 2).setNumberFormat('MMM d, yy');
      nextRow++;
    }
    written++;
  }
  return written;
}

/** Create the hidden Rating History tab with the standard header row if it is missing. */
function createRatingsHistoryTab(ss) {
  var tab = ss.getSheetByName(RATINGS_HISTORY_SHEET_NAME);
  if (tab) return tab;
  var newTab = ss.insertSheet(RATINGS_HISTORY_SHEET_NAME);
  newTab.hideSheet();
  newTab.getRange(RATINGS_HISTORY_HEADER_ROW, 1, 1, 3).setValues([['Player', 'Date', 'Rating']]);
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


