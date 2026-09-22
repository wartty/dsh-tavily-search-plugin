/**
 * tsdown build config for dsh-tavily-search-plugin.
 *
 * Dual-face: the host half (lib/index.js) is the Cordis plugin entry the
 * loader imports; the client half (lib/client.js) is the CJS factory the
 * browser module loader handshakes (`window.__ModuleLoader__.load`).
 *
 * `prepare` script (declared in package.json) runs after `pnpm install` for a
 * git-style install, so the build must be self-contained — no presets from
 * the DSH monorepo, no shared workspace tooling. The official
 * `kun2-5code/dsh-plugin-template` follows the same pattern.
 *
 *   pnpm install -g file:<DIR>   # triggers prepare → tsdown → lib/{index,client}.js
 */

import { defineConfig } from 'tsdown'

/**
 * Compiler overrides handed to `rolldown-plugin-dts` for declaration emit.
 *
 * The host tsconfig (used for IDE / `tsc --noEmit`) sets `noEmit: true` and
 * uses `target: ES2024`, but TypeScript 5.4 (the version pinned in
 * `peerDependencies`) only recognises `target`/`lib` up to `ES2023` /
 * `ESNext`. With `ES2024` the dts emitter silently drops every lib entry
 * and reports TS4033 / TS4055 ("private name 'Promise'") on every exported
 * type that mentions a global. We work around this with a dedicated tsconfig
 * that downgrades the target to `ESNext` and the lib to `ES2023`; the
 * emitted `.d.ts` is identical in shape either way for our ESM-only host.
 */
const DTS_COMPILER_OPTIONS = {
  target: 'ESNext',
  module: 'ESNext',
  moduleResolution: 'Bundler',
  lib: ['ES2023', 'DOM', 'DOM.Iterable'],
  jsx: 'react-jsx',
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  isolatedModules: true,
  noEmit: false,
} as const

/** Host half: ESM Node library, emitted as lib/index.js for the Cordis loader. */
const lib = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: {
    tsconfig: './tsconfig.dts.json',
    compilerOptions: DTS_COMPILER_OPTIONS,
  },
  clean: true,
  fixedExtension: false,
}

/**
 * Card model: ESM, platform-neutral, emitted as lib/card-model.js.
 *
 * The card's field specs, draft rules and staged-write controller are React-free
 * on purpose, and this artifact is what makes them testable: `pnpm test` imports
 * it in Node and drives the write planner with stub services instead of a
 * browser. It gets its own build so the browser bundle and the host bundle each
 * stay self-contained — no shared chunk to ship or resolve.
 */
const model = {
  name: 'dsh-tavily-search-plugin/card-model',
  entry: { 'card-model': 'src/client/card-model.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: 'card-model.js' },
}

/**
 * Client half: CJS browser bundle, handshaked by window.__ModuleLoader__.load.
 *
 * The DSH monorepo's purity gate (packages/client/tsdown.client.ts) keeps a
 * tight external allowlist; standalone plugin bundles don't have that gate
 * because the host does not own the build. We mirror the official template's
 * choice: externalise only `react`, inline everything else. That keeps the
 * the factory's `require(...)` calls satisfiable by the browser module table
 * (which exposes `react` and the four platform modules every dynamic bundle
 * already gets — see `PLATFORM_MODULES` in `packages/client/web/src/platform.ts`).
 */
const CLIENT_EXTERNALS = ['react']

const client = {
  name: 'dsh-tavily-search-plugin/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-tavily-search-plugin", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([lib, model, client])
