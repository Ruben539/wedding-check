import * as Network from 'expo-network';

import { APP_URL } from '@/env';

// Laravel health endpoint (same server as the API, outside /api)
const HEALTH_URL = `${APP_URL.replace(/\/api\/?$/, '')}/up`;

async function canReachServer(timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Any HTTP answer (even an error status) means there is internet
    await fetch(HEALTH_URL, { method: 'GET', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the device really has internet.
 *
 * `isInternetReachable` can be `false` on Wi-Fi that works: Android marks the network as
 * "no internet" when its connectivity probe to Google is blocked or slow (venue / company Wi-Fi,
 * private DNS), and right after opening the app the value may not be validated yet.
 * So "no network at all" is trusted, but "not reachable" is confirmed against our own server.
 */
export async function hasInternet(state?: Network.NetworkState): Promise<boolean> {
  let current = state;
  if (!current) {
    try {
      current = await Network.getNetworkStateAsync();
    } catch {
      return canReachServer();
    }
  }

  if (current.isConnected === false) return false;
  if (current.isInternetReachable !== false) return true;
  return canReachServer();
}
