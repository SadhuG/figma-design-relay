interface ImportMetaEnv {
  /**
   * WebSocket endpoint of the relay server. Overrides the built-in default.
   * A custom endpoint must also be listed in manifest.json's
   * networkAccess.allowedDomains.
   */
  readonly VITE_FIGMA_DESIGN_RELAY_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
