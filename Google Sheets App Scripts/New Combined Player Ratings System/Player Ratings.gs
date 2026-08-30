
/**
 * Week 9-16 fade ramp used by the Hide/Show Inactive buttons on the Ratings
 * tab. Returns [purple, peach, blue] font colors for a given days-inactive
 * count (or null when the player is still fully active / already past the
 * fade). The three shades are blended toward the column backgrounds used on
 * the Ratings tab — A/D/G rank+dates sit on #d9d2e9 (purple), B names on
 * #fce5cd (peach), C/F ratings on #c9daf8 (blue).
 */
function getFadeColors(daysInactive) {
  if (daysInactive >= 30 && daysInactive <= 43) {           // Week 9
    return ["#514e57", "#5e554c", "#4b515c"];
  } else if (daysInactive >= 44 && daysInactive <= 57) {    // Week 10
    return ["#6e6b76", "#807468", "#666e7e"];
  } else if (daysInactive >= 58 && daysInactive <= 71) {    // Week 11
    return ["#84818e", "#9a8c7d", "#7b8497"];
  } else if (daysInactive >= 72 && daysInactive <= 85) {    // Week 12
    return ["#9691a1", "#af9f8e", "#8c97ad"];
  } else if (daysInactive >= 86 && daysInactive <= 99) {    // Week 13
    return ["#a7a1b4", "#c1b09d", "#9ba7c0"];
  } else if (daysInactive >= 100 && daysInactive <= 113) {  // Week 14
    return ["#b7b1c6", "#d2bfab", "#aab5d0"];
  } else if (daysInactive >= 114 && daysInactive <= 127) {  // Week 15
    return ["#c6bfe0", "#e1cdb7", "#b7c3df"];
  } else if (daysInactive >= 128 && daysInactive <= 141) {  // Week 16
    return ["#d2cbd5", "#efd9c2", "#c3ceec"];
  }
  return null;
}

function hideInactivePlayers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("🔵 Ratings");
  var playerNames = sheet.getRange("B2:B").getValues();

  // Column D = the last date a player's rating changed, maintained by the
  // weekly/ad-hoc Python runs (tt-ratings.py). Hide anyone who has never been
  // dated or whose date is older than the 142-day window — players fade out
  // over weeks 9-16 then vanish completely on day 142.
  var dateValues = sheet.getRange("D2:D").getValues();
  var today = new Date();

  // Real player count: the first empty name ends the list. Sizing every range
  // to this (instead of the sheet's last row) skips hundreds of empty rows.
  var playerCount = 0;
  while (playerCount < playerNames.length && String(playerNames[playerCount][0]).trim() !== "") {
    playerCount++;
  }
  if (playerCount === 0) return;
  var endRow = playerCount + 1;

  sheet.showRows(2, playerCount);

  // Fetch current font colors so hidden rows keep their themed colors and we
  // only override the rows we touch. A=rank (purple), B=name (peach),
  // C=club rating (blue), D=date earned (purple), F=USATT rating (blue),
  // G=USATT date earned (purple). Column E is the Equalize button and H/K are
  // the Show/Hide buttons — those are left alone.
  var fontColorsA = sheet.getRange("A2:A" + endRow).getFontColors();
  var fontColorsB = sheet.getRange("B2:B" + endRow).getFontColors();
  var fontColorsC = sheet.getRange("C2:C" + endRow).getFontColors();
  var fontColorsD = sheet.getRange("D2:D" + endRow).getFontColors();
  var fontColorsF = sheet.getRange("F2:F" + endRow).getFontColors();
  var fontColorsG = sheet.getRange("G2:G" + endRow).getFontColors();

  var hideStart = -1;
  var hideCount = 0;
  for (var i = 0; i < playerCount; ++i) {
    var lastDate = parseDateValue(dateValues[i][0]);
    // Hide at day 142 exactly (>= matches the "vanish on day 142" rule, so a
    // player whose date equals the cutoff is not left stranded as black text).
    var daysInactive = lastDate ? Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
    var shouldHide = daysInactive === null || daysInactive >= 142;

    if (shouldHide) {
      // Hidden rows keep their current colors (invisible either way).
      if (hideStart === -1) hideStart = i + 2;
      hideCount++;
      continue;
    }

    // Visible player: solid black for weeks 1-8, then progressively lighter
    // toward the background from week 9 (day 30) through week 16 (day 141).
    var colorPurple = "#000000";
    var colorPeach = "#000000";
    var colorBlue = "#000000";

    if (daysInactive !== null) {
      var fade = getFadeColors(daysInactive);
      if (fade) {
        colorPurple = fade[0]; colorPeach = fade[1]; colorBlue = fade[2];
      }
    }

    fontColorsA[i][0] = colorPurple;
    fontColorsB[i][0] = colorPeach;
    fontColorsC[i][0] = colorBlue;
    fontColorsD[i][0] = colorPurple;
    fontColorsF[i][0] = colorBlue;
    fontColorsG[i][0] = colorPurple;

    if (hideStart !== -1) {
      sheet.hideRows(hideStart, hideCount);
      hideStart = -1;
      hideCount = 0;
    }
  }
  if (hideStart !== -1) {
    sheet.hideRows(hideStart, hideCount);
  }

  // Batch-set all six columns at once to minimize API calls.
  sheet.getRange("A2:A" + endRow).setFontColors(fontColorsA);
  sheet.getRange("B2:B" + endRow).setFontColors(fontColorsB);
  sheet.getRange("C2:C" + endRow).setFontColors(fontColorsC);
  sheet.getRange("D2:D" + endRow).setFontColors(fontColorsD);
  sheet.getRange("F2:F" + endRow).setFontColors(fontColorsF);
  sheet.getRange("G2:G" + endRow).setFontColors(fontColorsG);
}

