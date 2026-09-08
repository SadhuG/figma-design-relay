// Hand-rolled rather than pulling in `vite/client`, which would redeclare the
// `*.png` / `*.svg` / `*.jpg` modules already declared in `src/assets.d.ts` and
// would leak web-app ambient types into `src/main`, which runs in Figma's
// plugin sandbox.
//
// Vite substitutes these at build time, so anything absent from the build
// environment arrives as `undefined` -- hence the optional marker. See
// `WS_BASE_URL` in `App.tsx`, which falls back with `||` for exactly that reason.
interface ImportMetaEnv {
  readonly VITE_FIGMA_DESIGN_RELAY_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
