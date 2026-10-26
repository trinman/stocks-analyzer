# UpFront Trading Strategy Analyzer

React/Vite single-stock strategy research app with deterministic backtesting and OpenAI commentary.

## Development and verification

Use Node 22.14 or later. Install with `npm ci`, then run `npm test` and `npm run build` (includes TypeScript checks).

`npm run dev` starts the frontend. For the complete app, use the Netlify CLI's `netlify dev` so the same-site functions are available. Keep secrets in Netlify or an ignored local environment file. Never use `VITE_` variables for provider credentials.

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
