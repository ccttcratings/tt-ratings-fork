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
var RATINGS_GRAPH_ROSTER_SHEET = '🔵 Ratings';
var RATINGS_GRAPH_HISTORY_SHEET = 'Rating History';

// Switching levers for how often getGraphData re-reads the spreadsheet (data
// changes roughly once a week, so a fresh build is needed ~weekly, not on
// every page load). CacheService keeps a 6-hour copy for fast hits; the
// payload is additionally persisted (chunked) in Script Properties so it
// survives past 6 hours and only rebuilds after GRAPH_WEEK_MS elapses.
var GRAPH_CACHE_PREFIX = 'graphData.';     // CacheService key prefix, per spreadsheet
var GRAPH_PROP_PREFIX = 'graphPayload.';   // PropertiesService chunk prefix, per spreadsheet
var GRAPH_STAMP_PREFIX = 'graphStamp.';    // last-build millis property, per spreadsheet
var GRAPH_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
var GRAPH_PROP_CHUNK = 8000;               // safely under the 9KB per-value property limit

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
  // Re-reads the spreadsheet at most once per GRAPH_WEEK_MS (the underlying
  // data changes roughly once a week), instead of on every page load - which
  // is what used to time out at the 6-minute limit once getLastRow() extended
  // far past the real data. Three tiers, fastest first:
  //   1) CacheService hit: ~every page load within a 6-hour window (Google's
  //      hard maximum TTL).
  //   2) Payload persisted in Script Properties (chunked to dodge the 9KB
  //      per-value cap): serves pages even after the 6-hour cache expires,
  //      still without touching the spreadsheet.
  //   3) Fresh build: only when the weekly stamp is older than GRAPH_WEEK_MS.
  //
  // CRITICAL: the weekly stamp + chunked persistence are written even when the
  // payload exceeds CacheService's 100KB value limit. If they were skipped,
  // every page load would rebuild the payload from scratch and every load
  // would pay the full (slow) build cost - the pre-fix symptom. Only the fast
  // 6-hour cache tier is skipped for over-100KB payloads.
  var id = resolveSpreadsheetId(ss);
  var props = PropertiesService.getScriptProperties();
  var stamp = Number(props.getProperty(GRAPH_STAMP_PREFIX + id) || 0);
  var now = Date.now();
  if (stamp > 0 && now - stamp < GRAPH_WEEK_MS) {
    var cache = CacheService.getScriptCache();
    try {
      var hit = cache.get(GRAPH_CACHE_PREFIX + id);
      if (hit) return JSON.parse(hit);
    } catch (e) { /* corrupt cache entry: fall through */ }
    var persisted = readGraphPayloadChunks(props, id);
    if (persisted) {
      try { return JSON.parse(persisted); } catch (e) { /* corrupt: rebuild */ }
    }
  }
  var data = buildGraphData(id);
  var json = JSON.stringify(data);
  try {
    if (json.length < 100000) {
      CacheService.getScriptCache().put(GRAPH_CACHE_PREFIX + id, json, 21600); // 6h max TTL
    }
    if (writeGraphPayloadChunks(props, id, json)) {
      props.setProperty(GRAPH_STAMP_PREFIX + id, String(now));
    }
  } catch (e) { /* persist failed (quota): next load rebuilds */ }
  return data;
}

/**
 * Forced rebuild, called by runRatingsEngine after each run so the graph shows
 * today's data immediately instead of waiting up to GRAPH_WEEK_MS. Mirrors the
 * build path of getGraphData: rebuilds the payload from the spreadsheet, writes
 * the fresh chunked payload + weekly stamp, and seeds a 6-hour CacheService
 * copy. Between runs the page keeps hitting the cached/persisted payload (no
 * spreadsheet reads), just as before.
 */
function refreshGraphPayload(id) {
  // Accept a real spreadsheet ID (from runRatingsEngine) or a nickname
  // ('combined' / 'ccttc', used for manual refresh / puppeteer tests).
  // Resolve to the real ID so openById() and the cache/property keys line up
  // with getGraphData().
  var realId = RATINGS_GRAPH_SPREADSHEETS[id] || id;
  var data = buildGraphData(realId);
  var json = JSON.stringify(data);
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  try {
    if (json.length < 100000) {
      CacheService.getScriptCache().put(GRAPH_CACHE_PREFIX + realId, json, 21600); // 6h max TTL
    }
    if (writeGraphPayloadChunks(props, realId, json)) {
      props.setProperty(GRAPH_STAMP_PREFIX + realId, String(now));
    }
  } catch (e) { /* persist failed (quota): next run rebuilds */ }
  return data;
}

/**
 * Reassembles the chunked payload from Script Properties. Returns the raw JSON
 * string, or null when no chunks exist. Keys: graphPayload.<id>.0, .1, ...
 */
