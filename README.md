# UpFront Trading Strategy Analyzer

React/Vite single-stock strategy research app with deterministic backtesting and OpenAI commentary.

See the [Data Dictionary and Methodology Guide](docs/data-dictionary.md) for field definitions, timeframe and execution rules, metric formulas, validation terminology, export contents, and known discrepancies.

## Development and verification

Use Node 22.14 or later. Install with `npm ci`, then run `npm test` and `npm run build` (includes TypeScript checks).

`npm run dev` starts the frontend. For the complete app, use the Netlify CLI's `netlify dev` so the same-site functions are available. Keep secrets in Netlify or an ignored local environment file. Never use `VITE_` variables for provider credentials.

## UI styling

Tailwind CSS is compiled at build time (`tailwind.config.js`, `postcss.config.js`) and imported once from `src/index.css` by `src/index.tsx`. The deployed bundle carries its own CSS; no runtime CDN is involved.

- Dark mode is the default for new visitors, regardless of system preference. A saved light/dark selection takes precedence. The `dark` class on `<html>` (`darkMode: 'class'`) controls styling; `index.html` applies the choice before first paint and `App.tsx` owns the toggle. Browser theme color follows the selection, and blocked storage falls back to dark mode.
- Chart text and chrome cannot use utility classes. `src/theme.ts` exposes `useDarkMode()`, `chartColors(dark)` and `chartFont()` for Recharts props and the canvas heatmap. Use them instead of new hardcoded hex values so both themes stay legible.
- Cross-cutting styles live in `src/index.css`: scrollbars, `color-scheme`, the keyboard focus ring, and the `animate-fade-in` step transition.
- Layout and formatting are inline utility classes. The surfaces that matter are `src/App.tsx` (shell, stepper, metric cards, step panels), `src/components/StrategyControls.tsx`, `src/components/Charts.tsx`, `src/components/HoldoutValidation.tsx`, `src/components/AnalysisChat.tsx`, and `src/components/Icons.tsx`.

`npm run build` type-checks but cannot show the result, so review style changes in both themes on a Netlify Deploy Preview before promoting them.

## Netlify configuration

The existing site is `analyzerstocks`, site ID `600de90d-6315-435d-9ec3-b11b0bb39762`.

Build: `npm run build`; publish: `dist`; functions: `netlify/functions`. These settings are declared in `netlify.toml`.

Configure these variables with **Functions** scope for **Deploy Previews**, then Production when releasing:

- `FMP_API_KEY`: a valid Financial Modeling Prep credential with access to the historical-price-full endpoint.
- `OPENAI_API_KEY`: an OpenAI API project credential.
- `OPENAI_MODEL`: `gpt-6-luna` (the requested model and default when unset). An explicitly configured value is never silently replaced.

Environment changes require a new deploy. A missing key returns a controlled unavailable message; it does not fall back to browser credentials. Rotate the previously exposed FMP credential through the provider and remove obsolete Gemini credentials after migration. This change removes the literal key from current source, not Git history.

Netlify Functions enforce per-IP/domain limits (market data: 20 requests/minute; AI: 5/minute). Configure an OpenAI project budget/usage policy as appropriate; these per-IP limits are not a global spending cap. Public endpoints do not authenticate users. AI responses are requested with `store: false`; that disables response retrieval storage, not all provider retention. Chat history lives only in the current page and is cleared when the run changes or the page reloads.

## Simulation contract

- $10,000 initial capital; one long position; no leverage or shorting. Indicator periods count selected-timeframe bars.
- Signals are evaluated at bar close; entries and reversal exits execute at the next open. RSI uses Wilder smoothing (flat series = 50); MACD uses SMA-seeded EMAs; Bollinger Bands use population deviation; ATR is Wilder-smoothed over 14 bars.
- Reversal entry requires at least one enabled reversal condition and no opposing reversal condition. Momentum entry can override a reversal sell. Buys must pass an enabled trend filter. This preserves the existing strategy's signal composition.
- Hard stop and take-profit are anchored to entry ATR. Trailing stops use prior-bar information and never loosen, whether close-based or high-water-mark based.
- Entry-bar stops/targets apply. Known opening gaps fill at the open; if both stop and target are touched later in a bar, stop wins. No entry after an exit on the same bar. Final liquidation includes slippage and fees.
- Risk sizing budgets estimated round-trip commissions and stop slippage; gaps can exceed intended risk. Fractional-share choice is preserved.
- Equity includes the initial cash point and final liquidation costs. Drawdown uses closing equity, not intrabar lows. Exposure counts bars with any holding, divided by execution bars. Sharpe assumes a zero risk-free rate; Sortino uses zero-target downside deviation across all returns.
- Buy and hold is price-only over the full sample with no transaction costs. Dividends are excluded. FMP price adjustment/corporate actions are not independently verified. Latest weekly/monthly aggregate can be incomplete. The reported interval includes indicator warm-up.
- Optimization is in-sample, requires at least five completed trades, skips invalid/insufficient-history candidates, and returns no winner when none qualify. It does not prove improvement on unseen data.
- A completed run owns a copy of its symbol, timeframe, parameters, dates, results, and assumptions. Editing configuration invalidates results and chat. AI receives the complete settings, trade ledger, equity series, benchmark metrics and limitations; it cannot execute trades or rerun a strategy.

