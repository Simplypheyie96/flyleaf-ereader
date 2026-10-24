import type { CapacitorConfig } from '@capacitor/cli'

/* The iOS and Android apps (npm run ios / npm run android). They bundle dist/
   built with VITE_STORE=1; nothing is loaded from read.flyleaf.cc, and the web
   build is the same app with every native path compiled out (src/native.ts). */
const config: CapacitorConfig = {
  appId: 'com.feyidesigns.ereader',
  appName: 'Octavo',
  webDir: 'dist',
  ios: { contentInset: 'never' },
}

export default config
