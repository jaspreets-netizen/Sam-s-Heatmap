/**
 * ============================================================
 *  Sam's Weekly – Heat Map Script v21
 * ============================================================
 *
 *  CHANGES IN v21 (vs v20)
 *  ───────────────────────
 *  1. NEW — Metric definitions are now DATA-DRIVEN.
 *     There is no longer a hardcoded list of metric names inside
 *     the code. Instead a "⚙ Heat Map Config" sheet holds the
 *     table of metrics. Add / remove / rename a metric there and
 *     the heat map picks it up on the next run — no code edits.
 *     Build it from the menu: 🎨 Heat Map → Create / Refresh
 *     Config Sheet. If the sheet does not exist yet, the script
 *     falls back to the built-in defaults so it still works.
 *
 *  2. NEW — Robust, typo-tolerant matching + safe fallback.
 *     • Matching ignores case, collapses extra spaces and matches
 *       on a substring, so "System  Uptime " still matches
 *       "system uptime".
 *     • The LONGEST matching config entry wins, so short keys
 *       (e.g. "uph") can't hijack a longer label.
 *     • A "Target Heatmap" row that has a number in Col D but no
 *       matching config entry is STILL coloured (default:
 *       higher-is-better) instead of being skipped. A small typo
 *       no longer blanks the whole row — it just flags a note.
 *
 *  RETAINED FROM v20
 *  ─────────────────
 *  • System Uptime, Ranger Uptime, BT/MI are Target metrics.
 *  • Relative Heatmap is GREEN-ONLY (shade = size of the
 *    week-over-week change; direction does not change colour).
 *  • Non-destructive colouring, batched writes, onEdit single-row
 *    processing, Apply to Selection, validation notes.
 * ============================================================
 */


// ── Behaviour toggles ────────────────────────────────────────
var VALIDATE = true;   // set false to disable the validation notes


// ── Constants ────────────────────────────────────────────────
var FLAG_COL   = 1;   // Col A
var METRIC_COL = 3;   // Col C — metric name for Target rows
var TARGET_COL = 4;   // Col D — numeric target for Target rows
var DATA_START = 5;   // Col E — first possible data column
var LABEL_COL_MAX = 4; // Col D — labels live in B/C/D, NEVER in the data region
var FLAG_TARGET   = "target heatmap";
var FLAG_RELATIVE = "relative heatmap";

var GUIDE_SHEET_NAME  = "⚙ Heat Map Guide";
var CONFIG_SHEET_NAME = "⚙ Heat Map Config";   // editable metric table
var CONFIG_DATA_ROW   = 3;                     // first metric row on the Config sheet


// ── Built-in DEFAULT metric tables ───────────────────────────
// These are ONLY used when the "⚙ Heat Map Config" sheet does not
// exist yet. Once that sheet is created you edit it, not this code.
//
// Target metrics — direction: "higher" = a higher value is better
//                             "lower"  = a lower value is better
//   yellowPct = fraction past target still counted as "yellow"
var DEFAULT_TARGET_METRICS = [
  { name: "ppf",           direction: "higher", yellowPct: 0.20, decimals: 2 },
  { name: "uph",           direction: "higher", yellowPct: 0.10, decimals: 0 },
  { name: "owt",           direction: "lower",  yellowPct: 0.20, decimals: 1 },
  { name: "r2r",           direction: "lower",  yellowPct: 0.20, decimals: 1 },
  { name: "system uptime", direction: "higher", yellowPct: 0.02, decimals: 2 },
  { name: "ranger uptime", direction: "higher", yellowPct: 0.02, decimals: 2 },
  { name: "bt/mi",         direction: "higher", yellowPct: 0.20, decimals: 2 }
];

// Relative metrics — "group" selects the change-size threshold set.
var DEFAULT_RELATIVE_METRICS = [
  { name: "bot availability",     group: "uptime"   },
  { name: "throughput",           group: "moderate" },
  { name: "order breaches",       group: "volatile" },
  { name: "hours operational",    group: "stable"   },
  { name: "pps uph",              group: "moderate" },
  { name: "rack presented",       group: "stable"   },
  { name: "# skus in the field",  group: "stable"   },
  { name: "# units in the field", group: "stable"   },
  { name: "untouched units",      group: "volatile" },
  { name: "cubic utilization",    group: "stable"   },
  { name: "totes",                group: "stable"   },
  { name: "non-chemical racking", group: "stable"   },
  { name: "chemical racking",     group: "stable"   },
  { name: "ppf",                  group: "moderate" },
  { name: "pps",                  group: "moderate" }
];

// Fallbacks used when a row's metric name matches no config entry.
var TARGET_DEFAULT   = { direction: "higher", yellowPct: 0.20, decimals: 2 };
var RELATIVE_DEFAULT_GROUP = "moderate";

