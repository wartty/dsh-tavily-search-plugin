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

/** Host half: ESM Node library, emitted as lib/index.js for the Cordis loader. */
const lib = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
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

export default defineConfig([lib, client])
