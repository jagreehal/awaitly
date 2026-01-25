import type { ESLint, Linter } from 'eslint';
import noImmediateExecution from './rules/no-immediate-execution.js';
import requireThunkForKey from './rules/require-thunk-for-key.js';
import stableCacheKeys from './rules/stable-cache-keys.js';

const rules = {
  'no-immediate-execution': noImmediateExecution,
  'require-thunk-for-key': requireThunkForKey,
  'stable-cache-keys': stableCacheKeys,
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
