/**
 * ============================================================
 *  Sam's Weekly – Heat Map Script v20
 * ============================================================
 *
 *  CHANGES IN v20 (vs v19)
 *  ───────────────────────
 *  1. NEW — System Uptime, Ranger Uptime and BT/MI are now
 *     TARGET metrics. They were previously coloured by the
 *     Relative Heatmap and so never reacted to a target value.
 *     They now read a numeric target from Col D (just like
 *     ppf / owt / r2r / uph) and are coloured green / yellow /
 *     red against it. Flag these rows "Target Heatmap" in Col A
 *     and put the target value in Col D.
 *
 *  2. CHANGE — The Relative Heatmap is now GREEN-ONLY.
 *     Previously it used a green ramp for "good" moves and a red
 *     ramp for "bad" moves. Direction no longer changes the
 *     colour. Every relative cell is shaded green and the
 *     INTENSITY of the green reflects how large the
 *     week-over-week change is — bigger change = darker green.
 *     This covers the no-target SKU-type metrics (# SKUs in the
 *     field, # units in the field, untouched units, cubic
 *     utilization, etc.).
 *
 *  3. CLEANUP — The three metrics promoted to Target (System
 *     Uptime, Ranger Uptime, BT/MI) were removed from the
 *     relative-metric table so the two configs reflect reality.
 *     The uptime "absolute zone" branch was removed from the
 *     relative path; any remaining uptime-group relative metric
 *     (e.g. Bot Availability) is now shaded by magnitude of
 *     change like every other relative metric.
 *
 *  RETAINED FROM v19
 *  ─────────────────
 *  • Non-destructive colouring (values & number formats untouched)
 *  • Per-row data-column list prevents cross-row contamination
 *  • Metric-label scan reads cols B–D only, never the data region
 *  • Batched writes, onEdit single-row processing, Apply to Selection
 *  • Validation notes for non-numeric values (toggle with VALIDATE)
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


// ── Target metric config ─────────────────────────────────────
// direction: "higher" = a higher value is better (green when ≥ target)
//            "lower"  = a lower value is better  (green when ≤ target)
// yellowPct: fraction past the target that still counts as "yellow"
//            before the cell turns red.
// System Uptime / Ranger Uptime / BT/MI added in v20.
var METRIC_CONFIG = {
  "ppf":           { direction: "higher", yellowPct: 0.20, decimals: 2 },
  "uph":           { direction: "higher", yellowPct: 0.10, decimals: 0 },
  "owt":           { direction: "lower",  yellowPct: 0.20, decimals: 1 },
  "r2r":           { direction: "lower",  yellowPct: 0.20, decimals: 1 },
  "system uptime": { direction: "higher", yellowPct: 0.02, decimals: 2 },
  "ranger uptime": { direction: "higher", yellowPct: 0.02, decimals: 2 },
  "bt/mi":         { direction: "higher", yellowPct: 0.20, decimals: 2 }
};

// Order matters: longer / more specific labels are matched first so a
// short key (e.g. "uph") can never partially match a longer label.
var TARGET_METRIC_KEYS = ["system uptime", "ranger uptime", "bt/mi", "r2r", "owt", "ppf", "uph"];


// ── Relative metric config ───────────────────────────────────
// The Relative Heatmap is GREEN-ONLY (v20): direction is no longer
// used for colour, only for legacy reference. "group" selects the
// threshold set that classifies the SIZE of the week-over-week change.
var NO_TARGET_CONFIG = {
  "bot availability":     { group: "uptime",   direction: "higher" },
  "throughput":           { group: "moderate", direction: "higher" },
  "order breaches":       { group: "volatile", direction: "lower"  },
  "hours operational":    { group: "stable",   direction: "higher" },
  "pps uph":              { group: "moderate", direction: "higher" },
  "rack presented":       { group: "stable",   direction: "higher" },
  "# skus in the field":  { group: "stable",   direction: "higher" },
  "# units in the field": { group: "stable",   direction: "higher" },
  "untouched units":      { group: "volatile", direction: "lower"  },
  "cubic utilization":    { group: "stable",   direction: "higher" },
  "totes":                { group: "stable",   direction: "higher" },
  "non-chemical racking": { group: "stable",   direction: "higher" },
  "chemical racking":     { group: "stable",   direction: "higher" },
  "ppf":                  { group: "moderate", direction: "higher" },
  "pps":                  { group: "moderate", direction: "higher" }
};

var GROUP_THRESHOLDS = {
  uptime:   [0.1,  0.5, 1,   2  ],   // uptime moves are tiny; small % steps
  stable:   [0.01, 2,   4,   6  ],
  moderate: [2,    8,   15,  25 ],
  volatile: [15,   40,  100, 250]
};


// ── Magnitude colour ramp (Relative Heatmap — GREEN ONLY) ────
// Intensity reflects the SIZE of the week-over-week change.
// Direction (up vs down) does NOT change the colour any more.
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
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════

function applyHeatMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function(sheet) {
    try {
      if (sheet.getType() !== SpreadsheetApp.SheetType.GRID) return;
      if (sheet.getName() === "⚙ Heat Map Guide") return;
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
  if (sheet.getName() === "⚙ Heat Map Guide") return;

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
    if (sheet.getName() === "⚙ Heat Map Guide") return;

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
    if (sheet.getName() === "⚙ Heat Map Guide") return;
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

  var metric = cleanStr_(sheet.getRange(row, METRIC_COL).getValue());
  var cfg = null;
  TARGET_METRIC_KEYS.forEach(function(k) {
    if (!cfg && metric.indexOf(k) !== -1) cfg = METRIC_CONFIG[k];
  });
  if (!cfg) return;

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
      if (VALIDATE && !isEmpty && !looksLikeLabel_(cleanStr_(raw), metric))
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
//  v20: every cell is shaded with the GREEN ramp. The shade depth
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

  var group = "moderate";  // default threshold set
  Object.keys(NO_TARGET_CONFIG).forEach(function(k) {
    if (metricLabel.indexOf(k) !== -1) {
      group = NO_TARGET_CONFIG[k].group;
    }
  });

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

// True when a non-numeric cell is actually a metric label / header that has
// bled into the data column range (e.g. a merged "Cubic Utilization" banner),
// rather than corrupt data. Such cells are left blank with NO validation note.
function looksLikeLabel_(text, rowLabel) {
  if (!text) return false;
  if (rowLabel && text === rowLabel) return true;          // matches this row's own label
  var keys = Object.keys(NO_TARGET_CONFIG);
  for (var i = 0; i < keys.length; i++) {
    if (text.indexOf(keys[i]) !== -1) return true;          // matches a known relative label
  }
  for (var j = 0; j < TARGET_METRIC_KEYS.length; j++) {
    if (text.indexOf(TARGET_METRIC_KEYS[j]) !== -1) return true;  // matches a known target label
  }
  return false;
}


// ════════════════════════════════════════════════════════════
//  HELPER SHEET  (rebuilt for v20)
// ════════════════════════════════════════════════════════════

function createHelperSheet() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var name = "⚙ Heat Map Guide";
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
  s(sh.getRange(r,1,1,8).merge(),NV,WH,false,9).setValue("How the script reads your sheet — v20"); rh(r,20); r++;

  // STEP 1
  rh(r,8); r++;
  sec(r,"STEP 1 — COLUMN DETECTION"); r++;
  s(sh.getRange(r,1,1,8).merge(),LG,NV,false,9,true).setValue('Every column from Col E onward is scanned. For each row, only columns that contain an actual numeric value are coloured — empty and label columns are skipped automatically. No markers are needed in Row 1 or Row 2.'); rh(r,40); r++;
  chdr(r,"Column","Result"); r++;
  row2(r,"Col E onward, numeric value in this row","✓  Coloured — background applied"); r++;
  row2(r,"Col E onward, empty / text value in this row","✗  Skipped (text values get a ⚠ note)",LG); r++;

  // STEP 2
  rh(r,8); r++;
  sec(r,"STEP 2 — ROW DETECTION (Column A)"); r++;
  chdr(r,"Column A","What happens"); r++;
  row2(r,'"Target Heatmap"','Green / yellow / red vs the numeric target in Col D. Metric is read from Col C: ppf, owt, r2r, uph, System Uptime, Ranger Uptime, BT/MI.'); r++;
  row2(r,'"Relative Heatmap"','GREEN ONLY. Shade intensity = magnitude of the week-over-week change (bigger change = darker green). Direction up/down does not change the colour. Metric label read from Col B/C/D.',LG); r++;
  row2(r,'(empty / other)','Row skipped entirely — safe for headers, blank rows, section titles.'); r++;

  // Target scale
  rh(r,8); r++;
  sec(r,"TARGET HEATMAP — Colour Scale"); r++;
  [["#C6EFCE","Target met or exceeded"],
   ["#FFFFCC","Within threshold (10% UPH / 20% PPF, OWT, R2R, BT/MI / 2% Uptime)"],
   ["#FFC7C7","Beyond threshold — below acceptable range"],
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
  sec(r,"RELATIVE METRIC THRESHOLD GROUPS"); r++;
  chdr(r,"Group","Metrics & Change Thresholds"); r++;
  [["Stable","SKUs in the Field, Units in the Field, Cubic Utilization, Totes, Rack Presented, Hours Operational, Racking\nAny change: light | >2%: mid | >4%: dark | >6%: darkest"],
   ["Moderate","Throughput, PPS UPH, PPF (no target), PPS\n≥2%: light | ≥8%: mid | ≥15%: dark | ≥25%: darkest"],
   ["Volatile","Order Breaches, Untouched Units\n≥15%: light | ≥40%: mid | ≥100%: dark | ≥250%: darkest"],
   ["Uptime","Bot Availability (relative)\n≥0.1%: light | ≥0.5%: mid | ≥1%: dark | ≥2%: darkest"]
  ].forEach(function(g,i){ s(sh.getRange(r,1),i%2===0?WH:LG,NV,true).setValue(g[0]); s(sh.getRange(r,2,1,7).merge(),i%2===0?WH:LG,NV,false,9,true).setValue(g[1]); rh(r,40); r++; });
  s(sh.getRange(r,1,1,8).merge(),LG,NV,false,9,true).setValue("Relative Heatmap is green-only — colour shows how MUCH a value changed week-over-week, not whether it rose or fell. System Uptime, Ranger Uptime and BT/MI now use the TARGET heatmap (Col D target)."); rh(r,30); r++;

  // Checklist
  rh(r,8); r++;
  sec(r,"QUICK SETUP CHECKLIST"); r++;
  ['Col A: "Target Heatmap" for rows with a numeric target in Col D',
   'Col A: "Relative Heatmap" for rows with no target (Throughput, Order Breaches, SKUs, etc.)',
   'Col C: metric name for Target rows (ppf / owt / r2r / uph / System Uptime / Ranger Uptime / BT/MI)',
   'Col D: numeric target value for Target rows',
   'Run: 🎨 Heat Map → Apply / Refresh Heat Map',
   'Spot fix: select rows → 🎨 Heat Map → Apply to Selection',
   'Cells with a ⚠ note hold a non-numeric value — fix the data',
   'Clear ⚠ notes anytime via 🎨 Heat Map → Clear All Validation Notes'
  ].forEach(function(c,i){ s(sh.getRange(r,1,1,8).merge(),i%2===0?WH:LG,NV,false,9,true).setValue("☐  "+c); rh(r,24); r++; });

  sh.setColumnWidth(1,140); sh.setColumnWidth(2,420); sh.setFrozenRows(2);
  SpreadsheetApp.getUi().alert('✅ Helper sheet created: "⚙ Heat Map Guide"');
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
    .addItem("Clear All Validation Notes", "clearAllNotes")
    .addItem("Create / Refresh Helper Sheet", "createHelperSheet")
    .addToUi();
}
