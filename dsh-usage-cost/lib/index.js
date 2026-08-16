/**
 * dsh-usage-cost — host half.
 *
 * Registers the `usage-cost` settings namespace (master enable switch +
 * per-model price table) and one minimal `usageCost` session-projection unit
 * that tracks each session's current provider/model route. The browser half
 * reads the token-meter's `tokenUsage` projection (already folded from the
 * durable log, provider-reported buckets) and this `usageCost` projection,
 * then computes real-time cost client-side with the configured prices.
 *
 * Nothing here folds the session log: token-meter already owns usage
 * accounting, and reimplementing it would only drift. Cost is a pure function
 * of (provider-reported tokens × configurable prices).
 */
import z from "@deepseek-ai/schemastery";
import { z as zod } from "zod";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

export const name = "dsh-usage-cost";

/** Settings namespace this plugin owns (exposed to the Web client via the api-proxy whitelist). */
export const SETTINGS_NAMESPACE = "usage-cost";

/** Per-model price entry — display currency per 1,000,000 tokens. */
const PriceEntry = z.object({
  /** Input tokens that missed the provider cache (uncached input plus cache writes). */
  cacheMissInput: z.number().min(0).default(0),
  /** Input tokens served from the provider cache. */
  cacheHitInput: z.number().min(0).default(0),
  /** Output tokens. */
  output: z.number().min(0).default(0)
});

export const Config = z.object({
  /** Master switch: false hides the panel/button (the projection unit still runs — it is inert). */
  enabled: z.boolean().default(true),
  /** Display currency label. */
  currency: z.string().default("CNY"),
  /** Fallback model id used to price a session whose route is unknown yet. */
  defaultModel: z.string().default("deepseek-v4-flash"),
  /**
   * Per-model prices (per 1,000,000 tokens, CNY) — official DeepSeek API
   * rates as of 2026-08-16 (api-docs.deepseek.com/quick_start/pricing/):
   *   deepseek-v4-flash: hit ¥0.02 / miss ¥1 / output ¥2
   *   deepseek-v4-pro:   hit ¥0.025 / miss ¥3 / output ¥6
   * NOTE: from 2026-08-17 DeepSeek switches to peak/off-peak pricing
   * (peak 9:00–12:00 & 14:00–18:00 Beijing; off-peak = half of peak):
   *   flash peak 0.10/3.0/9.0 · off-peak 0.05/1.5/4.5
   *   pro   peak 0.30/9.0/27.0 · off-peak 0.15/4.5/13.5
   * Edit here or under `usage-cost:` in `$DSH_HOME/settings.yaml` when the
   * scheme changes.
   */
  prices: z.dict(PriceEntry).default({
    "deepseek-v4-flash": { cacheMissInput: 1, cacheHitInput: 0.02, output: 2 },
    "deepseek-v4-pro": { cacheMissInput: 3, cacheHitInput: 0.025, output: 6 }
  }),
  /**
   * Peak/off-peak (峰谷) automatic pricing — official DeepSeek scheme from
   * 2026-08-17. Off-peak is always HALF of the peak rate (官方规则), so only
   * the peak table is configured. `peakingStart` (YYYY-MM-DD, in `timezone`)
   * gates when the scheme takes effect: before that date the FLAT `prices`
   * table is used (official pre-8/17 rates), from that date on the peak rates
   * apply inside peak hours and half of them outside. Disable `peaking` to
   * always use the flat table.
   */
  peaking: z.boolean().default(true),
  /** Scheme start date (inclusive), YYYY-MM-DD in the configured timezone. */
  peakingStart: z.string().default("2026-08-17"),
  /** IANA timezone used to decide peak hours (default Asia/Shanghai = 北京时间). */
  timezone: z.string().default("Asia/Shanghai"),
  /** Peak windows as [startHour, endHour) pairs, hours in the configured timezone. */
  peakHours: z.array(z.tuple([z.number().min(0).max(23), z.number().min(1).max(24)])).default([[9, 12], [14, 18]]),
  /** Per-model PEAK rates (per 1,000,000 tokens, CNY); off-peak = half. */
  peakPrices: z.dict(PriceEntry).default({
    "deepseek-v4-flash": { cacheMissInput: 3, cacheHitInput: 0.1, output: 9 },
    "deepseek-v4-pro": { cacheMissInput: 9, cacheHitInput: 0.3, output: 27 }
  })
});

