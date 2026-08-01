module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiBaseUrl:
      process.env.EXPO_PUBLIC_SLABPLAN_API_BASE_URL ??
      process.env.EXPO_PUBLIC_CADSTONE_API_BASE_URL ??
      config.extra?.apiBaseUrl ??
      "",
  },
});