## Preview acceptance

1. Load AAPL; run daily defaults; inspect fills and exports.
2. Change a parameter or timeframe: old results and chat must disappear.
3. Choose monthly defaults: history warning must explain the 200-month filter and block an invalid run.
4. Run optimization with no eligible candidates: show an explanation, not a crash. Check a 1D heatmap and apply a valid winner.
5. Generate AI analysis, ask a follow-up, stop generation, and retry. Confirm it describes active settings and treats suggestions as hypotheses.
6. Verify deployed assets contain no API credentials; confirm both functions deployed and provider errors are sanitized.

Do not promote until the preview passes and production function variables are configured. If a released change needs reversal, revert the commit and deploy that correction.

## Chronological holdout validation

Validation is integrated into the existing five-tab workflow. The existing strategy controls,
backtest cards/charts/AI, and optimization grid are shared; there is no second setup form.

1. **Market Analysis:** load data, optionally enable **Reserve data for validation**, and set
   the split, fixed development warm-up budget, and prior-exposure declaration. The suggested
   split is 60%/40% of the loaded calendar range, not a sufficiency guarantee. Loading stays on
   this screen so the reservation can be chosen before continuing. The live overview chart
   is hidden while reservation is enabled; earlier chart viewing cannot be undone.
2. **Strategy Setup:** configure parameters and timeframe as before. Changing timeframe resets
   the default warm-up budget and recalculates the split; dates/bars are shown in the summary.
3. **Backtest & AI:** run the current setup. With reservation enabled, only development data
   is used for metrics, charts, signals, and AI. Warm-up initializes indicators but is excluded
   from performance. Continue straight to Validation or optionally optimize first.
4. **Optimization (optional):** search development data only when reserved, using fixed scoring
   dates. Candidates exceeding the warm-up budget are skipped. Five trades is an eligibility
   rule, not proof of reliability. Searches, objectives, ranges, and trial counts are retained.
   Apply the chosen parameters to Strategy Setup and rerun Backtest before locking them.
5. **Validation:** review the current strategy, lock it, then explicitly **Run Validation**.
   Each period starts independently with $10,000 cash. The preceding completed bar may generate
   a signal filled at the first scoring open. Compare results/benchmarks and export JSON/CSV.
   Optional AI review receives evaluation evidence plus development summary, only on request.

Without reservation, the existing full-history backtest and optimization remain available and
are labeled **Full history**. Invalid reservation settings block runs instead of falling back
to full history. Changing parameters, periods, data, or starting a new experiment invalidates
the current lock/results; tab navigation alone preserves them. Saved evaluations and exposure
records persist locally. Revisiting the same dates is not a fresh unseen test.

### Boundaries and limitations

- All periods count selected-timeframe bars. Today is excluded. Without an exchange calendar,
  the first and last weekly/monthly aggregates are conservatively excluded, even if complete.
  The requested split aligns forward to the next available interval opening. The actual
  dates are displayed before continuing. No aggregate crosses the actual split.
- Open fills in validation use the first session of an interval. Intrabar stop/target dates
  use the last session because OHLC data cannot establish their actual intrabar timing.
  Equity and risk metrics remain sampled at the selected bar frequency, not daily for all modes.
- Both strategy and benchmark begin at the scoring window's first open. The benchmark uses
  fractional price-only buy-and-hold without fees or dividends. Strategy costs are included.
  Corporate-action adjustment is not independently verified. End-of-window liquidation costs
  are included. Turnover is gross traded notional divided by starting capital.
- Sparse-trade warnings use 20 completed trades as a caution threshold, not an acceptance test.
  Undefined ratios display N/A. Drawdown duration includes ongoing unrecovered drawdowns.
- Browser storage records exposures before evaluation and also records full-history exploration
  and development. Overlap checks ignore parameter, timeframe, and data-fingerprint changes.
  Existing research before this feature, other devices, cleared storage, and manual tampering
  cannot be detected. “First recorded here” never means certified unseen data. Default prior
  knowledge is unknown/retrospective. Storage errors are visible and exports remain available.
- The application downloads the full price history to the browser. Hiding evaluation results is
  a research-workflow safeguard, not a server-enforced data embargo. Records are local to the
  site origin/browser, including separate records for preview and production.
- Walk-forward portfolios, short selling, FRED, and daily valuation of weekly/monthly strategies
  are not part of this release. Changing an experiment starts a new setup; revealed dates stay
  in local exposure history. No automatic pass/fail claim is made from Sharpe or WFE thresholds.

Run `npm test` and `npm run build`. Holdout tests cover future-price perturbations,
fixed scoring windows, cash starts, cost reconciliation, warm-up, aggregation boundaries,
locked snapshots, benchmark alignment, local history/reuse, and mocked AI requests.
