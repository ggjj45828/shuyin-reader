import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.shuyin.reader',
  appName: '书隐',
  webDir: 'www',
  ios: { contentInset: 'automatic' },
  plugins: { SplashScreen: { launchShowDuration: 0 }, CapacitorHttp: { enabled: true } }
};
export default config;