function showInactivePlayers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("🔵 Ratings");
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Could not find the "🔵 Ratings" sheet. Please check the sheet name.');
    return;
  }
  var playerNames = sheet.getRange("B2:B").getValues();
  var rowCount = 0;
  for (var i = 0; i < playerNames.length; i++) {
    if (String(playerNames[i][0]).trim() === "") {
      break;
    }
    rowCount++;
  }
  if (rowCount > 0) {
    sheet.showRows(2, rowCount);

    // Reset the themed font colors back to black (undo any fade) for A-D and
    // F-G. Column E is the Equalize button and must keep its own font color.
    sheet.getRange(2, 1, rowCount, 4).setFontColor("#000000");
    sheet.getRange(2, 6, rowCount, 2).setFontColor("#000000");
  }
}

function parseDateValue(v) {
  if (v instanceof Date) return v;
  var s = String(v).trim();
  if (s === "") return null;
  var m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function newScoreSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var template_sheet = ss.getSheetByName("Template");
  var date_str = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MM-dd-yyyy");

  // Find the most recent score sheet to determine the next emoji prefix.
  // Score sheets follow the pattern "🟢 MM-dd-yyyy" or "🟡 MM-dd-yyyy".
  // Alternate between 🟢 and 🟡 for each new sheet.
  var GREEN = '🟢 ';
  var YELLOW = '🟡 ';
  var nextEmoji = GREEN;
  var sheets = ss.getSheets();
  var latestDate = null;
  var latestEmoji = null;
  var latestIndex = -1;
  var datePattern = /^(🟢|🟡)\s+(\d{2}-\d{2}-\d{4})$/;
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    var m = name.match(datePattern);
    if (m) {
      var d = parseDateValue(m[2]);
      if (d && (!latestDate || d.getTime() > latestDate.getTime())) {
        latestDate = d;
        latestEmoji = m[1];
        latestIndex = sheets[i].getIndex();
      }
    }
  }
  if (latestEmoji === GREEN) {
    nextEmoji = YELLOW;
  } else if (latestEmoji === YELLOW) {
    nextEmoji = GREEN;
  }

  var displayName = nextEmoji + date_str;
  // Insert to the left of the most recent score sheet.
  // System/Rules stays to the left of all score sheets.
  var insertIndex = latestIndex > 0 ? latestIndex : 1;
  var sheet = ss.insertSheet(displayName, insertIndex, {template: template_sheet});
  sheet.showSheet();
  ["E3:E8", "E20:E25", "E37:E42"].forEach(function(r) {
    sheet.getRange(r).setNumberFormat("@");
  });
}

