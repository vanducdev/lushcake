import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lushcake.mobile',
  appName: 'LushCake',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;

