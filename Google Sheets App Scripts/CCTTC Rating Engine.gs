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

var SCORE_RANGES = ['I3:U17', 'I20:U34', 'I37:U51'];
var PLAYER_RANGES = ['C3:C8', 'C20:C25', 'C37:C42'];
var LEAGUE_RATING_RANGES = ['D3:F8', 'D20:F25', 'D37:F42'];

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
  var changes = {};      // name -> sum of ELO changes
  var needsRating = {};  // players seen without a rating
  var matchChanges = {}; // 'p1||p2' -> {p1Change, p2Change}

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
      matchChanges[parsed.p1 + '||' + parsed.p2] = {
        p1Change: newP1 - p1Rating,
        p2Change: newP2 - p2Rating,
        row: j,
        league: l
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
    newRatings[name] = base + (changes[name] || 0);
  }

  // Sort descending by rating.
  var sortedNames = Object.keys(newRatings).sort(function (a, b) {
    return newRatings[b] - newRatings[a];
  });

  var today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MM-dd-yyyy');

  // Write to Ratings sheet (A=rank, B=name, C=rating, D=date).
  var outRows = [];
  for (var i = 0; i < sortedNames.length; i++) {
    outRows.push([i + 1, sortedNames[i], round2(newRatings[sortedNames[i]]), today]);
  }
  if (outRows.length > 0) {
    ratingsSheet.getRange('A2:D' + (outRows.length + 1)).setValues(outRows);
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
        var diffStr = padDiff(diff);
        leagueRows.push([round2(oldVal), diffStr, round2(newRatings[name])]);
      } else {
        leagueRows.push(['', '', '']);
      }
    }
    if (leagueRows.length > 0) {
      sheet.getRange(LEAGUE_RATING_RANGES[l]).setNumberFormat('@');
      sheet.getRange(LEAGUE_RATING_RANGES[l]).setValues(leagueRows);
    }
  }

  // Write ELO change into column I (index 1) of each score row.
  for (var l = 0; l < 3; l++) {
    var range = sheet.getRange(SCORE_RANGES[l]);
    var values = range.getValues();
    var bg = range.getBackgrounds();
    for (var j = 0; j < values.length; j++) {
      var p1 = String(values[j][0]).trim();
      var p2 = String(values[j][2]).trim();
      var key = p1 + '||' + p2;
      if (matchChanges[key]) {
        var mc = matchChanges[key];
        values[j][1] = round2(Math.abs(mc.p1Change));
        if (mc.p1Change > 0) {
          bg[j][1] = '#c5eec5';
        }
      } else {
        values[j][1] = '';
      }
    }
    range.setValues(values);
    range.setBackgrounds(bg);
  }

  ss.toast('Ratings updated for ' + sortedNames.length + ' players.', 'Done', 3);

  if (unrated.length > 0) {
    SpreadsheetApp.getUi().alert(
      'These players had no rating and were skipped (add a rating to the Ratings sheet, then run again):\n' +
      unrated.join(', '));
  }
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function padDiff(diff) {
  // Mirrors the Python period-padding so the diff column keeps real width.
  var sign = diff >= 0 ? '+' : '';
  var body = sign + round2(diff).toFixed(2);
  var padLen = Math.max(7 - body.length, 0);
  return body + new Array(padLen + 1).join('.');
}