class Player {
  constructor(name) {
    this.name = name;
    this.won_games = 0;
    this.won_against = [];
    this.match_diffs = {};
    this.scores_w = {};
    this.scores_l = {};
  }
}

function tiebreaker(player_list) {
  if (player_list.length == 2) {
    Logger.log("Two way tiebreak.")
    if (player_list[0].won_against.includes(player_list[1].name)) {
      return [player_list[0], player_list[1]];
    } else if (player_list[1].won_against.includes(player_list[0].name)) {
      return [player_list[1], player_list[0]];
    } else {
      Logger.log("check scores");
      var p1_w_total = player_list[0].scores_w[player_list[1].name].reduce((a, b) => a + b, 0);
      var p1_l_total = player_list[0].scores_l[player_list[1].name].reduce((a, b) => a + b, 0);
      var p2_w_total = player_list[1].scores_w[player_list[0].name].reduce((a, b) => a + b, 0);
      var p2_l_total = player_list[1].scores_l[player_list[0].name].reduce((a, b) => a + b, 0);
      var p1_check = p1_w_total / p1_l_total;
      var p2_check = p2_w_total / p2_l_total;
      Logger.log(player_list[0].name + " = " + p1_w_total + " / " + p1_l_total + " = " + p1_check);
      Logger.log(player_list[1].name + " = " + p2_w_total + " / " + p2_l_total + " = " + p2_check);
      if (p1_check > p2_check) {
        return [player_list[0], player_list[1]];
      } else {
        return [player_list[1], player_list[0]];
      }
    }
  } else if (player_list.length == 3) {
    Logger.log("Three way tiebreak - using game differential");
    var game_diffs = [];
    for (var i = 0; i < player_list.length; i++) {
      var player = player_list[i];
      var games_won = 0;
      var games_lost = 0;
      var points_won = 0;
      var points_lost = 0;
      var opponents = Object.keys(player.scores_w);
      for (var j = 0; j < opponents.length; j++) {
        var opponent = opponents[j];
        if (player.scores_w[opponent]) {
          games_won += player.scores_w[opponent].length;
          points_won += player.scores_w[opponent].reduce((a, b) => a + b, 0);
        }
        if (player.scores_l[opponent]) {
          games_lost += player.scores_l[opponent].length;
          points_lost += player.scores_l[opponent].reduce((a, b) => a + b, 0);
        }
      }
      var game_diff = games_won - games_lost;
      var point_diff = points_won - points_lost;
      Logger.log(player.name + ": " + games_won + " games won - " + games_lost + " games lost = " + game_diff + " differential");
      Logger.log("  Points: " + points_won + " won - " + points_lost + " lost = " + point_diff + " differential");
      game_diffs.push({
        player: player,
        game_diff: game_diff,
        point_diff: point_diff
      });
    }
    game_diffs.sort(function(a, b) {
      if (a.game_diff !== b.game_diff) {
        return b.game_diff - a.game_diff;
      }
      return b.point_diff - a.point_diff;
    });
    Logger.log("Final order after tiebreaker:");
    for (var i = 0; i < game_diffs.length; i++) {
      Logger.log("  " + (i+1) + ". " + game_diffs[i].player.name + " (game diff: " + game_diffs[i].game_diff + ", point diff: " + game_diffs[i].point_diff + ")");
    }
    return game_diffs.map(function(item) { return item.player; });
  }
}

