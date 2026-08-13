const requiredProductionVariables = [
  'JWT_SECRET',
  'CORS_ORIGINS',
  'FRONTEND_URL',
  'TURNSTILE_SECRET_KEY',
  'BREVO_API_KEY',
  'BREVO_SENDER_EMAIL',
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_PUBLIC_BUCKET',
  'CLOUDFLARE_R2_PRIVATE_BUCKET',
  'CLOUDFLARE_R2_PUBLIC_URL',
  'SUNAT_SECRETS_ENCRYPTION_KEY',
  'LOCAL_STORAGE_DIR',
  'METRICS_TOKEN',
] as const;

export function validateEnvironment(config: Record<string, unknown>) {
  if (config.NODE_ENV !== 'production') return config;

  const errors: string[] = [];
  for (const key of requiredProductionVariables) {
    const value = text(config[key]);
    if (!value) errors.push(`${key} es obligatorio`);
    else if (value.includes('REEMPLAZAR')) {
      errors.push(`${key} conserva un valor de ejemplo`);
    }
  }

  const hasDatabaseUrl = Boolean(text(config.DATABASE_URL));
  const hasDatabaseParts = [
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
  ].every((key) => Boolean(text(config[key])));
  if (!hasDatabaseUrl && !hasDatabaseParts) {
    errors.push('Configura DATABASE_URL o las variables DB_* completas');
  }
  if (text(config.DATABASE_URL).includes('REEMPLAZAR')) {
    errors.push('DATABASE_URL conserva un valor de ejemplo');
  }

  const jwtSecret = text(config.JWT_SECRET);
  if (
    jwtSecret &&
    (jwtSecret.length < 32 || jwtSecret === 'dev_secret_change_me')
  ) {
    errors.push('JWT_SECRET debe ser aleatorio y tener al menos 32 caracteres');
  }

  const origins = text(config.CORS_ORIGINS);
  if (
    origins === '*' ||
    origins?.split(',').some((origin) => !isHttpsUrl(origin))
  ) {
    errors.push(
      'CORS_ORIGINS debe contener solamente origenes HTTPS explicitos',
    );
  }

  const frontendUrl = text(config.FRONTEND_URL);
  if (frontendUrl && !isHttpsUrl(frontendUrl)) {
    errors.push('FRONTEND_URL debe usar HTTPS');
  }

  if (text(config.BREVO_ENABLED)?.toLowerCase() !== 'true') {
    errors.push('BREVO_ENABLED debe ser true');
  }

  if (text(config.SUNAT_GUIA_REMISION_MODE)?.toUpperCase() === 'SIMULATED') {
    errors.push(
      'SUNAT_GUIA_REMISION_MODE no puede ser SIMULATED en produccion',
    );
  }

  if (errors.length) {
    throw new Error(
      `Configuracion de produccion invalida:\n- ${errors.join('\n- ')}`,
    );
  }

  return config;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}
