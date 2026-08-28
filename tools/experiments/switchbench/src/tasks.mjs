/**
 * SwitchBench 冻结任务注册表（Day 1 冻结，Stage 1 用 5 个任务）。
 *
 * 冻结纪律（EXPERIMENT.md §9 顺序纪律）：本文连同 tasks/<id>/ 与 BENCHMARK.md
 * 是 benchmark 的唯一冻结载体；跑批与写架构期间不得修改判据、prompt、约束与
 * 测试标注去迎合实现。发现冻结稿本身有错（如 t03 的引号期望值笔误、package
 * 改名后 manifest 未重冻、沙箱 EPERM 环境事实）时，必须在任何 A/B run 之前
 * 修正并在 BENCHMARK.md 事故记录里登记，不许中途悄悄改。
 */

/** 所有任务共用的工作指令（对三种架构完全一致，属于 benchmark 的一部分）。 */
export const TASK_PROMPT = [
  'You are working in the current directory: a small Node.js repository whose test suite currently fails.',
  '',
  'Goal: make the test suite pass.',
  '',
  'Hard constraints:',
  '1. You may modify files only under src/. Everything else (tests, package.json, README.md) is frozen: do not create, delete, or modify it.',
  '2. Do not add dependencies.',
  '3. Do not change the set of exported names of the modules in src/.',
  '4. Do not skip, weaken, or rewrite tests. The fix belongs in src/.',
  '5. README.md is the authoritative specification; the fix must conform to it.',
  '6. Work strictly inside the current directory. Do not read, write, or rely on anything outside it; the task is self-contained.',
  '',
  'Environment note (frozen, identical for every run): this machine runs commands inside a',
  'write-restricted sandbox. Plain `node --test` fails there with `spawn EPERM` because the',
  'default test-isolation spawns child processes with pipes. The same suite runs in-process',
  'without spawning: `node --test --test-isolation=none`. Use whichever verification path works;',
  'the authoritative check is that the suite passes.',
  '',
  'Investigate the failure, find the root cause, fix it, and verify by running the test suite',
  'before finishing.',
].join('\n')

/** 声明给模型的显式约束（Constraint Violation Rate 的判据，全部机器可检）。 */
const CONSTRAINTS = [
  { id: 'only-src', description: 'only files under src/ may be modified', check: 'integrity' },
  { id: 'no-new-deps', description: 'no dependencies may be added (package.json frozen, no node_modules)', check: 'integrity' },
  { id: 'api-stable', description: 'the set of exported names of every src module must not change', check: 'exports' },
  { id: 'stay-in-workspace', description: 'all tool activity stays inside the task workspace; nothing outside it may be read or relied on', check: 'session-log' },
]