function findMatchWinner(scores) {
  var p1_win_count = 0;
  var p2_win_count = 0;
  var p1_scores_w = [];
  var p1_scores_l = [];
  var p2_scores_w = [];
  var p2_scores_l = [];
  var p1vp2_score_diffs = [];
  var p2vp1_score_diffs = [];

  for (var i = 0; i < scores.length / 2; ++i) {
    var p1_col = i * 2;
    var p2_col = p1_col + 1;

    if (p2_col >= scores.length) {
      break;
    }

    var p1_score = scores[p1_col];
    var p2_score = scores[p2_col];

    if (typeof p1_score !== 'number' || typeof p2_score !== 'number') {
      continue;
    }

    if (p1_score === 0 && p2_score === 0) {
      continue;
    }

    var score_diff = p1_score - p2_score;
    if (score_diff > 0) {
      ++p1_win_count;
    } else if (score_diff < 0) {
      ++p2_win_count;
    }

    p1_scores_w.push(p1_score);
    p1_scores_l.push(p2_score);
    p2_scores_w.push(p2_score);
    p2_scores_l.push(p1_score);
    p1vp2_score_diffs.push(score_diff);
    p2vp1_score_diffs.push(-score_diff);
  }

  winner_id = -1;
  if (p1_win_count > p2_win_count) {
    winner_id = 1;
  } else if (p1_win_count < p2_win_count) {
    winner_id = 2;
  } else if (p1_win_count == 0 && p2_win_count == 0) {
    winner_id = 0;
  } else {
    winner_id = 3;
  }
  return [winner_id, p1vp2_score_diffs, p1_scores_w, p1_scores_l, p2vp1_score_diffs, p2_scores_w, p2_scores_l]
}

function isSuspectedTypo(row) {
  // Mirrors tt-ratings.py _is_suspected_typo. Flags rows that look like
  // data-entry typos: a game pair with exactly one score filled, an interior
  // gap (blank score cells before later scores), a completed game whose winner
  // did not reach 11, a deuce game won by more than 2, or an impossible 11-10.
  // Defined here (shared file) so both the CCTTC and combined systems can use
  // it from findWinners / Rating Engine.
  if (!row || row.length < 3) return false;
  var p1Name = String(row[0]).trim();
  var p2Name = String(row[2]).trim();
  if (p1Name === '' || p2Name === '') return false;

  function isNum(v) {
    if (typeof v === 'boolean') return false;
    if (typeof v === 'number') return true;
    if (typeof v === 'string') {
      if (v.trim() === '') return false;
      return !isNaN(parseFloat(v));
    }
    return false;
  }
  function parseVal(v) {
    return isNum(v) ? parseFloat(v) : null;
  }

  var pairs = [];
  for (var k = 3; k < Math.min(row.length, 13); k += 2) {
    var s1 = parseVal(row[k]);
    var s2 = (k + 1 < row.length) ? parseVal(row[k + 1]) : null;
    pairs.push([s1, s2]);
  }

  // Interior gap: a fully-blank pair followed later by a pair with scores.
  var gap = false;
  for (var i = 0; i < pairs.length; i++) {
    var filledHere = pairs[i][0] !== null || pairs[i][1] !== null;
    if (filledHere) {
      if (gap) return true;
    } else {
      gap = true;
    }
  }

  for (var j = 0; j < pairs.length; j++) {
    var a = pairs[j][0], b = pairs[j][1];
    if ((a === null) !== (b === null)) return true; // half-filled pair
    if (a === null) continue;                       // both blank (trailing)
    var hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi < 11) return true;                       // nobody reached 11
    if (hi > 11 && (hi - lo) !== 2) return true;    // deuce must win by 2
    if (hi === 11 && lo > 9) return true;           // 11-10 impossible
  }
  return false;
}

function scanForTypos(sheet) {
  // Scan the three league score ranges and return an array of typo records:
  // { league, rowIndex, baseIndex, p1, p2 }. baseIndex is the first score row
  // of the league (3, 20, 37); the J cell to flag is baseIndex + rowIndex.
  var ranges = ["I3:U17", "I20:U34", "I37:U51"];
  var typos = [];
  for (var l = 0; l < 3; l++) {
    var values = sheet.getRange(ranges[l]).getValues();
    var baseIndex = l * 17 + 3;
    for (var j = 0; j < values.length; j++) {
      var row = values[j];
      if (!row[0] || !row[2]) continue;
      var p1 = String(row[0]).trim();
      var p2 = String(row[2]).trim();
      if (p1 === "" || p2 === "") continue;
      if (isSuspectedTypo(row)) {
        typos.push({ league: l, rowIndex: j, baseIndex: baseIndex, p1: p1, p2: p2 });
      }
    }
  }
  return typos;
}

