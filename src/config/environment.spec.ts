import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('rechaza una configuracion insegura de produccion', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_SECRET: 'dev_secret_change_me',
        CORS_ORIGINS: '*',
        SUNAT_GUIA_REMISION_MODE: 'SIMULATED',
      }),
    ).toThrow('Configuracion de produccion invalida');
  });
});