var GROUP_THRESHOLDS = {
  uptime:   [0.1,  0.5, 1,   2  ],   // uptime moves are tiny; small % steps
  stable:   [0.01, 2,   4,   6  ],
  moderate: [2,    8,   15,  25 ],
  volatile: [15,   40,  100, 250]
};


// ── Magnitude colour ramp (Relative Heatmap — GREEN ONLY) ────
// Intensity reflects the SIZE of the week-over-week change.
var GREEN_RAMP = [
  { r: 242, g: 242, b: 242 },  // 0 no change        #F2F2F2
  { r: 232, g: 245, b: 232 },  // 1 tiny change      #E8F5E8
  { r: 200, g: 230, b: 200 },  // 2 small change     #C8E6C8
  { r: 168, g: 212, b: 168 },  // 3 moderate change  #A8D4A8
  { r: 123, g: 184, b: 123 }   // 4 large change     #7BB87B
];

// ── Target heatmap colours ───────────────────────────────────
var COLOR_GREEN       = { r: 198, g: 239, b: 206 };
var COLOR_YELLOW_LITE = { r: 255, g: 255, b: 204 };
var COLOR_YELLOW_MED  = { r: 255, g: 243, b: 176 };
var COLOR_LIGHT_RED   = { r: 255, g: 199, b: 199 };
var COLOR_DARK_RED    = { r: 139, g:   0, b:   0 };
var MAX_TIMES = 5;


// ════════════════════════════════════════════════════════════
//  CONFIG LOADING  (data-driven metric table)
//  Reads the "⚙ Heat Map Config" sheet once per execution and
//  caches it. Falls back to the built-in defaults if absent/empty.
// ════════════════════════════════════════════════════════════

var _CFG_CACHE = null;   // reset automatically on each script execution

function getConfig_() {
  if (_CFG_CACHE) return _CFG_CACHE;

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  var target = [], relative = [];

  if (sh) {
    var lastRow = sh.getLastRow();
    if (lastRow >= CONFIG_DATA_ROW) {
      var rows = sh.getRange(CONFIG_DATA_ROW, 1, lastRow - CONFIG_DATA_ROW + 1, 6).getValues();
      rows.forEach(function(rw) {
        var name = collapseWs_(rw[0]);          // A: metric name (match text)
        if (!name) return;
        var type = collapseWs_(rw[1]);          // B: Target / Relative
        if (type.indexOf("relative") !== -1) {
          var grp = collapseWs_(rw[5]) || RELATIVE_DEFAULT_GROUP;  // F: group
          if (!GROUP_THRESHOLDS[grp]) grp = RELATIVE_DEFAULT_GROUP;
          relative.push({ name: name, group: grp });
        } else {                                 // default: treat as Target
          var dir = collapseWs_(rw[2]).indexOf("low") !== -1 ? "lower" : "higher";  // C
          var yb  = parseNum_(rw[3]);            // D: yellow band as a percent (e.g. 20)
          var dec = parseNum_(rw[4]);            // E: decimals
          target.push({
            name:      name,
            direction: dir,
            yellowPct: (yb === null ? 20 : yb) / 100,
            decimals:  (dec === null ? 2 : Math.max(0, Math.round(dec)))
          });
        }
      });
    }
  }

  // No Config sheet, or it exists but holds no usable rows → defaults.
  if (target.length === 0 && relative.length === 0) {
    target   = DEFAULT_TARGET_METRICS.slice();
    relative = DEFAULT_RELATIVE_METRICS.slice();
  }

  target.forEach(function(e)   { e.nameNorm = collapseWs_(e.name); });
  relative.forEach(function(e) { e.nameNorm = collapseWs_(e.name); });

  _CFG_CACHE = { target: target, relative: relative };
  return _CFG_CACHE;
}

// Longest substring match wins; null if nothing matches.
function resolveTargetCfg_(metricNorm) {
  if (!metricNorm) return null;
  var list = getConfig_().target, best = null;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.nameNorm && metricNorm.indexOf(e.nameNorm) !== -1) {
      if (!best || e.nameNorm.length > best.nameNorm.length) best = e;
    }
  }
  return best;
}

function resolveRelativeGroup_(labelNorm) {
  if (!labelNorm) return RELATIVE_DEFAULT_GROUP;
  var list = getConfig_().relative, best = null;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.nameNorm && labelNorm.indexOf(e.nameNorm) !== -1) {
      if (!best || e.nameNorm.length > best.nameNorm.length) best = e;
    }
  }
  return best ? best.group : RELATIVE_DEFAULT_GROUP;
}


// ════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════

function applyHeatMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function(sheet) {
    try {
      if (sheet.getType() !== SpreadsheetApp.SheetType.GRID) return;
      if (isSystemSheet_(sheet)) return;
      processSheet_(sheet);
    } catch(e) {
      Logger.log("Skipping '" + sheet.getName() + "': " + e.message);
    }
  });
  SpreadsheetApp.flush();
}

