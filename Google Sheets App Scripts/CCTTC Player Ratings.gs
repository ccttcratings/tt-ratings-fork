function hideInactivePlayers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Ratings");
  var playerNames = sheet.getRange("B2:B").getValues();
  sheet.showRows(2, playerNames.length);

  var today = new Date();
  var ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(today.getDate() - 90);

  var allSheets = ss.getSheets();
  var datePattern = /^\d{2}-\d{2}-\d{4}$/;
  var lastPlayedDates = {};

  for (var s = 0; s < allSheets.length; s++) {
    var sheetName = allSheets[s].getName();
    if (datePattern.test(sheetName)) {
      var dateSheet = allSheets[s];
      var sheetDate = new Date(sheetName);
      var leagueRanges = ["C3:C8", "C20:C25", "C37:C42"];
      for (var r = 0; r < leagueRanges.length; r++) {
        var leaguePlayers = dateSheet.getRange(leagueRanges[r]).getValues();
        for (var p = 0; p < leaguePlayers.length; p++) {
          var playerName = String(leaguePlayers[p][0]).trim();
          if (playerName !== "") {
            if (!lastPlayedDates[playerName] || sheetDate > lastPlayedDates[playerName]) {
              lastPlayedDates[playerName] = sheetDate;
            }
          }
        }
      }
    }
  }

  for (var i = 0; i < playerNames.length; ++i) {
    if (playerNames[i][0] === "") {
      break;
    }
    var playerName = String(playerNames[i][0]).trim();
    var lastPlayedDate = lastPlayedDates[playerName];
    if (lastPlayedDate && lastPlayedDate < ninetyDaysAgo) {
      sheet.hideRows(i + 2);
    } else if (!lastPlayedDate) {
      sheet.hideRows(i + 2);
    }
  }
}

function showInactivePlayers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Ratings");
  var playerNames = sheet.getRange("B2:B").getValues();
  var rowCount = 0;
  for (var i = 0; i < playerNames.length; i++) {
    if (playerNames[i][0] === "") {
      break;
    }
    rowCount++;
  }
  if (rowCount > 0) {
    sheet.showRows(2, rowCount);
  }
}

function newScoreSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var template_sheet = ss.getSheetByName("Template");
  var date_str = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "MM-dd-yyyy");
  var sysRulesSheet = ss.getSheetByName("System/Rules");
  var insertIndex = sysRulesSheet ? sysRulesSheet.getIndex() : ss.getSheets().length;
  var sheet = ss.insertSheet(date_str, insertIndex, {template: template_sheet});
  ["E3:E8", "E20:E25", "E37:E42"].forEach(function(r) {
    sheet.getRange(r).setNumberFormat("@ ");
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

function findWinners() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var sheetName = sheet.getName();

    if (sheetName === "Ratings" || sheetName === "Template") {
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
  for (var i = 0; i < 3; ++i) {
    var base_index = i * 17 + 3;
    sheet.getRange(base_index, 7, 15, 2).setBackground("#efefef");

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

      if (!league_results[i][p1_name] || !league_results[i][p2_name]) {
        Logger.log("Warning: Player not found in league " + i + ": '" + p1_name + "' or '" + p2_name + "'");
        Logger.log("Available players: " + Object.keys(league_results[i]).join(", "));
        continue;
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
        ++league_results[i][p1_name].won_games;
        league_results[i][p1_name].won_against.push(p2_name);
        sheet.getRange(base_index + j, 7).setBackground("#ea9999");
        Logger.log("  -> " + p1_name + " wins (highlighting G" + (base_index + j) + ")");
      } else if (winner_id == 2) {
        ++league_results[i][p2_name].won_games;
        league_results[i][p2_name].won_against.push(p1_name);
        sheet.getRange(base_index + j, 8).setBackground("#ea9999");
        Logger.log("  -> " + p2_name + " wins (highlighting H" + (base_index + j) + ")");
      } else if (winner_id == 3) {
        sheet.getRange(base_index + j, 7).setBackground("#b3a7d7");
        sheet.getRange(base_index + j, 8).setBackground("#b3a7d7");
        Logger.log("  -> Tie (highlighting G" + (base_index + j) + " and H" + (base_index + j) + ")");
      } else {
        Logger.log("  -> No winner determined (winner_id = " + winner_id + ")");
      }

      league_results[i][p1_name].match_diffs[p2_name] = p1vp2_score_diffs;
      league_results[i][p2_name].match_diffs[p1_name] = p2vp1_score_diffs;
      league_results[i][p1_name].scores_w[p2_name] = p1_scores_w;
      league_results[i][p1_name].scores_l[p2_name] = p1_scores_l;
      league_results[i][p2_name].scores_w[p1_name] = p2_scores_w;
      league_results[i][p2_name].scores_l[p1_name] = p2_scores_l;
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
