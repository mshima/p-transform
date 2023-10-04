// eslint-disable-next-line n/file-extension-in-import
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      '100': true,
    },
  },
});