function applyToSelection() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var sel   = sheet.getActiveRange();
  if (!sel) {
    SpreadsheetApp.getUi().alert("Please select a range first.");
    return;
  }
  if (isSystemSheet_(sheet)) return;

  var allCols = getAllDataCols_(sheet);
  if (allCols.length === 0) {
    SpreadsheetApp.getUi().alert("No data columns found from column E onward.");
    return;
  }

  // Determine unique rows in selection — works whether selection is
  // a single column, a single row, or any rectangular range
  var startRow = sel.getRow();
  var endRow   = sel.getLastRow();

  // Read all col A flags for selected rows in ONE call
  var flagVals = sheet.getRange(startRow, FLAG_COL, endRow - startRow + 1, 1).getValues();

  // Collect only rows that need processing
  var targetRows   = [];
  var relativeRows = [];
  for (var r = 0; r < flagVals.length; r++) {
    var flag = cleanStr_(flagVals[r][0]);
    if (flag === FLAG_TARGET)        targetRows.push(startRow + r);
    else if (flag === FLAG_RELATIVE) relativeRows.push(startRow + r);
  }

  // Process each qualifying row
  targetRows.forEach(function(row) {
    processTargetRow_(sheet, row, allCols);
  });
  relativeRows.forEach(function(row) {
    processRelativeRow_(sheet, row, allCols);
  });

  SpreadsheetApp.flush();
}


function onEdit(e) {
  if (!e) return;
  try {
    var sheet = e.source.getActiveSheet();
    if (sheet.getType() !== SpreadsheetApp.SheetType.GRID) return;
    if (isSystemSheet_(sheet)) return;

    var editedRow = e.range.getRow();

    // Process only the edited row — not the whole sheet
    var flag = cleanStr_(sheet.getRange(editedRow, FLAG_COL).getValue());
    var allCols = getAllDataCols_(sheet);
    if (allCols.length === 0) return;

    if (flag === FLAG_TARGET) {
      processTargetRow_(sheet, editedRow, allCols);
    } else if (flag === FLAG_RELATIVE) {
      processRelativeRow_(sheet, editedRow, allCols);
    }
  } catch(err) { Logger.log("onEdit: " + err.message); }
}


function clearAllNotes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function(sheet) {
    if (sheet.getType() !== SpreadsheetApp.SheetType.GRID) return;
    if (isSystemSheet_(sheet)) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return;
    sheet.getRange(1, 1, lastRow, lastCol).clearNote();
  });
  SpreadsheetApp.flush();
}


// ════════════════════════════════════════════════════════════
//  COLUMN RANGE
//  Returns every column from DATA_START to the last column.
//  Each row processor builds its OWN data-column list by checking
//  which columns actually have numeric values in THAT row — which
//  prevents cross-row contamination in the prior-week scan.
// ════════════════════════════════════════════════════════════

function getAllDataCols_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < DATA_START) return [];
  var cols = [];
  for (var c = DATA_START; c <= lastCol; c++) {
    cols.push(c);
  }
  return cols;
}


// ════════════════════════════════════════════════════════════
//  SHEET PROCESSOR
// ════════════════════════════════════════════════════════════

function processSheet_(sheet) {
  var allCols = getAllDataCols_(sheet);
  if (allCols.length === 0) return;
  var lastRow  = sheet.getLastRow();
  var flagVals = sheet.getRange(1, FLAG_COL, lastRow, 1).getValues();
  for (var row = 3; row <= lastRow; row++) {
    var flag = cleanStr_(flagVals[row - 1][0]);
    if      (flag === FLAG_TARGET)   processTargetRow_(sheet, row, allCols);
    else if (flag === FLAG_RELATIVE) processRelativeRow_(sheet, row, allCols);
  }
}


// ════════════════════════════════════════════════════════════
//  TARGET HEATMAP ROW  (batched, non-destructive)
// ════════════════════════════════════════════════════════════

