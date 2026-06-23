# Sam's Weekly – Heat Map Script

A Google Apps Script that colours a weekly-metrics Google Sheet with two kinds of heat map,
driven by a flag in **Column A** of each row.

## Setup

1. In your Google Sheet: **Extensions → Apps Script**.
2. Paste the contents of [`HeatMap.gs`](./HeatMap.gs) into the editor and save.
3. Reload the sheet. A **🎨 Heat Map** menu appears.
4. Run **🎨 Heat Map → Create / Refresh Config Sheet** once to build the editable metric table.
5. Use **🎨 Heat Map → Apply / Refresh Heat Map** to colour every sheet, or **Apply to Selection**
   for just the selected rows. Editing a data cell also re-colours that row automatically.

## Metrics are configured in a sheet, not in code

The metric list lives in an editable **`⚙ Heat Map Config`** sheet inside your spreadsheet — there
are no hardcoded metric names in the script. To add a metric tomorrow, just add a row; to rename or
remove one, edit/delete its row. The heat map reads the sheet on the next run.

| Config column | Meaning |
| ------------- | ------- |
| **Metric Name** | Matched against the metric label. Case-insensitive, extra spaces ignored, partial match, longest match wins. |
| **Type** | `Target` or `Relative`. |
| **Direction** | *(Target only)* `higher` = bigger is better, `lower` = smaller is better. |
| **Yellow Band %** | *(Target only)* how far past the target still shows yellow before red (e.g. `20`). |
| **Decimals** | *(Target only)* rounding applied before comparing to the target. |
| **Group** | *(Relative only)* `stable` / `moderate` / `volatile` / `uptime` — sets change-size thresholds. |

If the Config sheet doesn't exist, the script falls back to sensible built-in defaults. A
`Target Heatmap` row whose name isn't found is still coloured (defaulting to higher-is-better) and
its metric cell gets a ⚠ note, so a small typo never blanks the whole row.

## How rows are read

| Column | Meaning |
| ------ | ------- |
| **A** | `Target Heatmap` or `Relative Heatmap` — selects how the row is coloured. Anything else = skipped. |
| **C** | Metric name (Target rows only). |
| **D** | Numeric target value (Target rows only). |
| **E → last** | Weekly data. For each row, only columns holding a real number are coloured. |

## Target Heatmap

Green / yellow / red against the target in Column D. Which metrics are targets — and their
direction, yellow band and decimals — come from the Config sheet (defaults include `ppf`, `owt`,
`r2r`, `uph`, **System Uptime**, **Ranger Uptime**, **BT/MI**).

- `higher`-is-better: green when value ≥ target.
- `lower`-is-better: green when value ≤ target.
- Just past the target → yellow; further past → red.

## Relative Heatmap (green only)

For metrics with no target (e.g. *# SKUs in the Field*, *# Units in the Field*, *Untouched Units*,
*Cubic Utilization*). Every cell is shaded **green** — the **intensity** reflects how large the
week-over-week change was. Direction (up vs down) does **not** change the colour, only the
magnitude of the change does.

See **🎨 Heat Map → Create / Refresh Helper Sheet** inside the spreadsheet for the full colour
legend and threshold tables.
