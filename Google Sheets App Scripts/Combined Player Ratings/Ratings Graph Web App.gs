/**
 * Ratings Graph Web App - server side
 *
 * Serves the interactive ratings graph as a published web app. Published with
 * "Execute as: Me (owner)" + "Who has access: Anyone (or anyone with a Google
 * account)", so every viewer sees the same data regardless of their share
 * permission on the spreadsheet: all reads happen with the owner's
 * authorization.
 *
 * The graph is 100% client-side: each viewer's show/hide toggles live in their
 * browser (localStorage), never touch the spreadsheet, and never affect anyone
 * else. The only thing this file does is read the spreadsheet and hand the
 * data to the page.
 *
 * The page passes ?ss=combined (default) or ?ss=ccttc in its URL to select
 * which spreadsheet to read. That means one deployment serves both systems.
 *
 * Data sources:
 *   - Ratings tab (column B): the roster in rank order (rank 1 first).
 *   - Ratings tab (column D): each player's last rating-change date, used for
 *     the Hide Inactive filter (same 142-day cutoff as the sheet buttons).
 *   - Rating History tab (hidden): long format [Player, Date, Rating] - the
 *     per-player time series.
 *
 * The Ratings tab is the single source of truth for who is "active": rows the
 * editor hides there (Hide Inactive Players) are DROPPED from the roster here,
 * so viewers can never reveal inactive players. The page therefore has no Show
 * Inactive button. Font colors fade as players approach the 142-day cutoff,
 * mirroring the sheet's week 9-16 peach ramp.
 *
 * Colors use the same golden-angle palette as the sheet (hue steps of 137.508°,
 * s=0.72, v=0.60) so each player's line matches their sheet color.
 */

var RATINGS_GRAPH_SPREADSHEETS = {
  combined: '1NdnC1kN831FVfcInOmFBfe-PU5tgKjFh3I-uxPdVGJM',
  ccttc: '1IYGaCxJjT8H2oTvIdm423oCuSsRGHjWGnTW7dD_7kxg'
};
var RATINGS_GRAPH_DEFAULT = 'combined';
var RATINGS_GRAPH_ROSTER_SHEET = 'Ratings';
var RATINGS_GRAPH_HISTORY_SHEET = 'Rating History';

function resolveSpreadsheetId(ss) {
  ss = String(ss || '').trim().toLowerCase();
  return RATINGS_GRAPH_SPREADSHEETS[ss] || RATINGS_GRAPH_SPREADSHEETS[RATINGS_GRAPH_DEFAULT];
}

/**
 * Entry point for the web app. Serves Ratings Graph.html. The html filename
 * passed to createHtmlOutputFromFile must match the HTML file in this project.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Ratings Graph')
      .setTitle('Player Ratings Over Time')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Read-only data feed for the page. Returns:
 * {
 *   roster:  [player names in rank order],
 *   colors:  [hex colors, one per roster player],
 *   lastDate: { "Player Name": dateMillis | null },   // last rating-change date (Ratings col D)
 *   fade:    { "Player Name": hex | null },           // peach name font color (weeks 9-16) or null
 *   series:  { "Player Name": [[dateMillis, rating], ...] }
 * }
 *
 * Roster excludes players whose rows are hidden on the Ratings tab (the
 * editor's Hide Inactive Players). @param {string} ss 'combined' or 'ccttc'
 * (defaults to 'combined')
 */