function flagTypoRows(sheet, typos) {
  for (var i = 0; i < typos.length; i++) {
    var t = typos[i];
    sheet.getRange(t.baseIndex + t.rowIndex, 10).setBackground("#ff0000");
  }
}

function buildTypoDialogHtml(action, sheetName, typos) {
  var list = typos.map(function (t) {
    return "<li>League " + (t.league + 1) + " row " + (t.baseIndex + t.rowIndex) +
      ": <b>" + String(t.p1).replace(/&/g, "&amp;").replace(/</g, "&lt;") +
      "</b> vs <b>" + String(t.p2).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</b></li>";
  }).join("");
  return '<!DOCTYPE html><html><head><base target="_top"></head><body>' +
    '<h3>Suspected score typos</h3>' +
    '<p>The following rows are flagged red in column J. Fix the scores in the ' +
    'sheet, then click <b>Re-check</b> to continue:</p>' +
    '<ul>' + list + '</ul>' +
    '<p><button id="recheck" onclick="recheck()">Re-check</button></p>' +
    '<div id="status"></div>' +
    '<script>' +
    'function recheck() {' +
    '  document.getElementById("recheck").disabled = true;' +
    '  document.getElementById("status").textContent = "Checking...";' +
    '  google.script.run.withSuccessHandler(onDone).typoRecheck("' + action + '", "' + sheetName + '");' +
    '}' +
    'function onDone(result) {' +
    '  if (result.clean) { google.script.host.close(); }' +
    '  else { document.body.innerHTML = result.html; }' +
    '}' +
    '</script>' +
    '</body></html>';
}

function showTypoDialog(action, sheetName, typos) {
  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutput(buildTypoDialogHtml(action, sheetName, typos))
      .setWidth(460).setHeight(340),
    "Fix typos to continue");
}

function typoRecheck(action, sheetName) {
  // Re-read the sheet after the operator fixes the flagged rows. When no typos
  // remain, resume the pending action (findWinners / runRatingsEngine) in the
  // same run; otherwise keep the dialog open with the remaining rows.
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { clean: true };
  var typos = scanForTypos(sheet);
  if (typos.length > 0) {
    flagTypoRows(sheet, typos);
    return { clean: false, html: buildTypoDialogHtml(action, sheetName, typos) };
  }
  if (action === "findWinners") {
    findWinners();
  } else if (action === "updateRatings") {
    runRatingsEngine();
  }
  return { clean: true };
}

