# Sam's Weekly – Heat Map Script

A Google Apps Script that colours a weekly-metrics Google Sheet with two kinds of heat map,
driven by a flag in **Column A** of each row.

## Setup

1. In your Google Sheet: **Extensions → Apps Script**.
2. Paste the contents of [`HeatMap.gs`](./HeatMap.gs) into the editor and save.
3. Reload the sheet. A **🎨 Heat Map** menu appears.
4. Run **🎨 Heat Map → Create / Refresh Heat Map Sheet** once to build the combined metric
   table + guide.
5. Use **🎨 Heat Map → Apply / Refresh Heat Map** to colour every sheet, or **Apply to Selection**
   for just the selected rows. Editing a data cell also re-colours that row automatically.

## Metrics are configured in a sheet, not in code

The metric list and the guide live together in one editable **`⚙ Heat Map`** sheet — there are no
hardcoded metric names in the script. The metric table is at the top, followed by highlighted blank
rows for adding your own metrics, with the guide below. To add a metric tomorrow, just fill in a
blank row (a row only counts once its **Type** is `Target` or `Relative`); the heat map reads the
sheet on the next run.

| Config column | Meaning |
| ------------- | ------- |
| **Metric Name** | Matched against the metric label. Case-insensitive, extra spaces ignored, partial match, longest match wins. Type names in their natural casing (PPF, OWT, BT/MI…). |
| **Type** | `Target` or `Relative`. |
| **Direction** | *(Target only)* `Higher is better` or `Lower is better`. |
| **Yellow Band %** | *(Target only)* how far past the target still shows yellow before red (e.g. `20`). |
| **Decimals** | *(Target only)* rounding applied before comparing to the target. |
| **Group** | *(Relative only)* `stable` / `moderate` / `volatile` / `uptime` — sets how big a weekly change must be before the green darkens. |

If the `⚙ Heat Map` sheet doesn't exist, the script falls back to sensible built-in defaults. A
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
direction, yellow band and decimals — come from the `⚙ Heat Map` sheet (defaults include `PPF`,
`OWT`, `R2R`, `UPH`, **System Uptime**, **Ranger Uptime**, **BT/MI**).

- *Higher is better*: green when value ≥ target.
- *Lower is better*: green when value ≤ target.
- Just past the target → yellow; further past → red.

## Relative Heatmap (green only)

For metrics with no target (e.g. *# SKUs in the Field*, *# Units in the Field*, *Untouched Units*,
*Cubic Utilization*). Every cell is shaded **green** — the **intensity** reflects how large the
week-over-week change was. Direction (up vs down) does **not** change the colour, only the
magnitude of the change does.

See the guide section at the bottom of the **`⚙ Heat Map`** sheet for the full colour legend and
group explanations.
