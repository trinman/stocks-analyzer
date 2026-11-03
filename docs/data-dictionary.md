# Data dictionary and methodology

**Version 1.1 · Reviewed November 3, 2026**

Describes the implementation at [commit `15c401f`](https://github.com/trinman/stocks-analyzer/tree/15c401fa0014a965cc0dd2b9f9c66123b4ed940d), including PR #6. This is a reference for users and the data audit, not a certification of market-data quality or trading performance. Update this document when the behavior changes.

- **Implemented:** checked against the source code at that commit.
- **Verification pending:** behavior outside the code still needs independent evidence.
- **Known discrepancy:** the implementation and a label or intended calculation differ. These are documented below, not corrected by this document.

## 1. Read this first

**The provider request window is approximately five years.** This constrains every workflow: roughly 1,250 daily bars before warm-up (an estimate, not guaranteed coverage), and too little history for a 200-month filter (about 16.7 years). “Full history” means the supplied window, not the stock’s lifetime history. The requested window moves with the request date; caching, missing coverage and revisions can change the returned observations.

The analyzer simulates one stock, one long position at a time, starting with **$10,000**. It does not execute real trades. Daily, weekly, and monthly select the **bar size**, not a required holding period. A position may remain open for several bars.

| Workflow | Data used | What the result means |
| --- | --- | --- |
| Full history | All supplied bars after aggregation | Exploratory historical performance, including warm-up time. It is not an unseen test. |
| Development period only | Earlier bars, with a fixed warm-up budget excluded from performance | Data available for choosing parameters, running backtests, and optional optimization. |
| Reserved evaluation | Later bars, revealed after locking the strategy | A single chronological holdout. Previously viewed or reused dates are not made unseen by reserving them. |

**Interpretation limits:** full-history comparison includes cash-only strategy warm-up against an invested benchmark (§4); provider split/dividend adjustment remains unverified, and an unadjusted split can create a false loss (§7). The export alone cannot reproduce a run (§6).

The five tabs are **Market Analysis → Strategy Setup → Backtest & AI → Optimization → Validation**. Optimization is optional. The same strategy controls serve both full-history and reserved-period work.

## 2. Market data and dates

| Field or term | Implementation and units | Limitation / status |
| --- | --- | --- |
| Symbol | Uppercase ticker, checked in browser and server against `^[A-Z0-9][A-Z0-9.\-^]{0,14}$`; encoded before the provider request. | A valid format does not guarantee provider coverage. |
| Provider | FMP through the server-side `market-data` function; `/api/v3/historical-price-full/{symbol}` with a `from` date five calendar years before the request. | Exact endpoint adjustment semantics and account coverage: **verification pending**. No alternative endpoint fallback. |
| `dates` | Provider dates, sorted ascending, `YYYY-MM-DD`. For an aggregate, the final supplied session date. | Dates contain no execution time or exchange-timezone metadata. |
| `o`, `h`, `l`, `c` | Provider `open`, `high`, `low`, `close`; positive finite price values. | Used directly. `adjClose` is not selected. The app displays dollar amounts but does not validate instrument currency or convert currencies. |
| `v` | Provider `volume`; finite, nonnegative values. Aggregate volume is the sum. | Zero volume is accepted; volume does not constrain trade size or fills. |
| `openDates` | First supplied session in each validation aggregate; same as `dates` for daily validation bars. | Added locally for validation; not provided by the full-history aggregation function. |
| Price adjustment | Both the strategy and benchmark consume the same dataset. No separate raw-versus-adjusted series is selected for either. | Consistent split/dividend adjustment across all OHLC fields: **verification pending**. No per-symbol adjustment flag. |
| Dividends / total return | The engine adds no dividend cash flows and performs no dividend reinvestment. | “Price-only” describes the calculation. It does not independently establish what adjustments the provider has embedded. No total-return toggle. |
| Data validation | 2–10,000 bars; equal array lengths; valid unique ascending dates; positive prices; nonnegative volume; consistent OHLC bounds. | Zero-encoded missing prices are rejected, not filled. No exchange-calendar reconciliation, missing-session repair, split detection, or corporate-action audit. |
| Freshness | Successful function responses specify a five-minute browser cache and one-hour Netlify CDN cache. | No provider revision ID or last-updated field is preserved. Reloading may return cached data. |
| Overview chart | TradingView iframe in Market Analysis when reservation is off. | This is not the FMP dataset used by the engine; visual agreement is not a data reconciliation. Viewing the chart may expose later prices. |

### Bar aggregation and incomplete periods

Weekly groups use a Sunday-based UTC calendar week; monthly groups use UTC calendar months. Each aggregate takes the first open, maximum high, minimum low, final close, and summed volume of the supplied daily rows. Holidays are not filled with fabricated bars.

| Rule | Full history | Development and reserved evaluation |
| --- | --- | --- |
| Today's daily row | Included if the provider supplies it. | Dates on or after `asOf` are removed. `asOf` is the UTC date captured when the app mounts. |
| First/last weekly or monthly aggregate | Retained; may be incomplete. | The first and last aggregates of the entire prepared dataset are discarded before splitting, even if actually complete. These are the outer development/evaluation edges, not an extra discard at each side of the middle boundary. |
| Split inside an aggregate | No split. | Evaluation starts at the first aggregate opening on or after the requested split. That complete aggregate belongs to evaluation. |
| Valuation | Selected-bar closes. | Selected-bar closes; not daily valuation for weekly/monthly strategies. |

A weekly or monthly signal uses the completed aggregate close and can execute at the **next aggregate open**. It is not a rule to buy at Friday or month-end close. Stops and targets use the aggregate's high/low; their precise intrabar timing is unknown.

Sources: [market-data function](../netlify/functions/market-data.mts), [aggregation](../src/services/apiServices.ts), [input validation](../src/services/validation.ts), [holdout preparation](../src/services/holdoutService.ts).

## 3. Strategy parameters and signal rules

Defaults are starting settings, not recommendations or optimized values. All lookback periods count selected-timeframe bars. A 200-period monthly filter requires 200 monthly observations plus execution history; five years is insufficient.

| UI term / stored field | Default | Meaning |
| --- | --- | --- |
| Use BB / `useBB` | On | Enable Bollinger reversal conditions. |
| BB Period / `bbPeriod`; Std Dev / `bbStd` | 20; 2 | Closing-price SMA ± multiplier × population standard deviation. |
| Use RSI / `useRSI` | On | Enable RSI reversal conditions. |
| RSI Period / `rsiPeriod` | 14 | Wilder-smoothed gains/losses; also used by momentum entry even when Use RSI is off. |
| Oversold / `rsiOversold`; Overbought / `rsiOverbought` | 30; 70 | Buy condition at or below oversold; sell condition at or above overbought. |
| Use MACD / `useMACD` | On | Enable MACD crossover reversal conditions. |
| MACD Fast / `macdFast`; Slow / `macdSlow`; Signal / `macdSignal` | 12; 26; 9 | SMA-seeded EMAs; MACD is fast minus slow EMA, with an EMA signal line. |
| Trend Filter / `useTrendFilter`; Period / `trendFilterPeriod` | On; 200 | Reject buys below the closing-price SMA; equality passes. Does not independently trigger an exit. |
| Momentum Entry / `useMomentumEntry`; SMA Period / `momentumSMAPeriod` | On; 50 | Buy condition requires close strictly above this SMA and RSI strictly above 50. |
| Risk/Trade / `riskPct` | 1% | Target estimated loss budget based on current cash, not a fixed allocation percentage or guaranteed loss cap. |
| Stop Loss / `stopATR` | 2 × ATR | Distance below the slippage-adjusted entry price; ATR is taken from the preceding bar at entry. |
| Take Profit / `useTakeProfit`; `takeProfitATR` | On; 1.5 × ATR | Target above entry, using that same entry ATR. |
| Trailing Stop / `useTrailingStop`; `trailingATRMultiplier` | Off; 3 × ATR | Adds a stop that can tighten but cannot loosen. |
| Trailing mode / `trailingStopActivation` | `ratchet` | High-water mode uses the running prior-bar high (initialized at entry); `immediate` uses the prior close. Both update using prior-bar ATR and preserve the highest stop so far. |
| Slippage / `slipBps` | 5 basis points per side | Adverse price adjustment: buy × `(1 + bps/10000)`, sell × `(1 - bps/10000)`. One basis point is 0.01%. |
| Commission / `commission` | $0.50 per order | Charged once on entry and once on exit. Not a per-share fee or minimum-fee schedule. |
| Fractional Shares / `allowFractionalShares` | Off | Share quantity is rounded down to a whole number unless enabled. |

ATR always uses 14 bars and Wilder smoothing. SMA and Bollinger values are unavailable until their full lookback exists. RSI needs its lookback of price changes; a flat series yields 50, gains without losses yield 100. MACD waits for seeded EMAs and its signal line; crossover checks also need prior values. Signals wait for ATR and all enabled features to have usable data. Disabled fields still undergo parameter validation.

### Signal precedence

For each eligible bar, the engine counts enabled reversal conditions:

- Bollinger: close ≤ lower band is buy; close ≥ upper band is sell.
- RSI: RSI ≤ oversold is buy; RSI ≥ overbought is sell.
- MACD: crossing from at/below to above its signal line is buy; crossing from at/above to below is sell.

| Condition | Signal |
| --- | --- |
| At least one reversal buy, no reversal sells | Buy candidate. |
| At least one reversal sell, no reversal buys | Sell candidate. |
| Opposing reversal conditions | Neither reversal candidate qualifies. |
| Momentum condition true | Buy candidate even with opposing reversal conditions. |
| Buy candidate below enabled trend SMA | Buy is rejected. |
| Buy survives trend filter | Emit buy; it takes precedence over a reversal sell. |
| No surviving buy, but a reversal sell qualifies | Emit sell. |
| Otherwise | No signal. |

**Incomplete-session caveat:** full history can use today’s partial daily row, or an incomplete weekly/monthly aggregate, to emit a signal. Its latest signal and simulated results can therefore change as the session/interval completes. Validation applies the exclusions in §2.

Signal prices are closing prices, **not execution prices**. A buy signal while already holding does not add to the position; a sell signal while flat does not open a short.

### Execution and position sizing

For each execution bar: update an existing trailing stop from prior-bar information; process a prior-bar reversal sell at the open; enter if flat and eligible; check opening gaps and intrabar stops/targets; liquidate at the final close if still holding; record closing equity.

A reversal exit is processed before stop/target checks on that bar. Otherwise, the code checks an opening stop gap before an opening target gap; this describes check order, not an ambiguous open through both normally ordered levels. If the bar touches both stop and target intrabar without a decisive opening gap, the stop wins. Entry-bar checks apply. No re-entry occurs after an exit on the same bar.

Sizing takes the smaller of risk-based shares and cash-affordable shares, reserving two commissions and estimated exit slippage. The sizing stop distance has a $0.01 floor; the actual hard stop uses `stopATR × entryATR` without that floor. There is no leverage, volume/market-impact model, partial-fill model, or guaranteed fill at a stop price through a gap.

Validation open fills are dated with `openDates`; intrabar exits use the interval's final date as a label. Full-history weekly/monthly trade dates use the final aggregate date even for opening fills. These are simulation records, not broker timestamps.

Sources: [defaults](../src/defaults.ts), [strategy controls](../src/components/StrategyControls.tsx), [indicators, signals and engine](../src/services/tradingService.ts).

## 4. Performance metrics

Percentages below are percentage points in stored fields: `5` means 5%, not 0.05. Let `E0 = 10000`, `Eend` be final equity, and `r` be successive equity returns as decimal fractions. Annualization uses **252 daily, 52 weekly, or 12 monthly bars**. These are fixed factors, not measured exchange-session counts.

CAGR measures elapsed calendar time using 365.25 days per year; Sharpe and Sortino use the fixed bar factors above. These annualization conventions are not identical, especially across partial or irregular intervals.

Full-history equity includes the initial cash point and all subsequent closes, including warm-up time. Scoped development/evaluation equity contains scoring closes only; the engine prepends initial cash internally when calculating returns, so the first scoring bar's return is included.

**Warm-up exposure asymmetry:** during warm-up the strategy holds cash while buy-and-hold is invested from the first supplied close. Full-history return differences include that asymmetry: a rise during warm-up favors the benchmark, and a fall favors the strategy. Development scoring excludes its fixed warm-up budget; evaluation uses earlier history to initialize indicators but starts independently in cash. Full-history and scoped results are therefore not interchangeable even with the same parameters.

| Display / stored field | Calculation and interpretation |
| --- | --- |
| Final Equity / `finalEquity` | Cash after final liquidation, slippage and commission. |
| Total or Net Return / `totalReturn` | `100 × (Eend / E0 - 1)`. |
| CAGR / `cagr` | `100 × ((Eend / E0)^(1/years) - 1)`; years are calendar elapsed days / 365.25. Scoped periods begin at their first scoring open date. |
| Sharpe / `sharpeRatio` | `mean(r) / populationStd(r) × sqrt(annualization)`; zero reference return. Not a probability of success. |
| Sortino / `sortinoRatio` | `mean(r) / sqrt(sum(min(r,0)^2) / count(r)) × sqrt(annualization)`; zero target. Uses the total-N denominator, not downside count. With the same numerator, dividing squared downside returns by only the negative-return count increases downside deviation and reduces the ratio’s magnitude; it does not increase a positive Sortino. |
| Maximum Drawdown / `maxDrawdown` | Largest percentage fall from running closing-equity peak; starts from $10,000 and includes final liquidation costs. Intrabar lows are not measured. |
| Longest Drawdown / `maxDrawdownDurationDays` | Maximum calendar days from a recorded peak to recovery or last underwater observation. Includes unrecovered drawdowns and the recovery date. |
| Calmar / `calmarRatio` | CAGR divided by maximum drawdown, both in percentage units. Included in the summary export, not the validation comparison table. |
| Completed Trades / `numTrades` | Completed entry/exit pairs, not the number of orders or signals. |
| Win Rate / `winRate` | Profitable pairs / all pairs × 100, after both commissions and price slippage. Breakeven pairs are classified with losses. |
| Profit Factor / `profitFactor` | Sum of profitable net trade P&L / absolute sum of nonpositive net trade P&L. |
| Average Win / `avgWin`; Average Loss / `avgLoss` | Mean net trade percentage return for each group; average loss is reported as a positive magnitude. Trade return divides net P&L by entry notional plus entry commission. |
| Exposure / Time in Market / `timeInMarketPct` | Bars carried into with a position **or** entered during, divided by execution bars, × 100. Entry and opening-exit bars both count. |
| Turnover / `turnoverPct` | Sum of absolute buy and sell fill notionals / $10,000 × 100; not annualized, excludes commissions. |
| Maximum Loss Streak / `maxConsecLosses` | Longest sequence of nonpositive completed-trade P&Ls. |
| Return/CAGR difference vs buy-and-hold | Strategy percentage minus benchmark percentage; not risk-adjusted alpha. See the optimization discrepancy below. |

**Exposure example:** with five scoring bars, enter at bar 2's open and exit at bar 4's open. Bars 2, 3 and 4 count, producing 60% exposure. Counting the exit-open bar as fully exposed overstates time in market relative to elapsed holding time in this example. This is not an estimate of hours invested or percentage of capital invested.

### Undefined values and display differences

The engine returns zero Sharpe when return deviation is zero and zero Sortino when downside deviation is zero. It returns infinite profit factor for positive profits with no losses, otherwise zero if both sums are zero. No trades gives zero win rate and average win/loss. Zero drawdown gives infinite Calmar if CAGR is positive, otherwise zero.

The **Validation comparison** replaces undefined Sharpe/Sortino, nonfinite numbers, and no-trade profit factor with `N/A`. Other Backtest cards and exports can retain engine zero or infinity values. A breakeven-only run currently shows profit factor zero even in Validation. Display conventions are therefore not yet uniform; zero is not always evidence of a meaningful measured ratio.

### Buy-and-hold benchmark

| Mode | Benchmark calculation |
| --- | --- |
| Full history | $10,000 invested at the first supplied close, valued at subsequent closes. Includes warm-up dates. |
| Development / evaluation results | $10,000 invested at the first scoring open, valued at scoring closes through the final close. Matches strategy scoring dates. |

The benchmark permits fractional units, applies no fees/slippage, and adds no cash dividends. It shares the engine's source prices; it is not a separately fetched total-return index. Strategy results include configured costs. Idle strategy cash earns no interest; taxes are not modeled.

Sources: [metric calculations](../src/services/tradingService.ts), [full-history benchmark](../src/App.tsx), [scoped benchmark](../src/services/holdoutService.ts), [validation display](../src/components/HoldoutValidation.tsx), [summary/trade exports](../src/services/exportService.ts).

## 5. Optimization and validation terminology

| Term | Meaning and limitation |
| --- | --- |
| Parameter grid | One or two axes; `min-max:step`, e.g. `7-21:2`. Up to 80 values per axis and 6,400 combinations. Only supported, enabled features can be optimized. |
| Eligible candidate | Valid parameters, enough history, at least five completed trades; when reserved, must fit the fixed warm-up budget. This is an eligibility rule, not a reliability threshold. |
| Objective / Best Score | Maximize Sharpe, CAGR, win rate or CAGR difference; minimum drawdown is implemented by maximizing negative drawdown. Strictly higher scores replace the winner, so ties keep the first candidate visited. Parameter 2 is the outer grid loop. |
| Search record | Reserved-period searches retain axes, ranges, objective, combination/eligible counts, selected parameters and score. Not a lifetime count of every experiment a user has tried. |
| Development warm-up | Default budget: 200 daily, 52 weekly, 24 monthly bars. These defaults do not guarantee the selected strategy fits. Allowed budget is 14–2,000 bars. |
| Suggested split | Approximately 60%/40% of the loaded calendar range before alignment/warm-up exclusions. Not a 60%/40% split of scored trades or returns. |
| Minimum window | At least two scoring bars per side after development warm-up. A technical minimum, not statistical sufficiency. |
| Lock | Copies data, parameters, dates and search records; generates an ID, timestamp and data fingerprint; calculates development results. Evaluation uses that copy. |
| Evaluation start | Starts independently in cash; earlier bars initialize indicators but do not pass a position into evaluation. The last pre-evaluation close can signal the first scoring-open entry. |
| Sparse evidence | Warn below 20 completed trades or 100 scoring bars in either period. Neither threshold establishes statistical validity. |
| `priorKnowledge` | User declaration: `unknown`, `reviewed`, or `not-reviewed`. The default is unknown; declarations are not independently verified. |
| `reuse` | `previously-recorded`, `first-recorded-here`, or `unknown`, based on overlapping same-symbol dates in local history and storage availability. Parameters/timeframe/fingerprint do not erase recorded exposure. |

Optimization receives the development slice only when reservation is enabled. Full-history optimization is exploratory. Applying a winner changes Strategy Setup and requires a fresh development backtest before locking. Changes to parameters, data, dates, timeframe, or starting a new experiment invalidate current results/review. Tab navigation preserves the locked experiment; prior declarations and new search records also reset its review.

There is no stitched walk-forward curve, multiple-testing correction, confidence interval, randomized benchmark, or automatic pass/fail decision. Reusing evaluation outcomes to choose settings makes them part of subsequent research.

### Worked window example and invalid splits

Illustration only, not an AAPL measurement: suppose five years supply 1,250 daily bars and the calendar-based suggestion aligns at bar index 750. With a 200-bar warm-up, development scores 550 bars and evaluation scores 500: approximately **52.4% / 47.6% of scored bars**, not 60% / 40%. Using 250 sessions/year as a rough conversion, the original 36/24-month division becomes about 26.4/24 scoring months. Actual dates, holidays, coverage and alignment determine the real counts. Monthly data still cannot accommodate the default 200-period trend filter; a smaller warm-up setting alone cannot make that filter fit.

Let `N` be prepared bar count, `W` the warm-up budget and `k` the first index whose `openDates[k]` is on or after the requested split. Planning rejects a missing split (`k = -1`), `k < W + 2`, or `N - k < 2`. For `N = 100, W = 20`, `k = 21` fails, `k = 22` passes the window-count check, `k = 98` passes, and `k = 99` fails. Parameter readiness is a separate check: `requiredBars(params) - 1 <= W`. A split inside a week/month moves to the next qualifying aggregate open; the outer-edge exclusions can leave no qualifying aggregate. These are history/parameter failures, not evidence of strategy performance.

### Known discrepancy: optimization CAGR-difference score

With reservation enabled, `runOptimization` calculates benchmark growth from the **first development input close**, including warm-up, while annualizing over the **scoring period**. The development results panel instead uses the **first scoring open**. Consequently, the optimizer's `alpha_cagr` score can disagree with the displayed development CAGR difference. Reserved development always has a positive warm-up budget (14–2,000 bars). The precise mismatch condition is **`c[0] != o[scoringStart]`**, not simply warm-up greater than zero. Equal prices make the discrepancy vanish even with warm-up; hypothetical zero warm-up would not guarantee equality between a first close and first open and is not supported by this workflow.

This affects the reported score, not candidate ranking within a fixed grid: the same benchmark constant is subtracted from every eligible candidate's CAGR. It does not affect the separate Sharpe, CAGR, win-rate or drawdown objectives, or the development/evaluation results-panel benchmark. Correction and a regression test are pending; do not interpret this score as the matching-period CAGR difference until corrected.

Sources: [optimizer](../src/services/tradingService.ts), [holdout planning and locking](../src/services/holdoutService.ts), [workflow state](../src/App.tsx).

## 6. Saved experiments, exports and AI

| Field / feature | What is stored or sent | Limitation |
| --- | --- | --- |
| Experiment `id`; `lockedAt` | Random UUID and UTC lock timestamp. Saved list sorts descending by `lockedAt`. | Not a server-certified identity or timestamp. |
| `plan` | Timeframe, requested/actual dates, split index, warm-up budget and `asOf`. | Saved/exported plans omit source OHLCV arrays. |
| `dataFingerprint` | SHA-256 of JSON for the complete prepared validation dataset, including warm-up and evaluation bars. | Identifies those input bytes; does not prove accuracy or reconstruct missing data. Does not identify the aggregation code: preserve the exact build separately and review fingerprint/version compatibility whenever preparation changes. |
| `params`; `searches` | Locked strategy fields and recorded development searches. | Earlier experiments/manual trials are not necessarily included. |
| `development`; `evaluation` | Run snapshots: dates, parameters, metrics, trades, signals, equity, benchmark and methodology. Evaluation is absent for a pending `started` record. | Not the complete market-data input needed to rerun indicators. |
| `status`; `warnings` | `started` before evaluation, `complete` after success; evidence warnings. | A `started` record can remain after failure/interruption. It must not imply unused evaluation dates. |
| Local history | `localStorage`, key `stock-analyzer-holdout-v1`, schema version 1. Exposure records have symbol, start/end, timestamp and source (`exploration`, `development`, `evaluation`). | Browser/origin-specific; preview and production are separate. Quota, cleared storage, other devices and tampering limit coverage. No import/resume UI or authenticated ledger. |
| JSON export | Full saved record as above; nonfinite numbers encoded as objects such as `{"nonfinite":"Infinity"}`. | No git SHA, complete data provenance, configuration hash, raw OHLCV, or provider revision archive. Not yet independently reproducible from this file alone. |
| Comparison CSV | Metric rows with development/evaluation values, dates, symbol/timeframe, experiment ID, prior exposure, reuse, data fingerprint and assumptions. | Rounded values, no full trade ledger or source data. |
| Backtest trade/summary CSV | Paired fills/net P&L, or metrics and many settings. | Not a complete manifest. Summary dates use equity dates; for weekly/monthly scoped runs the first date is a closing date. `rsi_period` shows N/A when Use RSI is off even if momentum still uses RSI. |
| Engine version | `methodology.engineVersion`: `2` for full-history snapshots; `3-holdout` for development/evaluation snapshots. | Manually maintained strings, not exact build identifiers. |
| AI analysis | On request: run settings, metrics, complete trade ledger/equity, benchmark summary and methodology; evaluation also includes development summary and reuse warnings. Last 12 conversation messages are sent. | Client-supplied evidence, not independently authenticated. AI cannot execute trades or rerun the engine; suggested changes are hypotheses. A modified client payload produces analysis based on that modified evidence, not an independently verified result. |
| Chat history | In-memory component state; displayed as escaped text. Not part of saved experiments. | Not a durable conversation archive; unmount/reload or a new run can clear it. |

Exposure is recorded before revealing evaluation, so a later failure does not make those dates fresh. Full-history and development backtests/searches also record exposure. Chart viewing, external research, erased history and other devices are not comprehensively tracked. Storage failures produce warnings and exports remain available.

Sources: [run snapshots](../src/services/runSnapshot.ts), [history schema](../src/services/validationHistory.ts), [validation exports](../src/components/HoldoutValidation.tsx), [AI payload](../src/services/analysisService.ts), [chat UI](../src/components/AnalysisChat.tsx).

### What independent reproduction still requires

This dictionary specifies behavior; it is not a complete evidence package. Preserve the exact provider response and prepared OHLCV arrays (including `openDates`), symbol/currency and verified adjustment basis, endpoint/request/fetch/revision metadata, `asOf`, split and warm-up, every parameter and cost setting, exact source/build and dependency versions, and full-precision expected outputs. Reproducing optimization also requires its grid, objective and candidate-order rules; assessing selection bias requires broader trial history. A fresh provider fetch or dataset hash alone cannot recover the original inputs.

A future replay check should compare dates, signals and trade ordering exactly, and numeric equity/metrics under declared tolerances, treating UUIDs and lock timestamps as run metadata rather than deterministic outputs. AI commentary is separate from deterministic engine reproduction; preserve its payload and response if auditing that commentary. None of this additional archival/replay capability is claimed by the current export.

## 7. Audit register and maintenance

The release dispositions below are **proposed gates for a methodology-qualified release**, not claims that production is blocked or that fixes have been approved. Publishing this disclosure document does not require implementing the roadmap.

| Item | Status | Proposed release disposition | Work needed / verification case |
| --- | --- | --- | --- |
| Data basis | Verification pending | Blocking before claiming validated historical performance | Independently check every OHLC field across splits/dividends, missing sessions, coverage and currency; establish endpoint migration behavior. An unadjusted split is interpreted as a price collapse; no detection is implemented. An open position can stop out spuriously and record a false loss. Case D1. |
| Optimization score | Known discrepancy | Blocking for matching-period CAGR-difference claims | Align the reserved benchmark with `periodBenchmark`; regression case O1. |
| Metric/export wording | Known discrepancy | Resolve or explicitly disclose before release | Unify undefined-value conventions; distinguish opening/closing dates; preserve momentum RSI settings. Cases M1–M3. |
| Reproducibility | Verification pending | Blocking before claiming export-only reproduction | Current export is incomplete. Archive inputs/provenance/build plus implement replay checks described in §6. Case R1. |
| Statistical reliability | Verification pending | Post-release research roadmap | Not implemented: sample sufficiency analysis, cost/fill sensitivity, uncertainty and multiple chronological folds without recycling evaluation evidence. No reliability certification in this release. |

### Concrete verification cases

These are specified checks and illustrative arithmetic, **not newly executed regression tests or measured market results**. Proposed corrected behavior remains pending.

| ID | Setup | Current behavior / acceptance criterion |
| --- | --- | --- |
| D1 | A synthetic open position crosses a 2-for-1 split: prior price 100, stop 95, next raw open 50; disable reversal exit and trailing updates. Separately reconcile an actual provider split against independent corporate-action evidence. | Engine has no split handling: raw 50 breaches the stop and creates an apparent loss, with configured slippage/costs. A future validated input path must consistently adjust all OHLC fields or reject/flag the unsupported discontinuity before treating the result as valid. Synthetic behavior alone does not establish provider adjustment semantics. |
| O1 | Positive supported warm-up, first input close 100, first scoring open 120, final close 132, one scoring year; candidate CAGR 8%. Also test equal input/scoring prices and multiple eligible candidates. | Current benchmark is 32%, score −24 percentage points; matching-period benchmark is 10%, intended score −2 points. Assert corrected score equals candidate CAGR minus `periodBenchmark` CAGR within a declared numeric tolerance (e.g. 1e-9 percentage points). Equal starting prices give no discrepancy. Candidate ranking should remain unchanged within the same eligible grid. |
| M1 | Flat/no-trade returns; positive gains with no negative returns; profitable trades without losses; completed breakeven-only trades. | Current engine: undefined Sharpe/Sortino → 0, positive-profit/no-loss PF → infinity, no-trade and breakeven-only PF → 0. Validation: undefined ratios/nonfinite values/no-trade PF → N/A; breakeven-only PF stays 0. Test cards and each export against these distinct cases before selecting a unified policy. |
| M2 | Scoped weekly scoring begins at open date 2026-01-05; first valuation close is 2026-01-09. | Run start is Jan 5; current summary CSV `start_date` is Jan 9. A corrected export must distinguish scoring-open date from first valuation date explicitly; check both against the snapshot. |
| M3 | `useRSI = false`, `useMomentumEntry = true`, `rsiPeriod = 14`. | Momentum still uses RSI(14); summary currently exports `rsi_period = N/A`. A corrected export must preserve period 14 and both feature flags. |
| R1 | Save and export an experiment, then attempt replay using only the JSON. | Current export omits input bars and exact build: reproduction cannot be completed. Future acceptance requires archived inputs and a pinned engine to reproduce signals/trades/equity/metrics under declared tolerances, and fingerprint comparison to detect altered inputs. |

This version documents source behavior and identifies pending work. It does not claim that the historical-data audit or independent trade reconciliation has been completed. When changing a calculation, update its definition, defaults, edge cases, source reference and engine version as appropriate, and verify behavior with a meaningful regression case.
