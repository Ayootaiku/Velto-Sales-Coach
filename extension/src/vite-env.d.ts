/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRODUCTION_ORIGIN: string
  readonly VITE_CLOUD_WSS: string
  readonly VITE_RESTART_SECRET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