function processTargetRow_(sheet, row, allCols) {
  if (!allCols || allCols.length === 0) return;

  var target = parseNum_(sheet.getRange(row, TARGET_COL).getValue());
  if (target === null || target === 0) return;

  // Metric config is looked up from the Config sheet (typo-tolerant).
  // If the name matches nothing we still colour the row using a safe
  // default so a small label change never blanks the whole row.
  var metricNorm = collapseWs_(sheet.getRange(row, METRIC_COL).getValue());
  var cfg = resolveTargetCfg_(metricNorm);
  var usedFallback = false;
  if (!cfg) { cfg = TARGET_DEFAULT; usedFallback = true; }

  if (VALIDATE) {
    // Flag (don't block) a fallback so you can spot an unrecognised name.
    if (usedFallback && metricNorm)
      sheet.getRange(row, METRIC_COL).setNote(
        "⚠ Not found in “" + CONFIG_SHEET_NAME + "”. Coloured with the default " +
        "(higher-is-better). Add this name to the Config sheet to control its direction/thresholds.");
    else
      sheet.getRange(row, METRIC_COL).clearNote();
  }

  var firstCol = allCols[0];
  var lastCol  = allCols[allCols.length - 1];
  var nCols    = lastCol - firstCol + 1;
  var rowRange = sheet.getRange(row, firstCol, 1, nCols);
  var rowVals  = rowRange.getValues()[0];

  // Output buffers — null background/font = cleared cell, "" note = no note
  var bgs = [[]], fcs = [[]], notes = [[]];
  for (var i = 0; i < nCols; i++) { bgs[0][i] = null; fcs[0][i] = null; notes[0][i] = ""; }

  for (var ci = 0; ci < allCols.length; ci++) {
    var col = allCols[ci];
    var idx = col - firstCol;
    var raw = rowVals[idx];
    var isEmpty = (raw === "" || raw === null || raw === undefined);
    var value = parseNum_(stripArrow_(raw));

    if (value === null) {
      if (VALIDATE && !isEmpty && !looksLikeLabel_(cleanStr_(raw), metricNorm))
        notes[0][idx] = "⚠ Non-numeric value — not coloured.";
      continue;  // leaves null in buffers → cell is cleared
    }

    var rounded   = Math.round(value * Math.pow(10, cfg.decimals)) / Math.pow(10, cfg.decimals);
    var targetMet = cfg.direction === "higher" ? rounded >= target : rounded <= target;
    var bgRgb;

    if (targetMet) {
      bgRgb = COLOR_GREEN;
    } else {
      var bp = cfg.direction === "higher"
        ? (target - rounded) / target
        : (rounded - target) / target;
      if (bp <= cfg.yellowPct) {
        var yt = bp / cfg.yellowPct;
        bgRgb = {
          r: Math.round(lerp_(COLOR_YELLOW_LITE.r, COLOR_YELLOW_MED.r, yt)),
          g: Math.round(lerp_(COLOR_YELLOW_LITE.g, COLOR_YELLOW_MED.g, yt)),
          b: Math.round(lerp_(COLOR_YELLOW_LITE.b, COLOR_YELLOW_MED.b, yt))
        };
      } else {
        var rr = cfg.direction === "higher"
          ? (bp - cfg.yellowPct) / (1.0 - cfg.yellowPct)
          : (bp - cfg.yellowPct) / ((MAX_TIMES - 1) - cfg.yellowPct);
        rr = Math.max(0, Math.min(rr, 1));
        bgRgb = {
          r: Math.round(lerp_(COLOR_LIGHT_RED.r, COLOR_DARK_RED.r, rr)),
          g: Math.round(lerp_(COLOR_LIGHT_RED.g, COLOR_DARK_RED.g, rr)),
          b: Math.round(lerp_(COLOR_LIGHT_RED.b, COLOR_DARK_RED.b, rr))
        };
      }
    }
    bgs[0][idx] = rgbToHex_(bgRgb.r, bgRgb.g, bgRgb.b);
    fcs[0][idx] = readableTextColor_(bgRgb.r, bgRgb.g, bgRgb.b);
  }

  // Pre-clear guarantees stale colours are removed regardless of how
  // null is interpreted by setBackgrounds; then apply in one shot.
  rowRange.setBackground(null);
  rowRange.setFontColor(null);
  rowRange.setBackgrounds(bgs);
  rowRange.setFontColors(fcs);
  rowRange.setNotes(notes);
}


// ════════════════════════════════════════════════════════════
//  RELATIVE HEATMAP ROW  (batched, non-destructive, GREEN-ONLY)
//
//  Every cell is shaded with the GREEN ramp. The shade depth
//  reflects the MAGNITUDE of the week-over-week change only — the
//  direction (up or down) no longer affects the colour.
// ════════════════════════════════════════════════════════════

