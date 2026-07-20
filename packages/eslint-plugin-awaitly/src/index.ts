import type { ESLint, Linter } from 'eslint';
import noImmediateExecution from './rules/no-immediate-execution.js';
import requireStepId from './rules/require-step-id.js';
import requireThunkForKey from './rules/require-thunk-for-key.js';
import stableCacheKeys from './rules/stable-cache-keys.js';
import noFloatingWorkflow from './rules/no-floating-workflow.js';
import noFloatingResult from './rules/no-floating-result.js';
import requireResultHandling from './rules/require-result-handling.js';
import noOptionsOnExecutor from './rules/no-options-on-executor.js';
import noDoubleWrapResult from './rules/no-double-wrap-result.js';
import noDynamicImport from './rules/no-dynamic-import.js';
import stepNoBareAwait from './rules/step-no-bare-await.js';
import stepNoTryCatchWrap from './rules/step-no-try-catch-wrap.js';
import concurrencyNoPromiseAll from './rules/concurrency-no-promise-all.js';
import concurrencyNoPromiseRace from './rules/concurrency-no-promise-race.js';
import concurrencyNoPromiseAllSettled from './rules/concurrency-no-promise-allsettled.js';
import resultNoManualPropagation from './rules/result-no-manual-propagation.js';
import resultNoDirectOkErr from './rules/result-no-direct-ok-err.js';
import workflowNoCallableForm from './rules/workflow-no-callable-form.js';
import workflowCallbackShape from './rules/workflow-callback-shape.js';
import errorCheckUnexpectedFirst from './rules/error-check-unexpected-first.js';
import workflowPreferStepIf from './rules/workflow-prefer-step-if.js';
import workflowPreferStepForEach from './rules/workflow-prefer-step-foreach.js';

// Canonical slug-native rule names. No legacy aliases — the rename is a
// breaking change accompanying the AI-DX slug spine.
const rules = {
  // step-*
  'step-require-id': requireStepId,
  'step-no-immediate-execution': noImmediateExecution,
  'step-require-thunk-for-key': requireThunkForKey,
  'step-stable-cache-keys': stableCacheKeys,
  'step-no-bare-await': stepNoBareAwait,
  'step-no-try-catch-wrap': stepNoTryCatchWrap,
  // workflow-*
  'workflow-no-floating': noFloatingWorkflow,
  'workflow-options-position': noOptionsOnExecutor,
  'workflow-callback-shape': workflowCallbackShape,
  'workflow-no-callable-form': workflowNoCallableForm,
  'workflow-no-dynamic-import': noDynamicImport,
  // Diagrammability: steer raw control flow onto first-class constructs so
  // the static diagram stays deterministic.
  'workflow-prefer-step-if': workflowPreferStepIf,
  'workflow-prefer-step-foreach': workflowPreferStepForEach,
  // result-*
  'result-no-floating': noFloatingResult,
  'result-require-handling': requireResultHandling,
  'result-no-double-wrap': noDoubleWrapResult,
  'result-no-manual-propagation': resultNoManualPropagation,
  'result-no-direct-ok-err': resultNoDirectOkErr,
  // concurrency-*
  'concurrency-no-promise-all': concurrencyNoPromiseAll,
  'concurrency-no-promise-race': concurrencyNoPromiseRace,
  'concurrency-no-promise-allsettled': concurrencyNoPromiseAllSettled,
  // error-*
  'error-check-unexpected-first': errorCheckUnexpectedFirst,
};

const configs: Record<string, Linter.Config[]> = {
  recommended: [
    {
      plugins: {
        awaitly: { rules },
      },
      rules: {
        'awaitly/step-require-id': 'error',
        'awaitly/step-no-immediate-execution': 'error',
        'awaitly/step-require-thunk-for-key': 'error',
        'awaitly/step-stable-cache-keys': 'error',
        'awaitly/workflow-no-floating': 'error',
        'awaitly/result-no-floating': 'error',
        'awaitly/result-require-handling': 'warn',
        'awaitly/workflow-options-position': 'error',
        'awaitly/result-no-double-wrap': 'error',
        'awaitly/workflow-no-dynamic-import': 'error',
        'awaitly/step-no-bare-await': 'error',
        'awaitly/step-no-try-catch-wrap': 'error',
        'awaitly/concurrency-no-promise-all': 'error',
        'awaitly/concurrency-no-promise-race': 'error',
        'awaitly/concurrency-no-promise-allsettled': 'error',
        'awaitly/result-no-manual-propagation': 'error',
        'awaitly/result-no-direct-ok-err': 'error',
        'awaitly/workflow-no-callable-form': 'error',
        'awaitly/workflow-callback-shape': 'error',
        // Diagrammability nudges: warn by default so the guidance is visible
        // without failing builds on existing raw control flow.
        'awaitly/workflow-prefer-step-if': 'warn',
        'awaitly/workflow-prefer-step-foreach': 'warn',
        // 'awaitly/error-check-unexpected-first': 'warn',
        // ^ deliberately opt-in. The rule uses heuristic AST matching to
        //   flag `if (result.error._tag === ...)` without an
        //   `isUnexpectedError(result.error)` guard — false positives are
        //   inevitable on patterns we didn't anticipate, so it's not in
        //   `recommended` or `recommended-strict`. Enable it explicitly if
        //   you want the warning.
      },
    },
  ],
  "recommended-strict": [
    {
      plugins: {
        awaitly: { rules },
      },
      rules: {
        "awaitly/step-require-id": "error",
        "awaitly/step-no-immediate-execution": "error",
        "awaitly/step-require-thunk-for-key": "error",
        "awaitly/step-stable-cache-keys": "error",
        "awaitly/workflow-no-floating": "error",
        "awaitly/result-no-floating": "error",
        "awaitly/result-require-handling": "error",
        "awaitly/workflow-options-position": "error",
        "awaitly/result-no-double-wrap": "error",
        "awaitly/workflow-no-dynamic-import": "error",
        "awaitly/step-no-bare-await": "error",
        "awaitly/step-no-try-catch-wrap": "error",
        "awaitly/concurrency-no-promise-all": "error",
        "awaitly/concurrency-no-promise-race": "error",
        "awaitly/concurrency-no-promise-allsettled": "error",
        "awaitly/result-no-manual-propagation": "error",
        "awaitly/result-no-direct-ok-err": "error",
        "awaitly/workflow-no-callable-form": "error",
        "awaitly/workflow-callback-shape": "error",
        // Strict = fully diagrammable: raw control flow with steps is an error.
        "awaitly/workflow-prefer-step-if": "error",
        "awaitly/workflow-prefer-step-foreach": "error",
        // error-check-unexpected-first is opt-in (see note in `recommended`).
      },
    },
  ],
};

const plugin: ESLint.Plugin = {
  meta: {
    name: 'eslint-plugin-awaitly',
    version: '0.1.0',
  },
  rules,
  configs,
};

export default plugin;
export { rules, configs };
