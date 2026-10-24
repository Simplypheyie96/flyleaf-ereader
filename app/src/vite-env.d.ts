/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/* Injected by vite.config.ts's `define`, so package.json stays the one source
   of truth for the version and Settings can say which build is running. */
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
/* True only for the store apps (npm run ios / android, VITE_STORE=1). A
   build-time constant, so the web build drops every native path. src/native.ts */
declare const __STORE__: boolean
