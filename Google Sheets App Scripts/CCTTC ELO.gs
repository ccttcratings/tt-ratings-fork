/**
 * Ported from tt-ratings.py (class ELO, lines 22-142).
 * Pure rating math used by the club-kit spreadsheet.
 *
 * updateRating(p1Rating, p2Rating, scoreDiffs):
 *   scoreDiffs = [score1 - score2, ...] per game, positive means p1 won the game.
 *   Returns p1's NEW rating after the match.
 */

function updateRating(p1Rating, p2Rating, scoreDiffs) {
  var results = scoreDiffs.map(function (diff) {
    return diff < 0 ? 0 : 1;
  });
  var ones = results.filter(function (r) { return r === 1; }).length;
  var zeros = results.length - ones;
  var gameScoreDiff = ones - zeros;
  var ratingDiff = p1Rating - p2Rating;
  return p1Rating + ratingChange(ratingDiff, gameScoreDiff);
}

function expectedResult(p1Rating, p2Rating) {
  var exp = (p2Rating - p1Rating) / 400.0;
  return 1 / ((Math.pow(10.0, exp)) + 1);
}

function ratingChange(ratingDiff, gameScoreDiff) {
  var isHigherRated = ratingDiff >= 0;
  var isWinner = gameScoreDiff > 0;
  var isTie = gameScoreDiff === 0;
  var isExpected = !(isHigherRated !== isWinner);
  ratingDiff = Math.abs(ratingDiff);
  var gamesLeft = Math.abs(gameScoreDiff) - 1;

  if (isTie) {
    gamesLeft = 0;
    isWinner = !isHigherRated;
    isExpected = false;
  }

  var ratingRangeList = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195,
    210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 360, 375,
    390, 405, 420, 435, 450, 465, 480];

  var ratingChangeExpectedDict = {
    0: [4, 6, 8], 1: [3.25, 5.5, 7.75], 2: [2.5, 5, 7.5], 3: [1.75, 4.5, 7.25],
    4: [1, 4, 7], 5: [0.25, 3.5, 6.75], 6: [-0.5, 3, 6.5], 7: [-1.25, 2.5, 6.25],
    8: [-2, 2, 6], 9: [-2.75, 1.5, 5.75], 10: [-3.5, 1, 5.5], 11: [-4.25, 0.5, 5.25],
    12: [-5, 0, 5], 13: [-5.75, -0.5, 4.75], 14: [-6.5, -1, 4.5], 15: [-7.25, -1.5, 4.25],
    16: [-8, -2, 4], 17: [-8.75, -2.5, 3.75], 18: [-9.5, -3, 3.5], 19: [-10.25, -3.5, 3.25],
    20: [-11, -4, 3], 21: [-11.75, -4.5, 2.75], 22: [-12.5, -5, 2.5], 23: [-13.25, -5.5, 2.25],
    24: [-14, -6, 2], 25: [-14.75, -6.5, 1.75], 26: [-15.5, -7, 1.5], 27: [-16.25, -7.5, 1.25],
    28: [-17, -8, 1], 29: [-17.75, -8.5, 0.75], 30: [-18.5, -9, 0.5], 31: [-19.25, -9.5, 0.25],
    32: [-20, -10, 0]
  };

  var ratingChangeUnexpectedDict = {
    0: [4, 6, 8], 1: [5, 7.25, 9.5], 2: [6, 8.5, 11], 3: [7.25, 10, 12.75],
    4: [8.5, 11.5, 14.5], 5: [10, 13.25, 16.5], 6: [11.5, 15, 18.5], 7: [13.25, 17, 20.75],
    8: [15, 19, 23], 9: [17, 21.25, 25.5], 10: [19, 23.5, 28], 11: [21.25, 26, 30.75],
    12: [23.5, 28.5, 33.5], 13: [26, 31.25, 36.5], 14: [28.5, 34, 39.5], 15: [31.25, 37, 42.75],
    16: [34, 40, 46], 17: [37, 43.25, 49.5], 18: [40, 46.5, 53], 19: [43.25, 50, 56.75],
    20: [46.5, 53.5, 60.5], 21: [50, 57.25, 64.5], 22: [53.5, 61, 68.5], 23: [57.25, 65, 72.75],
    24: [61, 69, 77], 25: [65, 73.25, 81.5], 26: [69, 77.5, 86], 27: [73.25, 82, 90.75],
    28: [77.5, 86.5, 95.5], 29: [82, 91.25, 100.5], 30: [86.5, 96, 105.5], 31: [91.25, 101, 110.75],
    32: [96, 106, 116]
  };

  var ratingChangeIndex = ratingRangeList.length - 1;
  for (var i = 0; i < ratingRangeList.length; i++) {
    if (ratingDiff <= ratingRangeList[i]) {
      ratingChangeIndex = i;
      break;
    }
  }

  var ratingChangeDict = isExpected ? ratingChangeExpectedDict : ratingChangeUnexpectedDict;
  var ratingChangeList = ratingChangeDict[ratingChangeIndex];
  return isWinner ? ratingChangeList[gamesLeft] : -ratingChangeList[gamesLeft];
}
