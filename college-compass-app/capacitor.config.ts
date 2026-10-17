import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the native iOS app. No `server.url`: the app always runs
 * the bundled web build from `dist`.
 */
const config: CapacitorConfig = {
  appId: "com.gaddu.collegecompass",
  appName: "College Compass",
  webDir: "dist",
  ios: {
    contentInset: "never",
    // Xcode scheme used by `cap build ios` (the generated project's scheme is "App"; the
    // user-visible name "College Compass" comes from CFBundleDisplayName).
    scheme: "App",
  },
  plugins: {
    // Launch screen = ios/App/App/Base.lproj/LaunchScreen.storyboard (light/dark aware).
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      showSpinner: false,
    },
  },
};

export default config;