function getGraphData(ss) {
  var id = resolveSpreadsheetId(ss);
  var sso = SpreadsheetApp.openById(id);

  var roster = [];
  var lastDate = {};
  var fade = {};
  var ratings = sso.getSheetByName(RATINGS_GRAPH_ROSTER_SHEET);
  if (ratings) {
    var last = ratings.getLastRow();
    if (last > 1) {
      var today = new Date();
      var vals = ratings.getRange(2, 1, last - 1, 4).getValues();
      for (var i = 0; i < vals.length; i++) {
        // Skip rows hidden by the editor (Hide Inactive Players) so viewers
        // can never see inactive players on the graph.
        if (ratings.isRowHiddenByUser(i + 2)) continue;
        var nm = String(vals[i][1]).trim();
        if (nm === '') continue;
        roster.push(nm);
        var d = vals[i][3];
        var ms = (d instanceof Date && !isNaN(d.getTime())) ? d.getTime() : null;
        lastDate[nm] = ms;
        // Same week 9-16 peach fade the Ratings tab applies to name cells, so
        // the graph list fades exactly like the sheet.
        if (ms != null) {
          var daysInactive = Math.floor((today.getTime() - ms) / (1000 * 60 * 60 * 24));
          fade[nm] = graphFadePeach(daysInactive);
        } else {
          fade[nm] = null;
        }
      }
    }
  }

  var colors = graphPalette(roster.length);

  var series = {};
  var hist = sso.getSheetByName(RATINGS_GRAPH_HISTORY_SHEET);
  if (hist) {
    var hLast = hist.getLastRow();
    if (hLast > 1) {
      var hv = hist.getRange(2, 1, hLast - 1, 3).getValues();
      for (var j = 0; j < hv.length; j++) {
        var p = String(hv[j][0]).trim();
        var d = hv[j][1];
        var r = hv[j][2];
        if (p === '' || typeof r !== 'number' || !(d instanceof Date) || isNaN(d.getTime())) continue;
        if (!series[p]) series[p] = [];
        series[p].push([d.getTime(), r]);
      }
    }
  }
  var keys = Object.keys(series);
  for (var k = 0; k < keys.length; k++) {
    series[keys[k]].sort(function (a, b) { return a[0] - b[0]; });
  }

  return { roster: roster, colors: colors, lastDate: lastDate, fade: fade, series: series };
}

/**
 * Week 9-16 peach font-color ramp, the same shades Player Ratings.gs
 * getFadeColors() returns for name cells on the Ratings tab (background
 * #fce5cd). Returns the peach shade for a days-inactive count, or null when
 * the player is fully active (weeks 1-8) or already past the fade (day 142+).
 */
function graphFadePeach(daysInactive) {
  if (daysInactive >= 30 && daysInactive <= 43) {           // Week 9
    return "#5e554c";
  } else if (daysInactive >= 44 && daysInactive <= 57) {    // Week 10
    return "#807468";
  } else if (daysInactive >= 58 && daysInactive <= 71) {    // Week 11
    return "#9a8c7d";
  } else if (daysInactive >= 72 && daysInactive <= 85) {    // Week 12
    return "#af9f8e";
  } else if (daysInactive >= 86 && daysInactive <= 99) {    // Week 13
    return "#c1b09d";
  } else if (daysInactive >= 100 && daysInactive <= 113) {  // Week 14
    return "#d2bfab";
  } else if (daysInactive >= 114 && daysInactive <= 127) {  // Week 15
    return "#e1cdb7";
  } else if (daysInactive >= 128 && daysInactive <= 141) {  // Week 16
    return "#efd9c2";
  }
  return null;
}

/**
 * Golden-angle palette. Same algorithm as Player Ratings.gs swatchPalette(),
 * duplicated here so this file stays self-contained (naming differs to avoid
 * shadowing the global in the combined project).
 */
function graphPalette(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push(graphHsvToHex(((i * 137.508) % 360) / 360, 0.72, 0.60));
  }
  return out;
}

function graphHsvToHex(h, s, v) {
  var r, g, b;
  var i = Math.floor(h * 6);
  var f = h * 6 - i;
  var p = v * (1 - s);
  var q = v * (1 - f * s);
  var t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  var hex = function (x) {
    var s = Math.round(x * 255).toString(16);
    return s.length === 1 ? '0' + s : s;
  };
  return '#' + hex(r) + hex(g) + hex(b);
}
