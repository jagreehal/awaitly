import type { ESLint, Linter } from 'eslint';
import noImmediateExecution from './rules/no-immediate-execution.js';
import requireThunkForKey from './rules/require-thunk-for-key.js';
import stableCacheKeys from './rules/stable-cache-keys.js';
import noFloatingWorkflow from './rules/no-floating-workflow.js';
import noFloatingResult from './rules/no-floating-result.js';
import requireResultHandling from './rules/require-result-handling.js';
import noOptionsOnExecutor from './rules/no-options-on-executor.js';
import noDoubleWrapResult from './rules/no-double-wrap-result.js';

const rules = {
  'no-immediate-execution': noImmediateExecution,
  'require-thunk-for-key': requireThunkForKey,
  'stable-cache-keys': stableCacheKeys,
  'no-floating-workflow': noFloatingWorkflow,
  'no-floating-result': noFloatingResult,
  'require-result-handling': requireResultHandling,
  'no-options-on-executor': noOptionsOnExecutor,
  'no-double-wrap-result': noDoubleWrapResult,
};

const configs: Record<string, Linter.Config[]> = {
  recommended: [
    {
      plugins: {
        awaitly: { rules },
      },
      rules: {
        'awaitly/no-immediate-execution': 'error',
        'awaitly/require-thunk-for-key': 'error',
        'awaitly/stable-cache-keys': 'error',
        'awaitly/no-floating-workflow': 'error',
        'awaitly/no-floating-result': 'error',
        'awaitly/require-result-handling': 'warn',
        'awaitly/no-options-on-executor': 'error',
        'awaitly/no-double-wrap-result': 'error',
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
