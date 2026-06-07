// Device-identity headers that make our private-API requests look like the WHOOP
// iOS app's own traffic. The data endpoints authenticate on the bearer token
// alone, but a request missing the app's x-whoop-* header set is itself a tell —
// sending the same set keeps us inside the legitimate-app traffic distribution.
//
// Adapted from github.com/briangaoo/totem (src/whoop/device.ts). Per-install
// values (installation identifier, time zone) are stored per connection in
// whoop_connections so a connection keeps one stable identity across refreshes;
// the iOS version constants are the app's own shared values, bumped here when
// re-captured.

// Captured from WHOOP iOS 5.52.0 (build 595097). Bump when the app ships a new
// version so we keep blending with the current install base.
export const IOS_APP_VERSION = "5.52.0";
export const IOS_BUILD_NUMBER = "595097";
export const IOS_BUNDLE_NAME = "com.whoop.iphone";

export interface DeviceIdentity {
  installationId: string; // uppercase UUID, x-whoop-installation-identifier
  timeZone: string; // IANA name, x-whoop-time-zone
  iosAppVersion?: string | null;
  iosBuildNumber?: string | null;
}

/**
 * The identity header set the WHOOP iOS app stamps on every data request, minus
 * the per-request telemetry and marketing cookies that carry no auth weight and
 * would only add a fabricated, greppable signature. `authorization` and (for
 * bodies) `content-type` are layered on by the client.
 */
export function deviceHeaders(id: DeviceIdentity): Record<string, string> {
  return {
    "user-agent": "iOS",
    "x-whoop-device-platform": "iOS",
    "x-whoop-ios-version": id.iosAppVersion || IOS_APP_VERSION,
    "x-whoop-ios-build-number": id.iosBuildNumber || IOS_BUILD_NUMBER,
    "x-whoop-bundle-name": IOS_BUNDLE_NAME,
    "x-whoop-installation-identifier": id.installationId,
    "x-whoop-time-zone": id.timeZone,
    "x-whoop-clock-format": "TWELVE_HOUR",
    currency: "USD",
    locale: "en_US",
    "accept-language": "en",
    accept: "*/*",
    priority: "u=3",
  };
}