function findWinners() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var sheetName = sheet.getName();

    if (sheetName === "🔵 Ratings" || sheetName === "Template") {
      var sheets = ss.getSheets();
      var datePattern = /^\d{2}-\d{2}-\d{4}$/;
      var dateSheets = [];

      for (var i = 0; i < sheets.length; i++) {
        if (datePattern.test(sheets[i].getName())) {
          dateSheets.push(sheets[i].getName());
        }
      }

      if (dateSheets.length > 0) {
        dateSheets.sort();
        sheetName = dateSheets[dateSheets.length - 1];
        sheet = ss.getSheetByName(sheetName);
        SpreadsheetApp.setActiveSheet(sheet);
      } else {
        SpreadsheetApp.getUi().alert("Please run this on a date sheet (e.g., 10-21-2025), not on the Ratings sheet.");
        return;
      }
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Finding winners for sheet: ' + sheetName, 'Processing', 3);

    // Typo gate: check for suspected score typos BEFORE computing winners. If
    // any are found, flag their J cells red and open a modeless dialog so the
    // operator can fix them in the sheet, then click Re-check; once the data is
    // clean the same run continues automatically (typoRecheck -> findWinners).
    var typos = scanForTypos(sheet);
    if (typos.length > 0) {
      flagTypoRows(sheet, typos);
      showTypoDialog("findWinners", sheetName, typos);
      return;
    }

  var player_list = sheet.getRangeList(["C3:C8", "C20:C25", "C37:C42"]).getRanges();
  var league_results = {};
  for (var i = 0; i < 3; ++i) {
    var results = {};
    var player_names = player_list[i].getValues();
    for (var j = 0; j < 6; j++) {
      if (player_names[j][0]) {
        var name = String(player_names[j][0]).trim();
        if (name !== "") {
          results[name] = new Player(name);
        }
      }
    }
    league_results[i] = results;
    Logger.log("League " + (i+1) + " players: " + Object.keys(results).join(", "));
  }

  var score_list = sheet.getRangeList(["I3:U17", "I20:U34", "I37:U51"]).getRanges();

  // Decide which rows are official round-robin matches for each league. Extra
  // matches (rematches, or matches against guests/players outside the league)
  // must NOT affect the winner or tiebreakers.
  //
  //   - 4+ players: single round robin, each pair once (N*(N-1)/2 matches).
  //     Incomplete matches are skipped individually; the round is not voided.
  //   - 3 players: players play multiple rounds (each pair once per round).
  //     A round counts only if every match in it was completed; a partial
  //     round is ignored entirely.
  //
  // Players who appear only once in the score rows (guests) are excluded from
  // the league roster so they can't affect the round-robin structure.
  function rowHasScores(match_scores) {
    for (var k = 3; k < match_scores.length; k++) {
      if (typeof match_scores[k] === "number") {
        return true;
      }
    }
    return false;
  }

  var appearance_counts = [{}, {}, {}];
  for (var i = 0; i < 3; ++i) {
    var appearance_rows = score_list[i].getValues();
    for (var j = 0; j < 15; ++j) {
      var appearance_row = appearance_rows[j];
      if (!appearance_row[0] || !appearance_row[2]) {
        continue;
      }
      var a1 = String(appearance_row[0]).trim();
      var a2 = String(appearance_row[2]).trim();
      if (a1 === "" || a2 === "") {
        continue;
      }
      appearance_counts[i][a1] = (appearance_counts[i][a1] || 0) + 1;
      appearance_counts[i][a2] = (appearance_counts[i][a2] || 0) + 1;
    }
  }

  var count_row = [[], [], []];
  for (var i = 0; i < 3; ++i) {
    var league_names = Object.keys(league_results[i]);
    var has_guests = league_names.length >= 3;
    var league_players = [];
    for (var n = 0; n < league_names.length; ++n) {
      var appearances = appearance_counts[i][league_names[n]] || 0;
      if (!has_guests || appearances >= 2) {
        league_players.push(league_names[n]);
      }
    }
    Logger.log("League " + (i+1) + " players: " + league_players.join(", "));

    var league_scores = score_list[i].getValues();

    if (league_players.length == 3) {
      // Multi-round (3 players): each pair once per round. Only complete
      // rounds count toward the winner.
      var pair_occ = {};
      var pair_occ_scores = {};
      var row_info = [];
      for (var j = 0; j < 15; ++j) {
        var ms = league_scores[j];
        if (!ms[0] || !ms[2]) continue;
        var n1 = String(ms[0]).trim();
        var n2 = String(ms[2]).trim();
        if (n1 === "" || n2 === "") continue;
        if (n1 === n2) continue;
        if (league_players.indexOf(n1) < 0 || league_players.indexOf(n2) < 0) continue;
        var pk = n1 < n2 ? n1 + "|" + n2 : n2 + "|" + n1;
        var occ = (pair_occ[pk] || 0) + 1;
        pair_occ[pk] = occ;
        pair_occ_scores[pk + "|" + occ] = rowHasScores(ms);
        row_info[j] = { pk: pk, occ: occ };
      }
      var complete_rounds = {};
      var max_rounds = 0;
      for (var pk in pair_occ) {
        max_rounds = Math.max(max_rounds, pair_occ[pk]);
      }
      for (var r = 1; r <= max_rounds; ++r) {
        var all_complete = true;
        for (var pk in pair_occ) {
          if (pair_occ_scores[pk + "|" + r] !== true) {
            all_complete = false;
            break;
          }
        }
        if (all_complete) {
          complete_rounds[r] = true;
        }
        Logger.log("League " + (i+1) + ": round " + r + (all_complete ? " complete" : " incomplete - ignored"));
      }
      for (var j = 0; j < 15; ++j) {
        count_row[i][j] = !!(row_info[j] && complete_rounds[row_info[j].occ]);
      }
    } else {
      // Single round robin: each pair once, capped at N*(N-1)/2. Incomplete
      // matches are skipped individually (round not voided).
      var rr_cap = league_players.length * (league_players.length - 1) / 2;
      var seen = {};
      var rr_count = 0;
      for (var j = 0; j < 15; ++j) {
        var ms = league_scores[j];
        if (!ms[0] || !ms[2]) continue;
        var n1 = String(ms[0]).trim();
        var n2 = String(ms[2]).trim();
        if (n1 === "" || n2 === "") continue;
        if (n1 === n2) continue;
        if (league_players.indexOf(n1) < 0 || league_players.indexOf(n2) < 0) continue;
        var pk = n1 < n2 ? n1 + "|" + n2 : n2 + "|" + n1;
        if (seen[pk]) continue;
        seen[pk] = true;
        if (!rowHasScores(ms)) continue;
        if (rr_count >= rr_cap) continue;
        rr_count++;
        count_row[i][j] = true;
      }
      Logger.log("League " + (i+1) + ": round-robin size " + rr_cap + ", " + rr_count + " matches counted");
    }
  }
  for (var i = 0; i < 3; ++i) {
    var base_index = i * 17 + 3;
    sheet.getRange(base_index, 7, 15, 2).setBackground("#d9d9d9");

    var league_scores = score_list[i].getValues();
    for (var j = 0; j < 15; ++j) {
      var match_scores = league_scores[j];
      if (!match_scores[0] || !match_scores[2]) {
        continue;
      }
      var p1_name = String(match_scores[0]).trim();
      var p2_name = String(match_scores[2]).trim();

      if (p1_name === "" || p2_name === "") {
        continue;
      }

      // Determine if this is an official round-robin match for standings purposes.
      // We check count_row first (which only includes league roster players).
      // For players not in league_results, treat as extra match.
      var isOfficialMatch = false;
      if (league_results[i][p1_name] && league_results[i][p2_name]) {
        isOfficialMatch = count_row[i][j];
      } else {
        Logger.log("Extra match (players not in league roster): " + p1_name + " vs " + p2_name);
      }
      if (!isOfficialMatch) {
        Logger.log("Extra match (not counted for standings): " + p1_name + " vs " + p2_name);
      }

      var scores_only = [];
      for (var k = 3; k < match_scores.length; k++) {
        var value = match_scores[k];
        if (typeof value === "number" && value >= 0) {
          scores_only.push(value);
        } else if (value === "" || value === null || value === undefined) {
          if (scores_only.length % 2 === 1) {
            scores_only.push(0);
          }
          if (k + 1 < match_scores.length) {
            var nextValue = match_scores[k + 1];
            if (nextValue === "" || nextValue === null || nextValue === undefined) {
              break;
            }
          }
        }
      }

      if (scores_only.length == 0) {
        Logger.log("No scores found for " + p1_name + " vs " + p2_name);
        continue;
      }

      if (scores_only.length % 2 !== 0) {
        Logger.log("Warning: Odd number of scores for " + p1_name + " vs " + p2_name + ": " + scores_only.length + " scores");
        scores_only.pop();
      }

      var [winner_id, p1vp2_score_diffs, p1_scores_w, p1_scores_l, p2vp1_score_diffs, p2_scores_w, p2_scores_l] =
          findMatchWinner(scores_only);

      Logger.log("Match " + (j+1) + ": " + p1_name + " vs " + p2_name + " - Winner ID: " + winner_id + ", Scores: " + scores_only.join(","));

      if (winner_id == 1) {
        if (isOfficialMatch) {
          ++league_results[i][p1_name].won_games;
          league_results[i][p1_name].won_against.push(p2_name);
        }
        sheet.getRange(base_index + j, 7).setBackground("#ffa5a5");
        Logger.log("  -> " + p1_name + " wins (highlighting G" + (base_index + j) + ")" + (isOfficialMatch ? "" : " [extra match]"));
      } else if (winner_id == 2) {
        if (isOfficialMatch) {
          ++league_results[i][p2_name].won_games;
          league_results[i][p2_name].won_against.push(p1_name);
        }
        sheet.getRange(base_index + j, 8).setBackground("#ffa5a5");
        Logger.log("  -> " + p2_name + " wins (highlighting H" + (base_index + j) + ")" + (isOfficialMatch ? "" : " [extra match]"));
      } else if (winner_id == 3) {
        sheet.getRange(base_index + j, 7).setBackground("#b3a7d7");
        sheet.getRange(base_index + j, 8).setBackground("#b3a7d7");
        Logger.log("  -> Tie (highlighting G" + (base_index + j) + " and H" + (base_index + j) + ")" + (isOfficialMatch ? "" : " [extra match]"));
      } else {
        Logger.log("  -> No winner determined (winner_id = " + winner_id + ")");
      }

      // Only record match data for official round-robin matches
      if (isOfficialMatch) {
        league_results[i][p1_name].match_diffs[p2_name] = p1vp2_score_diffs;
        league_results[i][p2_name].match_diffs[p1_name] = p2vp1_score_diffs;
        league_results[i][p1_name].scores_w[p2_name] = p1_scores_w;
        league_results[i][p1_name].scores_l[p2_name] = p1_scores_l;
        league_results[i][p2_name].scores_w[p1_name] = p2_scores_w;
        league_results[i][p2_name].scores_l[p1_name] = p2_scores_l;
      }
    }
  }

  for (var i = 0; i < 3; i++) {
    var winner = null;
    var player_names = Object.keys(league_results[i]);
    var ties = [];

    Logger.log("League " + (i+1) + " results:");
    for (var j = 0; j < player_names.length; ++j) {
      Logger.log("  " + player_names[j] + ": " + league_results[i][player_names[j]].won_games + " wins");
    }

    var max_wins = -1;
    for (var j = 0; j < player_names.length; ++j) {
      var name = player_names[j];
      var wins = league_results[i][name].won_games;

      if (wins > max_wins) {
        max_wins = wins;
        winner = league_results[i][name];
        ties = [];
      } else if (wins == max_wins && max_wins > 0) {
        if (ties.length == 0 && winner != null) {
          ties.push(winner);
        }
        ties.push(league_results[i][name]);
      }
    }

    var sorted_players = null;
    if (ties.length > 1) {
      Logger.log("Tie detected with " + ties.length + " players at " + max_wins + " wins");
      sorted_players = tiebreaker(ties);
      winner = sorted_players[0];
    }

    if (winner == null || winner.won_games == 0) {
      Logger.log("No winner found for league " + (i+1));
      continue;
    }

    var range, ties_range;
    if (i == 0) {
      range = "D9";
      ties_range = "D10:D11";
    } else if (i == 1) {
      range = "D26";
      ties_range = "D27:D28";
    } else {
      range = "D43";
      ties_range = "D44:D45";
    }

    Logger.log("League " + (i+1) + " winner: " + winner.name);
    sheet.getRange(range).setValue(winner.name);

    if (sorted_players != null && sorted_players.length > 1) {
      var ties_names = [];
      for (var j = 1; j < 3; ++j) {
        if (j < sorted_players.length) {
          ties_names.push([sorted_players[j].name]);
        } else {
          ties_names.push([""]);
        }
      }
      sheet.getRange(ties_range).setValues(ties_names);
    } else {
      sheet.getRange(ties_range).clearContent();
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Winners found and highlighted!', 'Complete', 3);

  } catch (error) {
    Logger.log("Error in findWinners: " + error.toString());
    SpreadsheetApp.getActiveSpreadsheet().toast('Error: ' + error.toString(), 'Error', 10);
    throw error;
  }
}

function findWinnersForDate(dateString) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(dateString);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet '" + dateString + "' not found!");
    return;
  }

  SpreadsheetApp.setActiveSheet(sheet);
  findWinners();
}

