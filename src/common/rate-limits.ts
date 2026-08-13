const oneMinute = 60_000;

export const rateLimits = {
  auth: { default: { ttl: oneMinute, limit: 20 } },
  sunat: { default: { ttl: oneMinute, limit: 20 } },
  pdf: { default: { ttl: oneMinute, limit: 30 } },
  reports: { default: { ttl: oneMinute, limit: 40 } },
  dashboard: { default: { ttl: oneMinute, limit: 60 } },
} as const;
