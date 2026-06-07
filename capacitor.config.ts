import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.pluviophile.zashboardx',
  appName: 'ZashboardX',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
