/**
 * ============================================================
 *  Sam's Weekly – Heat Map Script v22
 * ============================================================
 *
 *  CHANGES IN v22 (vs v21)
 *  ───────────────────────
 *  1. ONE SHEET — The Config table and the Guide are merged into
 *     a single "⚙ Heat Map" sheet: the editable metric table sits
 *     at the top, followed by 10 blank rows for you to add your
 *     own metrics, and the (simplified) guide below that.
 *
 *  2. SAFER READING — A row only counts as a metric when its Type
 *     cell is exactly "Target" or "Relative". Blank rows and all
 *     the guide text underneath are ignored automatically, so you
 *     can just keep adding rows — no need to pre-reserve hundreds.
 *
 *  3. WORDING — The Direction column now reads "Higher is better"
 *     / "Lower is better". Default metric names are shown in their
 *     natural casing (PPF, OWT, R2R, UPH, BT/MI, …). Matching is
 *     still case-insensitive, space-tolerant and partial.
 *
 *  RETAINED
 *  ────────
 *  • Metrics are data-driven (defaults used only if the sheet is
 *    missing). Typo-tolerant, longest-match-wins lookup. Safe
 *    fallback colouring for unrecognised Target rows.
 *  • System Uptime / Ranger Uptime / BT/MI are Target metrics.
 *  • Relative Heatmap is GREEN-ONLY (shade = size of week-over-
 *    week change). Non-destructive, batched writes, onEdit.
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

var SETUP_SHEET_NAME = "⚙ Heat Map";          // the one combined Config + Guide sheet
var LEGACY_SHEETS    = ["⚙ Heat Map Guide", "⚙ Heat Map Config"];  // skipped if they still exist
var CONFIG_DATA_ROW  = 3;                      // first metric row on the setup sheet
var BLANK_ROWS       = 10;                     // empty metric rows for you to fill in


// ── Built-in DEFAULT metric tables ───────────────────────────
// These are ONLY used when the "⚙ Heat Map" sheet does not exist
// yet. Once it is created you edit the sheet, not this code.
//
// direction: "higher" = a higher value is better
//            "lower"  = a lower value is better
// yellowPct  = fraction past the target still counted as "yellow"
var DEFAULT_TARGET_METRICS = [
  { name: "PPF",           direction: "higher", yellowPct: 0.20, decimals: 2 },
  { name: "UPH",           direction: "higher", yellowPct: 0.10, decimals: 0 },
  { name: "OWT",           direction: "lower",  yellowPct: 0.20, decimals: 1 },
  { name: "R2R",           direction: "lower",  yellowPct: 0.20, decimals: 1 },
  { name: "System Uptime", direction: "higher", yellowPct: 0.02, decimals: 2 },
  { name: "Ranger Uptime", direction: "higher", yellowPct: 0.02, decimals: 2 },
  { name: "BT/MI",         direction: "higher", yellowPct: 0.20, decimals: 2 }
];

// "group" selects the change-size threshold set (see GROUP_THRESHOLDS).
var DEFAULT_RELATIVE_METRICS = [
  { name: "Bot Availability",     group: "uptime"   },
  { name: "Throughput",           group: "moderate" },
  { name: "Order Breaches",       group: "volatile" },
  { name: "Hours Operational",    group: "stable"   },
  { name: "PPS UPH",              group: "moderate" },
  { name: "Rack Presented",       group: "stable"   },
  { name: "# SKUs in the Field",  group: "stable"   },
  { name: "# Units in the Field", group: "stable"   },
  { name: "Untouched Units",      group: "volatile" },
  { name: "Cubic Utilization",    group: "stable"   },
  { name: "Totes",                group: "stable"   },
  { name: "Non-Chemical Racking", group: "stable"   },
  { name: "Chemical Racking",     group: "stable"   },
  { name: "PPS",                  group: "moderate" }
];

// Fallbacks used when a row's metric name matches no config entry.
var TARGET_DEFAULT         = { direction: "higher", yellowPct: 0.20, decimals: 2 };
var RELATIVE_DEFAULT_GROUP = "moderate";

var GROUP_THRESHOLDS = {
  uptime:   [0.1,  0.5, 1,   2  ],   // uptime moves are tiny; small % steps
  stable:   [0.01, 2,   4,   6  ],
  moderate: [2,    8,   15,  25 ],
  volatile: [15,   40,  100, 250]
};


// ── Magnitude colour ramp (Relative Heatmap — GREEN ONLY) ────
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
//  Reads the "⚙ Heat Map" sheet once per execution and caches it.
//  Only rows whose Type is exactly Target/Relative are read, so
//  blank rows and the guide section below are ignored. Falls back
//  to built-in defaults if the sheet is absent / has no metrics.
// ════════════════════════════════════════════════════════════

var _CFG_CACHE = null;   // reset automatically on each script execution

function getConfig_() {
  if (_CFG_CACHE) return _CFG_CACHE;

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETUP_SHEET_NAME);
  var target = [], relative = [];

  if (sh) {
    var lastRow = sh.getLastRow();
    if (lastRow >= CONFIG_DATA_ROW) {
      var rows = sh.getRange(CONFIG_DATA_ROW, 1, lastRow - CONFIG_DATA_ROW + 1, 6).getValues();
      rows.forEach(function(rw) {
        var name = collapseWs_(rw[0]);          // A: metric name (match text)
        var type = collapseWs_(rw[1]);          // B: Type (must be exactly target/relative)
        if (!name) return;
        if (type === "relative") {
          var grp = collapseWs_(rw[5]) || RELATIVE_DEFAULT_GROUP;  // F: group
          if (!GROUP_THRESHOLDS[grp]) grp = RELATIVE_DEFAULT_GROUP;
          relative.push({ name: name, group: grp });
        } else if (type === "target") {
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
        // any other Type (blank, guide text, etc.) is ignored
      });
    }
  }

  // No setup sheet, or it exists but holds no usable rows → defaults.
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


// ════════════════════════════════════════════════════════════
//  COLUMN RANGE
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

  // Metric config is looked up from the setup sheet (typo-tolerant). If the
  // name matches nothing we still colour the row with a safe default so a
  // small label change never blanks the whole row.
  var metricNorm = collapseWs_(sheet.getRange(row, METRIC_COL).getValue());
  var cfg = resolveTargetCfg_(metricNorm);
  var usedFallback = false;
  if (!cfg) { cfg = TARGET_DEFAULT; usedFallback = true; }

  if (VALIDATE) {
    if (usedFallback && metricNorm)
      sheet.getRange(row, METRIC_COL).setNote(
        "⚠ Not found in the “" + SETUP_SHEET_NAME + "” sheet. Coloured with the default " +
        "(higher-is-better). Add this name there to control its direction / thresholds.");
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

  rowRange.setBackground(null);
  rowRange.setFontColor(null);
  rowRange.setBackgrounds(bgs);
  rowRange.setFontColors(fcs);
  rowRange.setNotes(notes);
}


// ════════════════════════════════════════════════════════════
//  RELATIVE HEATMAP ROW  (batched, non-destructive, GREEN-ONLY)
// ════════════════════════════════════════════════════════════

function processRelativeRow_(sheet, row, allCols) {
  if (!allCols || allCols.length === 0) return;

  // Metric label: rightmost non-empty text in cols B–D.
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

    // Prior week: scan left through dataColsThisRow ONLY.
    var prevNorm = null;
    for (var pi = di - 1; pi >= 0; pi--) {
      var pd = colData[dataColsThisRow[pi]];
      if (pd && pd.num !== null) { prevNorm = pd.normNum; break; }
    }

    var bgIndex   = 0;  // 0 = no change; higher = bigger change
    var hasChange = (prevNorm !== null && prevNorm !== 0 && d.normNum !== prevNorm);

    if (hasChange) {
      var changePct = Math.abs((d.normNum - prevNorm) / prevNorm) * 100;
      bgIndex = changeToBgIndex_(changePct, group);
    }

    var bgRgb = GREEN_RAMP[bgIndex];
    bgs[0][idx] = rgbToHex_(bgRgb.r, bgRgb.g, bgRgb.b);
    fcs[0][idx] = readableTextColor_(bgRgb.r, bgRgb.g, bgRgb.b);
  }

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
  if (n === SETUP_SHEET_NAME) return true;
  return LEGACY_SHEETS.indexOf(n) !== -1;
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

// True when a non-numeric cell is actually a metric label / header bleeding
// into the data range, rather than corrupt data. Left blank with NO note.
function looksLikeLabel_(text, rowLabel) {
  if (!text) return false;
  var t = collapseWs_(text);
  if (rowLabel && t === collapseWs_(rowLabel)) return true;
  var cfg = getConfig_();
  for (var i = 0; i < cfg.relative.length; i++)
    if (cfg.relative[i].nameNorm && t.indexOf(cfg.relative[i].nameNorm) !== -1) return true;
  for (var j = 0; j < cfg.target.length; j++)
    if (cfg.target[j].nameNorm && t.indexOf(cfg.target[j].nameNorm) !== -1) return true;
  return false;
}


// ════════════════════════════════════════════════════════════
//  SETUP SHEET  (Config table on top + Guide below, in one sheet)
// ════════════════════════════════════════════════════════════

function createHeatMapSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var ex = ss.getSheetByName(SETUP_SHEET_NAME);
  if (ex) {
    var resp = ui.alert("Rebuild the Heat Map sheet?",
      'This RESETS "' + SETUP_SHEET_NAME + '" (your metric list AND the guide) back to ' +
      'defaults and discards any edits. Continue?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ss.deleteSheet(ex);
  }
  var sh = ss.insertSheet(SETUP_SHEET_NAME, 0);

  var OG = "#FF8400", NV = "#232359", LG = "#F5F5F5", WH = "#FFFFFF", FY = "#FFF7E6";

  function rh(r,h){ sh.setRowHeight(r, h||22); }
  function fullBar(r, text, bg, fg, sz) {
    sh.getRange(r,1,1,8).merge().setValue(text)
      .setBackground(bg).setFontColor(fg).setFontWeight("bold").setFontSize(sz||10)
      .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
  }
  function fullText(r, text, bg) {
    sh.getRange(r,1,1,8).merge().setValue(text)
      .setBackground(bg||WH).setFontColor(NV).setFontSize(9)
      .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
  }
  function pair(r, a, b, bg) {
    var x = bg || WH;
    sh.getRange(r,1,1,2).merge().setValue(a)
      .setBackground(x).setFontColor(NV).setFontWeight("bold").setFontSize(9)
      .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
    sh.getRange(r,3,1,6).merge().setValue(b)
      .setBackground(x).setFontColor(NV).setFontSize(9)
      .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
    rh(r,28);
  }
  function swatch(r, hex, label, zebra) {
    sh.getRange(r,1,1,2).merge().setBackground(hex);
    sh.getRange(r,3,1,6).merge().setValue(label)
      .setBackground(zebra?LG:WH).setFontColor(NV).setFontSize(9)
      .setFontFamily("Arial").setVerticalAlignment("middle");
    rh(r,22);
  }

  var r = 1;

  // ── Title ──
  fullBar(r, "⚙  Heat Map — Metrics & Guide", OG, WH, 13); rh(r,34); r++;

  // ── Config header (row 2 = CONFIG_DATA_ROW - 1) ──
  sh.getRange(r,1,1,6).setValues([[
    "Metric Name", "Type", "Direction", "Yellow Band %", "Decimals", "Group"
  ]]).setBackground(NV).setFontColor(WH).setFontWeight("bold").setFontSize(9)
     .setFontFamily("Arial").setVerticalAlignment("middle").setWrap(true);
  rh(r,30); r++;   // now r === CONFIG_DATA_ROW (3)

  // ── Default metric rows ──
  var metricStart = r;
  var data = [];
  DEFAULT_TARGET_METRICS.forEach(function(m){
    data.push([ m.name, "Target",
                m.direction === "lower" ? "Lower is better" : "Higher is better",
                Math.round(m.yellowPct * 100), m.decimals, "" ]);
  });
  DEFAULT_RELATIVE_METRICS.forEach(function(m){
    data.push([ m.name, "Relative", "", "", "", m.group ]);
  });
  sh.getRange(metricStart, 1, data.length, 6).setValues(data)
    .setFontFamily("Arial").setFontSize(9).setVerticalAlignment("middle");
  for (var i = 0; i < data.length; i++) {
    if (i % 2 === 1) sh.getRange(metricStart + i, 1, 1, 6).setBackground(LG);
  }
  r = metricStart + data.length;

  // ── Blank rows for the user to add their own metrics ──
  var blankStart = r;
  sh.getRange(blankStart, 1, BLANK_ROWS, 6).setBackground(FY);
  for (var k = 0; k < BLANK_ROWS; k++) rh(blankStart + k, 22);
  r = blankStart + BLANK_ROWS;

  // ── Dropdowns over the metric rows + the blank rows ──
  var ddEnd = r - 1;
  function dropdown(col, values) {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(values, true).setAllowInvalid(true).build();
    sh.getRange(metricStart, col, ddEnd - metricStart + 1, 1).setDataValidation(rule);
  }
  dropdown(2, ["Target", "Relative"]);
  dropdown(3, ["Higher is better", "Lower is better"]);
  dropdown(6, ["stable", "moderate", "volatile", "uptime"]);

  // ── Spacer, then the GUIDE ──
  rh(r, 10); r++;

  fullBar(r, "📘  GUIDE — how the heat map works", NV, WH, 11); rh(r,26); r++;

  fullText(r, "① Edit the metric table at the top of this sheet (add a row in the shaded blank "
    + "area to add a metric).   ② In each of your data sheets, put “Target Heatmap” or “Relative "
    + "Heatmap” in Column A of every metric row.   ③ Run 🎨 Heat Map → Apply / Refresh Heat Map.", LG);
  rh(r,46); r++;

  fullBar(r, "WHAT GOES IN COLUMN A OF YOUR DATA SHEET", OG, WH, 10); rh(r,22); r++;
  pair(r, "Target Heatmap", "Coloured against the target in Col D. Green = at/over target, yellow = "
    + "just off, red = well off. Metric name is read from Col C.", WH); r++;
  pair(r, "Relative Heatmap", "GREEN ONLY. Darker green = a bigger change from last week. Whether it "
    + "went up or down does NOT change the colour.", LG); r++;
  pair(r, "(blank / anything else)", "Row is ignored — safe for titles, totals and spacer rows.", WH); r++;

  fullBar(r, "TARGET COLOURS", OG, WH, 10); rh(r,22); r++;
  swatch(r, "#C6EFCE", "Met or beat the target", false); r++;
  swatch(r, "#FFFFCC", "Just inside the Yellow Band you set", true); r++;
  swatch(r, "#FFC7C7", "Outside the band — needs attention", false); r++;
  swatch(r, "#8B0000", "Far from target (white text)", true); r++;

  fullBar(r, "RELATIVE COLOURS (green only)", OG, WH, 10); rh(r,22); r++;
  swatch(r, "#F2F2F2", "No change from last week", false); r++;
  swatch(r, "#E8F5E8", "Tiny change", true); r++;
  swatch(r, "#C8E6C8", "Small change", false); r++;
  swatch(r, "#A8D4A8", "Moderate change", true); r++;
  swatch(r, "#7BB87B", "Large change", false); r++;

  fullBar(r, "THE “GROUP” COLUMN (relative metrics only)", OG, WH, 10); rh(r,22); r++;
  fullText(r, "Group sets how big a weekly change must be before the green darkens. Pick how "
    + "“jumpy” the metric normally is:", LG); rh(r,30); r++;
  pair(r, "Stable", "Barely moves week to week (SKUs, Units, Cubic Util). Even a ~2% change shows up.", WH); r++;
  pair(r, "Moderate", "Normal swings (Throughput, PPS). Needs roughly 8%+ to look big.", LG); r++;
  pair(r, "Volatile", "Swings a lot (Order Breaches, Untouched Units). Needs ~40%+ to look big.", WH); r++;
  pair(r, "Uptime", "Tiny moves matter (Bot Availability). Reacts at fractions of a percent.", LG); r++;

  fullBar(r, "WRITING METRIC NAMES", OG, WH, 10); rh(r,22); r++;
  fullText(r, "Type names the way they read in your sheet — e.g. PPF, OWT, R2R, UPH, BT/MI, "
    + "System Uptime. Matching ignores CAPS and extra spaces and matches partial text, so the exact "
    + "wording doesn’t need to be perfect. Direction: PPF / UPH / Uptime / BT/MI are “Higher is "
    + "better”; OWT and R2R are “Lower is better”.", WH); rh(r,52); r++;

  // ── Column widths & freeze ──
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 95);
  sh.setColumnWidth(3, 140);
  sh.setColumnWidth(4, 120);
  sh.setColumnWidth(5, 90);
  sh.setColumnWidth(6, 110);
  sh.setColumnWidth(7, 110);
  sh.setColumnWidth(8, 110);
  sh.setFrozenRows(2);

  ui.alert('✅ Created "' + SETUP_SHEET_NAME + '".\n\n'
    + 'Edit the metric table at the top (blank rows are highlighted), then run\n'
    + '🎨 Heat Map → Apply / Refresh Heat Map.');
}


// ════════════════════════════════════════════════════════════
//  MENU
// ════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎨 Heat Map")
    .addItem("Apply Heatmap Everywhere", "applyHeatMap")
    .addItem("Apply to Selected Cells",  "applyToSelection")
    .addSeparator()
    .addItem("Create Heatmap Config/Guide Sheet", "createHeatMapSheet")
    .addToUi();
}
