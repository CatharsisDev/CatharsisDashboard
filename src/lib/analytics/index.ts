import type { AnalyticsProvider, Platform } from "./types";
import { appstoreProvider } from "./appstore";
import { googlePlayProvider } from "./googleplay";

const providers: Record<Platform, AnalyticsProvider> = {
  ios: appstoreProvider,
  android: googlePlayProvider,
};

export function getProvider(platform: Platform): AnalyticsProvider | undefined {
  return providers[platform];
}

export function getConfiguredProviders(): AnalyticsProvider[] {
  return Object.values(providers).filter(Boolean).filter((p) => p.isConfigured());
}

export function getAllProviders(): AnalyticsProvider[] {
  return Object.values(providers).filter(Boolean);
}
