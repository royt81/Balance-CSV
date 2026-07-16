# Balance CSV Reporter

Drag-and-drop a Billogram balance CSV (semicolon-delimited export) and get a
contract debt summary, a searchable transaction list, and an Excel export.
Formerly bundled with the Logger Helper extension; now a standalone web tool.

## Variants

| File | Purpose |
| --- | --- |
| `index.html` + `csv-balance-reporter.js` | The main multi-contract reporter. |
| `csv-balance-reporter-single.html` + `csv-balance-reporter-single.js` | Single-contract variant. |
| `csv-balance-reporter-standalone.html` | Generated single-file build (SheetJS inlined) for distribution outside the web. Rebuild by inlining `xlsx.full.min.js` into `index.html`. |
| `csv-balance-reporter.zip` / `csv-balance-reporter-standalone.zip` | Zipped distribution artifacts. |
| `xlsx.full.min.js` | SheetJS Community 0.20.3, used for the Excel export. |

## Hosting (GitHub Pages)

1. GitHub repo → Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
2. The tool is then served at `https://<user>.github.io/Balance-CSV/` (the single-contract variant at `.../csv-balance-reporter-single.html`).
3. Add that URL to the Logger via the Tools sidebar (edit → *+ Add tool*) or through the Logger Settings Tool JSON.

> Note: this tool expects our company's Billogram balance export format and
> will not work well with CSVs from other systems.