function processRelativeRow_(sheet, row, allCols) {
  if (!allCols || allCols.length === 0) return;

  // Metric label: rightmost non-empty text in cols B–D.
  // IMPORTANT: never scan column E onward — that is the data region.
  var metricLabel = "";
  for (var mc = LABEL_COL_MAX; mc >= 2; mc--) {
    var v = cleanStr_(sheet.getRange(row, mc).getValue());
    if (v && v !== "-") { metricLabel = v; break; }
  }

  var group = resolveRelativeGroup_(collapseWs_(metricLabel));

  var firstCol = allCols[0];
  var lastCol  = allCols[allCols.length - 1];
  var nCols    = lastCol - firstCol + 1;
  var rowRange = sheet.getRange(row, firstCol, 1, nCols);
  var rowVals  = rowRange.getValues()[0];
  var rowFmts  = rowRange.getNumberFormats()[0];

  var colData = {};
  var dataColsThisRow = [];  // ordered list of cols with real numeric data

  for (var ci = 0; ci < allCols.length; ci++) {
    var col    = allCols[ci];
    var raw    = rowVals[col - firstCol];
    var fmt    = rowFmts[col - firstCol];
    var rawStr = String(raw);
    var isEmpty = (raw === "" || raw === null || raw === undefined);

    var isPct = rawStr.indexOf("%") !== -1 || (fmt && fmt.indexOf("%") !== -1);
    var num   = parseNum_(stripArrow_(raw));

    var normNum = num;
    if (num !== null) {
      if (group === "uptime" && num > 0 && num <= 1.0001) normNum = num * 100;
      else if (isPct && num > 0 && num < 2)               normNum = num * 100;
    }

    colData[col] = { raw: raw, num: num, normNum: normNum, isPct: isPct, isEmpty: isEmpty };
    if (num !== null) dataColsThisRow.push(col);
  }

  // Output buffers
  var bgs = [[]], fcs = [[]], notes = [[]];
  for (var b = 0; b < nCols; b++) { bgs[0][b] = null; fcs[0][b] = null; notes[0][b] = ""; }

  // Validation: non-empty but non-numeric cells get a note (not coloured)
  if (VALIDATE) {
    for (var cv = 0; cv < allCols.length; cv++) {
      var colv = allCols[cv];
      var dv   = colData[colv];
      if (dv.num === null && !dv.isEmpty && !looksLikeLabel_(cleanStr_(dv.raw), metricLabel)) {
        notes[0][colv - firstCol] = "⚠ Non-numeric value — not coloured.";
      }
    }
  }

  // Colour the columns that have actual data — GREEN-ONLY by magnitude
  for (var di = 0; di < dataColsThisRow.length; di++) {
    var dcol = dataColsThisRow[di];
    var idx  = dcol - firstCol;
    var d    = colData[dcol];

    // Prior week: scan left through dataColsThisRow ONLY, so we never
    // compare against a value from a different row.
    var prevNorm = null;
    for (var pi = di - 1; pi >= 0; pi--) {
      var pd = colData[dataColsThisRow[pi]];
      if (pd && pd.num !== null) { prevNorm = pd.normNum; break; }
    }

    var bgIndex   = 0;  // 0 = no change (neutral); higher = bigger change
    var hasChange = (prevNorm !== null && prevNorm !== 0 && d.normNum !== prevNorm);

    if (hasChange) {
      var changePct = Math.abs((d.normNum - prevNorm) / prevNorm) * 100;
      bgIndex = changeToBgIndex_(changePct, group);
    }

    // GREEN-ONLY: the shade depth encodes how big the change was.
    var bgRgb = GREEN_RAMP[bgIndex];
    bgs[0][idx] = rgbToHex_(bgRgb.r, bgRgb.g, bgRgb.b);
    fcs[0][idx] = readableTextColor_(bgRgb.r, bgRgb.g, bgRgb.b);
  }

  // Single batched write — values and number formats are left untouched
  rowRange.setBackground(null);
  rowRange.setFontColor(null);
  rowRange.setBackgrounds(bgs);
  rowRange.setFontColors(fcs);
  rowRange.setNotes(notes);
}


// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

function isSystemSheet_(sheet) {
  var n = sheet.getName();
  return n === GUIDE_SHEET_NAME || n === CONFIG_SHEET_NAME;
}

function changeToBgIndex_(pct, group) {
  var t = GROUP_THRESHOLDS[group];
  if (!t) return 0;
  if (pct >= t[2]) return 3;  // max is index 3 (Large)
  if (pct >= t[1]) return 2;
  if (pct >= t[0]) return 1;
  return 0;
}

function stripArrow_(raw) {
  if (raw === null || raw === undefined) return raw;
  return String(raw).replace(/\s*[▲▼–]\s*$/, "").trim();
}

function readableTextColor_(r, g, b) {
  var rs = r/255, gs = g/255, bs = b/255;
  rs = rs <= 0.03928 ? rs/12.92 : Math.pow((rs+0.055)/1.055, 2.4);
  gs = gs <= 0.03928 ? gs/12.92 : Math.pow((gs+0.055)/1.055, 2.4);
  bs = bs <= 0.03928 ? bs/12.92 : Math.pow((bs+0.055)/1.055, 2.4);
  return (0.2126*rs + 0.7152*gs + 0.0722*bs) < 0.35 ? "#FFFFFF" : "#000000";
}

function lerp_(a, b, t) { return a + (b-a)*t; }

function rgbToHex_(r, g, b) {
  return "#" + pad2_(r.toString(16)) + pad2_(g.toString(16)) + pad2_(b.toString(16));
}

