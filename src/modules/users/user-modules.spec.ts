import { userModuleKeySet, userModuleMap } from './user-modules';

describe('userModules', () => {
  it('registers nota-debito as an assignable tenant module', () => {
    expect(userModuleKeySet.has('nota-debito')).toBe(true);
    expect(userModuleMap.get('nota-debito')).toEqual({
      key: 'nota-debito',
      label: 'Nota de debito',
      route: '/facturacion/nota-debito',
    });
  });
});
