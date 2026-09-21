# The Long Run

A client-side retirement projection calculator. Model Traditional/Roth/taxable/ESOP/HSA
accounts, salary growth, state and federal taxes, healthcare costs, rental real estate
income, Social Security claim-age optimization, and legacy/trust planning — all in the
browser, with a downloadable PDF report.

**Live site:** https://cambellhunziker.github.io/the-long-run/

## What it does

- Projects account balances from today through retirement and a full drawdown
  simulation to a chosen life expectancy.
- Toggle every figure (chart, tables, income lines) between **nominal (future) dollars**
  and **today's (real) dollars** — the toggle defaults to nominal.
- Recommends a Social Security claim age by comparing lifetime resource objectives
  across ages 62–70.
- Models employer match, leveraged-ESOP loan payoff timing, ESOP dilution/growth,
  and a trust/legacy spend-down phase.
- Choose a withdrawal strategy: proportional across accounts, or tax-optimized
  (taxable first, then Traditional/ESOP, then Roth last).
- Models HSA accumulation (IRS contribution limits, inflation-indexed) and compares
  it against a projected, editable average healthcare cost that grows with medical
  trend; any shortfall draws down other retirement income.
- Optional rental real estate income across three categories (apartments,
  condos/townhouses, single-family homes) feeds into retirement cash flow.
- Federal plus a flat, editable state income tax rate.
- Exports a full PDF report of the scenario, directly in the browser — no server,
  no data collection.

## Files

- `index.html` — the calculator itself. Fully self-contained (HTML/CSS/JS in one file);
  the only external dependencies are Chart.js and jsPDF, loaded from cdnjs.
- `calc-engine.js` — the underlying financial projection engine, as a Node module.
  This is the source of truth for the math; the logic embedded in `index.html`
  mirrors it exactly (verified by a parity test).
- `test-calc.js` — unit tests for `calc-engine.js`.

## Running the tests

```
node test-calc.js
```

## Privacy

Everything runs client-side in your browser. No inputs, results, or PDFs are sent
anywhere.