function pad2_(s) { return s.length < 2 ? "0"+s : s; }

function parseNum_(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  var s = String(raw)
    .replace(/[​‌‍﻿]/g, "")
    .replace(/[▲▼–]/g, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  if (s === "") return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

function cleanStr_(raw) {
  return String(raw).replace(/[​‌‍﻿]/g, "").trim().toLowerCase();
}

// Lowercase + strip zero-width + collapse runs of whitespace to one space.
// Used for typo/spacing-tolerant metric-name matching.
function collapseWs_(raw) {
  return String(raw).replace(/[​‌‍﻿]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// True when a non-numeric cell is actually a metric label / header that has
// bled into the data column range, rather than corrupt data. Such cells are
// left blank with NO validation note.
function looksLikeLabel_(text, rowLabel) {
  if (!text) return false;
  var t = collapseWs_(text);
  if (rowLabel && t === collapseWs_(rowLabel)) return true;   // matches this row's own label
  var cfg = getConfig_();
  for (var i = 0; i < cfg.relative.length; i++)
    if (cfg.relative[i].nameNorm && t.indexOf(cfg.relative[i].nameNorm) !== -1) return true;
  for (var j = 0; j < cfg.target.length; j++)
    if (cfg.target[j].nameNorm && t.indexOf(cfg.target[j].nameNorm) !== -1) return true;
  return false;
}


// ════════════════════════════════════════════════════════════
//  CONFIG SHEET  (the editable metric table)
// ════════════════════════════════════════════════════════════

function createConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var ex = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (ex) {
    var resp = ui.alert(
      "Config sheet already exists",
      'Rebuilding "' + CONFIG_SHEET_NAME + '" RESETS it to defaults and ' +
      'discards your edits. Continue?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ss.deleteSheet(ex);
  }
  var sh = ss.insertSheet(CONFIG_SHEET_NAME, 0);

  var OG = "#FF8400", NV = "#232359", LG = "#F5F5F5", WH = "#FFFFFF";

  // Title + intro
  sh.getRange(1,1,1,6).merge()
    .setValue("⚙  Heat Map Config — edit metrics here (no code changes needed)")
    .setBackground(OG).setFontColor(WH).setFontWeight("bold").setFontSize(13)
    .setFontFamily("Arial").setVerticalAlignment("middle");
  sh.setRowHeight(1, 34);

  // Column headers (row 2 — data starts row 3 = CONFIG_DATA_ROW)
  var headers = [
    "Metric Name (partial match, not case-sensitive)",
    "Type",
    "Direction (Target only)",
    "Yellow Band % (Target only)",
    "Decimals (Target only)",
    "Group (Relative only)"
  ];
  var hdr = sh.getRange(2,1,1,6);
  hdr.setValues([headers])
     .setBackground(NV).setFontColor(WH).setFontWeight("bold").setFontSize(9)
     .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
  sh.setRowHeight(2, 40);

  // Build the data rows from current defaults
  var data = [];
  DEFAULT_TARGET_METRICS.forEach(function(m) {
    data.push([m.name, "Target", m.direction, Math.round(m.yellowPct * 100), m.decimals, ""]);
  });
  DEFAULT_RELATIVE_METRICS.forEach(function(m) {
    data.push([m.name, "Relative", "", "", "", m.group]);
  });
  sh.getRange(CONFIG_DATA_ROW, 1, data.length, 6).setValues(data)
    .setFontFamily("Arial").setFontSize(9).setVerticalAlignment("middle");

  // Zebra striping for readability
  for (var i = 0; i < data.length; i++) {
    if (i % 2 === 1)
      sh.getRange(CONFIG_DATA_ROW + i, 1, 1, 6).setBackground(LG);
  }

  // Dropdown validations over a generous range so new rows are guided too
  var vEnd = CONFIG_DATA_ROW + Math.max(data.length, 0) + 200;
  function dropdown(col, values) {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(values, true).setAllowInvalid(true).build();
    sh.getRange(CONFIG_DATA_ROW, col, vEnd - CONFIG_DATA_ROW + 1, 1).setDataValidation(rule);
  }
  dropdown(2, ["Target", "Relative"]);
  dropdown(3, ["higher", "lower"]);
  dropdown(6, Object.keys(GROUP_THRESHOLDS));

  // Footer help
  var fr = CONFIG_DATA_ROW + data.length + 1;
  sh.getRange(fr,1,1,6).merge()
    .setValue("How to use:  • Add a row to add a metric (the Name is matched as a " +
      "case-insensitive partial — extra spaces are ignored).  • Type = Target → coloured " +
      "green/yellow/red vs the target in Col D of your data sheet; set Direction (higher = " +
      "bigger is better, lower = smaller is better), Yellow Band % (how far past target is " +
      "still yellow), and Decimals.  • Type = Relative → green-only by size of week-over-week " +
      "change; set Group (stable / moderate / volatile / uptime).  • Delete a row to remove a " +
      "metric.  Then run 🎨 Heat Map → Apply / Refresh Heat Map.")
    .setBackground(LG).setFontColor(NV).setFontSize(9).setFontFamily("Arial")
    .setWrap(true).setVerticalAlignment("top");
  sh.setRowHeight(fr, 96);

  sh.setColumnWidth(1, 320);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 150);
  sh.setColumnWidth(4, 150);
  sh.setColumnWidth(5, 130);
  sh.setColumnWidth(6, 150);
  sh.setFrozenRows(2);

  ui.alert('✅ Config sheet created: "' + CONFIG_SHEET_NAME + '".\n\n' +
    'Edit metrics there, then run 🎨 Heat Map → Apply / Refresh Heat Map.');
}


// ════════════════════════════════════════════════════════════
//  HELPER SHEET  (rebuilt for v21)
// ════════════════════════════════════════════════════════════

function createHelperSheet() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var name = GUIDE_SHEET_NAME;
  var ex   = ss.getSheetByName(name);
  if (ex) ss.deleteSheet(ex);
  var sh = ss.insertSheet(name, 0);

  var OG = "#FF8400", NV = "#232359", LG = "#F5F5F5", WH = "#FFFFFF";

  function s(range, bg, fg, bold, sz, wrap) {
    range.setBackground(bg||WH).setFontColor(fg||NV)
         .setFontWeight(bold?"bold":"normal").setFontSize(sz||9)
         .setFontFamily("Arial").setVerticalAlignment("middle");
    if (wrap) range.setWrap(true);
    return range;
  }
  function rh(r,h){ sh.setRowHeight(r,h||24); }
  function sec(r,t){ s(sh.getRange(r,1,1,8).merge(),NV,WH,true,10).setValue(t); rh(r,26); }
  function row2(r,a,b,bg){ var bg_=bg||WH; s(sh.getRange(r,1),bg_,NV,true).setValue(a); s(sh.getRange(r,2,1,7).merge(),bg_,NV,false,9,true).setValue(b); rh(r,30); }
  function chdr(r,a,b){ s(sh.getRange(r,1),OG,WH,true).setValue(a); s(sh.getRange(r,2,1,7).merge(),OG,WH,true).setValue(b); rh(r,22); }
  function swatch(r,bg,lbl){ sh.getRange(r,1).setBackground(bg).setValue(" "); s(sh.getRange(r,2,1,7).merge(),r%2===0?WH:LG,NV,false,9,true).setValue(lbl); rh(r,24); }

  var r = 1;

  // Title
  s(sh.getRange(r,1,1,8).merge(),OG,WH,true,14).setValue("⚙  Heat Map System Guide").setHorizontalAlignment("left"); rh(r,36); r++;
  s(sh.getRange(r,1,1,8).merge(),NV,WH,false,9).setValue("How the script reads your sheet — v21 (metrics are now data-driven)"); rh(r,20); r++;

  // STEP 0 — Config sheet
  rh(r,8); r++;
  sec(r,"STEP 0 — METRICS LIVE IN THE CONFIG SHEET (not in code)"); r++;
  s(sh.getRange(r,1,1,8).merge(),LG,NV,false,9,true).setValue('Run 🎨 Heat Map → Create / Refresh Config Sheet to build "' + CONFIG_SHEET_NAME + '". Add, rename or remove metrics there — the heat map reads it on the next run. To add a brand-new target metric tomorrow, just add a row (Name, Type = Target, Direction, Yellow Band %, Decimals). No code changes. If the Config sheet does not exist, built-in defaults are used.'); rh(r,56); r++;
  chdr(r,"Config column","Meaning"); r++;
  row2(r,"Metric Name","Matched against Col C (Target) or Col B/C/D (Relative). Case-insensitive, extra spaces ignored, partial match. Longest match wins."); r++;
  row2(r,"Type","Target or Relative.",LG); r++;
  row2(r,"Direction","Target only. higher = bigger is better; lower = smaller is better."); r++;
  row2(r,"Yellow Band %","Target only. How far past the target still shows yellow before red (e.g. 20 = 20%).",LG); r++;
  row2(r,"Decimals","Target only. Rounding used before comparing to the target."); r++;
  row2(r,"Group","Relative only. stable / moderate / volatile / uptime — sets the change-size thresholds.",LG); r++;

  // STEP 1
  rh(r,8); r++;
  sec(r,"STEP 1 — COLUMN DETECTION"); r++;
  s(sh.getRange(r,1,1,8).merge(),LG,NV,false,9,true).setValue('Every column from Col E onward is scanned. For each row, only columns that contain an actual numeric value are coloured — empty and label columns are skipped automatically.'); rh(r,32); r++;
  chdr(r,"Column","Result"); r++;
  row2(r,"Col E onward, numeric value in this row","✓  Coloured — background applied"); r++;
  row2(r,"Col E onward, empty / text value in this row","✗  Skipped (text values get a ⚠ note)",LG); r++;

  // STEP 2
  rh(r,8); r++;
  sec(r,"STEP 2 — ROW DETECTION (Column A)"); r++;
  chdr(r,"Column A","What happens"); r++;
  row2(r,'"Target Heatmap"','Green / yellow / red vs the numeric target in Col D. Metric read from Col C and looked up in the Config sheet. If the name is not found, the row is still coloured with a safe default (higher-is-better) and the Col C cell gets a ⚠ note.'); r++;
  row2(r,'"Relative Heatmap"','GREEN ONLY. Shade intensity = magnitude of the week-over-week change (bigger change = darker green). Direction up/down does not change the colour. Metric label read from Col B/C/D.',LG); r++;
  row2(r,'(empty / other)','Row skipped entirely — safe for headers, blank rows, section titles.'); r++;

  // Target scale
  rh(r,8); r++;
  sec(r,"TARGET HEATMAP — Colour Scale"); r++;
  [["#C6EFCE","Target met or exceeded"],
   ["#FFFFCC","Within the Yellow Band set in the Config sheet"],
   ["#FFC7C7","Beyond the band — outside acceptable range"],
   ["#8B0000","Extreme breach — far from target (white text)"]
  ].forEach(function(t){ swatch(r,t[0],t[1]); r++; });

  // Relative scale
  rh(r,8); r++;
  sec(r,"RELATIVE HEATMAP — Magnitude Colour Scale (GREEN ONLY)"); r++;
  [["#F2F2F2","No change — neutral grey"],
   ["#E8F5E8","Tiny week-over-week change"],
   ["#C8E6C8","Small week-over-week change"],
   ["#A8D4A8","Moderate week-over-week change"],
   ["#7BB87B","Large week-over-week change (max shade)"]
  ].forEach(function(t){ swatch(r,t[0],t[1]); r++; });

  // Threshold groups
  rh(r,8); r++;
  sec(r,"RELATIVE GROUP CHANGE-SIZE THRESHOLDS"); r++;
  chdr(r,"Group","Week-over-week change → shade"); r++;
  [["Stable","Any change: light | >2%: mid | >4%: dark | >6%: darkest"],
   ["Moderate","≥2%: light | ≥8%: mid | ≥15%: dark | ≥25%: darkest"],
   ["Volatile","≥15%: light | ≥40%: mid | ≥100%: dark | ≥250%: darkest"],
   ["Uptime","≥0.1%: light | ≥0.5%: mid | ≥1%: dark | ≥2%: darkest"]
  ].forEach(function(g,i){ s(sh.getRange(r,1),i%2===0?WH:LG,NV,true).setValue(g[0]); s(sh.getRange(r,2,1,7).merge(),i%2===0?WH:LG,NV,false,9,true).setValue(g[1]); rh(r,28); r++; });

  // Checklist
  rh(r,8); r++;
  sec(r,"QUICK SETUP CHECKLIST"); r++;
  ['Run 🎨 Heat Map → Create / Refresh Config Sheet (once) and review the metric list',
   'Col A: "Target Heatmap" for rows with a numeric target in Col D',
   'Col A: "Relative Heatmap" for rows with no target',
   'Col C: metric name for Target rows (must appear in the Config sheet)',
   'Col D: numeric target value for Target rows',
   'Add a new metric anytime by adding a row in the Config sheet — no code edits',
   'Run: 🎨 Heat Map → Apply / Refresh Heat Map',
   'A ⚠ note on a Col C metric cell means that name was not found in the Config sheet',
   'Clear ⚠ notes anytime via 🎨 Heat Map → Clear All Validation Notes'
  ].forEach(function(c,i){ s(sh.getRange(r,1,1,8).merge(),i%2===0?WH:LG,NV,false,9,true).setValue("☐  "+c); rh(r,24); r++; });

  sh.setColumnWidth(1,150); sh.setColumnWidth(2,420); sh.setFrozenRows(2);
  SpreadsheetApp.getUi().alert('✅ Helper sheet created: "' + GUIDE_SHEET_NAME + '"');
}


// ════════════════════════════════════════════════════════════
//  MENU
// ════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎨 Heat Map")
    .addItem("Apply to Selection",        "applyToSelection")
    .addItem("Apply / Refresh Heat Map",  "applyHeatMap")
    .addSeparator()
    .addItem("Create / Refresh Config Sheet", "createConfigSheet")
    .addItem("Create / Refresh Helper Sheet", "createHelperSheet")
    .addItem("Clear All Validation Notes", "clearAllNotes")
    .addToUi();
}
