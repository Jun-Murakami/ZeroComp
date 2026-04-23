/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PACKAGE_VERSION: string
  readonly VITE_APP_VERSION_FULL: string
  readonly VITE_BUILD_DATE: string
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
