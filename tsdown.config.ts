import { defineConfig } from 'tsdown'

// Хост: ESM для Node; пакеты harness и pi-ai — peer из установки DeepSeek Harness.
// Клиент: один CJS-модуль, который scripts/wrap-client.mjs заворачивает в
// window.__ModuleLoader__.load({ id, factory }) — формат клиентских модулей harness.
// react, react/jsx-runtime и @deepseek-ai/dsh-client-ui-primitives отдаёт платформа.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    fixedExtension: false,
    clean: true,
    external: [/^@deepseek-ai\//u, /^@earendil-works\//u],
  },
  {
    entry: { 'client.raw': 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    tsconfig: 'tsconfig.client.json',
    external: ['react', 'react/jsx-runtime', 'react-dom', /^@deepseek-ai\//u],
  },
])
