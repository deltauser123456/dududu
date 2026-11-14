import "dotenv/config";

export default ({ config }) => ({
  ...config,
  name: "HUNTER",
  slug: "hunter-location-game",
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY || ""
      }
    }
  },
  extra: {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      projectId: process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId
    }
  }
});