function readGraphPayloadChunks(props, id) {
  var parts = [];
  for (var n = 0; n < 50; n++) {
    var part = props.getProperty(GRAPH_PROP_PREFIX + id + '.' + n);
    if (part == null) break;
    parts.push(part);
  }
  return parts.length ? parts.join('') : null;
}

/**
 * Persists the payload across the 6-hour cache window. Google caps one
 * property value at ~9KB, so the JSON is split into GRAPH_PROP_CHUNK slices
 * (hard cap of 50 chunks = 400KB, well under the 500KB script-property total).
 * Returns true when the whole payload was stored (caller refreshes the weekly
 * stamp); false when it exceeded the chunked capacity - in that case partial
 * writes are rolled back so next load rebuilds instead of serving garbage.
 */
function writeGraphPayloadChunks(props, id, json) {
  var cap = 50;
  var i = 0;
  for (i = 0; i * GRAPH_PROP_CHUNK < json.length && i < cap; i++) {
    props.setProperty(GRAPH_PROP_PREFIX + id + '.' + i, json.substr(i * GRAPH_PROP_CHUNK, GRAPH_PROP_CHUNK));
  }
  if (i * GRAPH_PROP_CHUNK < json.length) {
    for (var d = 0; d < i; d++) props.deleteProperty(GRAPH_PROP_PREFIX + id + '.' + d);
    return false;
  }
  while (props.getProperty(GRAPH_PROP_PREFIX + id + '.' + i) != null) {
    props.deleteProperty(GRAPH_PROP_PREFIX + id + '.' + i);
    i++;
  }
  return true;
}

function buildGraphData(id) {
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
      // Editor-hidden rows (Hide Inactive Players) come from ONE batched
      // Sheets API request. When the advanced service is not enabled the
      // lookup is empty and all ranked players are shown (faded by
      // graphFadePeach); it never falls back to the slow per-player
      // isRowHiddenByUser() round-trip that used to dominate build time.
      var hidden = graphHiddenRows(id, RATINGS_GRAPH_ROSTER_SHEET, last);
      for (var i = 0; i < vals.length; i++) {
        // The ranked roster's names are contiguous from row 2, so the first
        // empty name ends the list. Breaking here keeps per-row checks to real
        // players only - getLastRow() can extend far past the data (formatted
        // blank rows).
        var nm = String(vals[i][1]).trim();
        if (nm === '') break;
        if (hidden[i + 2]) continue;
        var d = vals[i][3];
        var ms = (d instanceof Date && !isNaN(d.getTime())) ? d.getTime() : null;
        if (ms != null) {
          var daysInactive = Math.floor((today.getTime() - ms) / (1000 * 60 * 60 * 24));
          // Permanently inactive players (past the 142-day window, i.e. beyond
          // week 16 / every fade shade) are never included, whether or not the
          // row happens to be hidden on the sheet. No extra cost: the date is
          // already in hand.
          if (daysInactive >= 142) continue;
          fade[nm] = graphFadePeach(daysInactive);
        } else {
          fade[nm] = null;
        }
        lastDate[nm] = ms;
        roster.push(nm);
      }
    }
  }

  var colors = graphPalette(roster.length);

  var series = {};
  var hist = sso.getSheetByName(RATINGS_GRAPH_HISTORY_SHEET);
  if (hist) {
    var hLast = hist.getLastRow();
    if (hLast > 1) {
      // Safety cap: only the most recent few thousand history rows are read. A
      // chart cannot sensibly render more, and trailing blank rows (e.g.
      // pre-formatted to row 1000) add nothing but time.
      var startRow = Math.max(2, hLast - 4999);
      var hv = hist.getRange(startRow, 1, hLast - startRow + 1, 3).getValues();
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
 * Returns { absoluteRowIndex: true } for user-hidden rows on the roster sheet,
 * read with a single Sheets API request (rowMetadata). Returns {} when the
 * Sheets advanced service is not enabled: the graph then shows all ranked
 * players (faded by graphFadePeach) rather than paying one isRowHiddenByUser()
 * network round-trip per player. Enabling "Google Sheets API" under Project
 * settings both restores the exact inactive-player filtering and keeps the
 * build fast.
 */
function graphHiddenRows(id, sheetName, lastRow) {
  var out = {};
  try {
    var end = Math.min(lastRow, 1000);
    var resp = Sheets.Spreadsheets.get(id, {
      ranges: [sheetName + '!1:' + end],
      fields: 'sheets.data.rowMetadata.hiddenByUser'
    });
    var meta = resp.sheets[0].data[0].rowMetadata;
    for (var i = 0; i < meta.length; i++) {
      if (meta[i].hiddenByUser) out[i + 1] = true; // metadata index 0 == row 1
    }
  } catch (e) { /* advanced service disabled: no hidden info, show all */ }
  return out;
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