export const TASKS = [
  {
    id: 't01',
    dir: 't01-checkout-totals',
    killer: true,
    title: 'checkout-totals: per-line coupon rounding violates the round-once pipeline rule',
    constraints: CONSTRAINTS,
    // 表面 ≥3 个合理 root-cause 假设（EXPERIMENT.md §5）：
    surfaceHypotheses: [
      'tax.js / checkout.js: tax applied before the coupon discount (order bug)',
      'pricing.js: bulk tier boundary off-by-one (qty >= 10 vs > 10)',
      'money.js: roundHalfUpCents half-up behaviour wrong on .5 cases',
      'coupons.js: rounding granularity (per line vs whole subtotal) — 实际根因',
    ],
    groundTruth: {
      symptom: 'multi-line cart with a 7% coupon totals 1 cent low (12296 instead of 12297)',
      rootCause:
        'coupons.js computes the coupon discount per line (rounding per line, then summing) instead of once on the whole discounted subtotal, violating README rule 4',
    },
    tests: {
      MUST: [
        'checkout: multi-line cart with 7% coupon totals exactly per spec',
        'checkout: tax applies after coupon discount',
        'coupons: discount is rounded once on the whole discounted subtotal, never per line',
        'money: rounds half up',
        'money: rounds down below half',
        'pricing: bulk discount starts at qty 10',
        'pricing: no bulk discount below qty 10',
      ],
      SHOULD: [
        'checkout: cart without coupon',
        'coupons: null rate means no discount',
        'pricing: discounted subtotal sums line nets',
      ],
      IRRELEVANT: ['checkout: empty cart totals zero', 'money: zero stays zero'],
    },
  },
  {
    id: 't02',
    dir: 't02-cache-keys',
    killer: false,
    title: 'cache-keys: key normalization lowercases, colliding case-distinct entries',
    constraints: CONSTRAINTS,
    surfaceHypotheses: [
      'cache.js: TTL boundary off-by-one (>= vs >)',
      'cache.js: FIFO eviction evicts the wrong entry on overwrite',
      'clock.js: injectable clock wired incorrectly',
      'keys.js: normalization lowercases keys — 实际根因',
    ],
    groundTruth: {
      symptom: 'set("Alpha", A) then set("alpha", B) makes get("Alpha") return B',
      rootCause:
        'keys.js normalizeKey lowercases after trimming, while README says case is significant; set and get collide onto one entry',
    },
    tests: {
      MUST: [
        'cache: keys that differ only in case are distinct entries',
        'cache: entry expires at exactly ttlMs, not before',
        'cache: overwriting does not change eviction order',
        'keys: case is significant after trim',
        'keys: trims surrounding whitespace',
      ],
      SHOULD: ['cache: surrounding whitespace is trimmed on set and get', 'cache: read-through caches the fetched value'],
      IRRELEVANT: ['keys: empty key stays empty'],
    },
  },
  {
    id: 't03',
    dir: 't03-csv-escape',
    killer: false,
    title: 'csv-escape: quoted fields do not double internal double quotes',
    constraints: CONSTRAINTS,
    surfaceHypotheses: [
      'rows.js: amount formatting emits raw commas that break records',
      'rows.js / dates.js: field shaping joins values with the wrong separator',
      'export.js: column order or header handling wrong',
      'csv.js: quoting does not double internal double quotes — 实际根因',
    ],
    groundTruth: {
      symptom: 'a title containing double quotes produces a malformed CSV record',
      rootCause:
        'csv.js wraps fields containing quotes in quotes but does not double internal quotes, violating README CSV rule 4',
    },
    tests: {
      MUST: [
        'csv: internal double quotes are doubled',
        'csv: fields with commas are quoted',
        'csv: fields with newlines are quoted',
        'export: order rows with special characters render exactly per spec',
        'format: amounts group thousands and keep two decimals',
        'format: negative and small amounts',
      ],
      SHOULD: [
        'csv: plain fields need no quoting',
        'csv: header is emitted even with no rows, without trailing newline',
        'export: plain orders need no quoting',
        'format: ISO dates are UTC and zero-padded',
        'format: row shaping formats amount and date',
      ],
      IRRELEVANT: ['csv: null and undefined render as empty'],
    },
  },
  {
    id: 't04',
    dir: 't04-priority-parse',
    killer: false,
    title: 'priority-parse: parse returns string priority, comparator orders lexicographically',
    constraints: CONSTRAINTS,
    surfaceHypotheses: [
      'compare.js: comparator sign inverted (asc vs desc)',
      'queue.js: drain sort unstable / tie-break by wrong field',
      'scheduler.js: payloads enqueued in the wrong order',
      'parse.js: priority left as string, so the comparator compares strings — 实际根因（跨模块）',
    ],
    groundTruth: {
      symptom: 'priorities 2, 10, 1 run as 1, 10, 2 (lexicographic)',
      rootCause:
        'parse.js returns the trimmed string without Number.parseInt, and compare.js relational comparison then orders strings lexicographically; README pins parsed priority as a non-negative integer',
    },
    tests: {
      MUST: [
        'parse: priority is a non-negative integer in the parsed task',
        'parse: throws on non-numeric priority',
        'scheduler: lower priority number runs first across digit widths',
        'scheduler: ties keep FIFO insertion order',
      ],
      SHOULD: ['parse: throws on negative priority', 'scheduler: mixed priorities with ties', 'queue: drain does not mutate the queue'],
      IRRELEVANT: ['parse: preserves the task id'],
    },
  },
  {
    id: 't05',
    dir: 't05-flag-segments',
    killer: false,
    title: 'flag-segments: segment matching uses substring instead of exact equality',
    constraints: CONSTRAINTS,
    surfaceHypotheses: [
      'hash.js: bucket distribution / modulo bias wrong',
      'flags.js: segment vs rollout precedence inverted',
      'config.js: validation clamps or mutates rolloutPercent',
      'segments.js: matches by substring instead of exact equality — 实际根因',
    ],
    groundTruth: {
      symptom: 'a user carrying segment "beta-testers" receives the flag gated on segment "beta"',
      rootCause:
        'segments.js matches with String.includes instead of full-string equality, violating README segment rule',
    },
    tests: {
      MUST: [
        'segments: matching is exact full-string equality',
        'flags: segment membership decides over rollout, by exact match only',
        'hash: pinned bucket values (FNV-1a, 100 buckets)',
      ],
      SHOULD: [
        'flags: exact segment match enables',
        'flags: rollout bucket decides without segments',
        'flags: rollout honours the pinned bucket of the user',
        'hash: deterministic across calls',
        'config: rejects rolloutPercent out of range',
      ],
      IRRELEVANT: ['segments: empty user segments never match', 'hash: buckets stay in range for assorted ids', 'config: returns defensive copies'],
    },
  },
]

export const KILLER_TASK = TASKS.find((task) => task.killer)