/** Session-projection unit: last-wins provider/model from `request/context` events. */
const usageCostSchema = zod.object({
  provider: zod.string().optional(),
  model: zod.string().optional()
});

const usageCostUnit = {
  key: "usageCost",
  schema: usageCostSchema,
  init: () => ({}),
  apply: (state, event) => {
    if (event.type !== "request/context") return state;
    const { provider, model } = event.data;
    if (state.provider === provider && state.model === model) return state;
    return { provider, model };
  },
  view: (state) => state,
  stateVersion: 1
};

/**
 * Per-turn usage projection (`usageCostByTurn`): a map `{ turn → buckets }`
 * folded host-side from the durable log, served to the browser through the
 * SAME projection channel as token-meter's `tokenUsage` — so the per-turn
 * cost chip never depends on per-event wire delivery. The (turn, step)
 * replacement rule mirrors token-meter: a final assistant/message usage for
 * the same (turn, step) replaces the earlier sample instead of
 * double-counting a retried request.
 */
const usageCostByTurnSchema = zod.record(zod.string(), zod.object({
  inputTokens: zod.number().int().nonnegative(),
  cacheReadTokens: zod.number().int().nonnegative(),
  cacheWriteTokens: zod.number().int().nonnegative(),
  outputTokens: zod.number().int().nonnegative(),
  model: zod.string().optional(),
  time: zod.number().optional()
}));

const usageCostByTurnUnit = {
  key: "usageCostByTurn",
  schema: usageCostByTurnSchema,
  init: () => ({ model: undefined, samples: {} }),
  apply: (state, event) => {
    if (event.type === "request/context") {
      if (state.model === event.data.model) return state;
      return { ...state, model: event.data.model };
    }
    if (event.type !== "assistant/message") return state;
    const usage = event.data.usage;
    if (!usage || typeof usage !== "object") return state;
    const { turn, step } = event.data;
    if (typeof turn !== "number" || typeof step !== "number") return state;
    const key = turn + ":" + step;
    const samples = { ...state.samples };
    samples[key] = {
      turn,
      usage: {
        inputTokens: usage.inputTokens || 0,
        cacheReadTokens: usage.cacheReadTokens || 0,
        cacheWriteTokens: usage.cacheWriteTokens || 0,
        outputTokens: usage.outputTokens || 0
      },
      model: state.model,
      time: event.time
    };
    return { ...state, samples };
  },
  view: (state) => {
    const byTurn = {};
    for (const key of Object.keys(state.samples)) {
      const sample = state.samples[key];
      const t = String(sample.turn);
      const prev = byTurn[t];
      byTurn[t] = {
        inputTokens: (prev?.inputTokens ?? 0) + sample.usage.inputTokens,
        cacheReadTokens: (prev?.cacheReadTokens ?? 0) + sample.usage.cacheReadTokens,
        cacheWriteTokens: (prev?.cacheWriteTokens ?? 0) + sample.usage.cacheWriteTokens,
        outputTokens: (prev?.outputTokens ?? 0) + sample.usage.outputTokens,
        model: sample.model || prev?.model,
        time: sample.time || prev?.time
      };
    }
    return byTurn;
  },
  stateVersion: 1
};

export function apply(ctx, config) {
  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), Config, config, {
    setSource: () => {},
    onChange: () => {}
  });
  // Same optional-seam pattern as token-meter: register the units only when the
  // session-projection registry is mounted (it always is in the web profile).
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register(usageCostUnit);
    projectionCtx.sessionProjections.register(usageCostByTurnUnit);
  });
}
