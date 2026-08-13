import { ResponseCacheService } from './response-cache.service';

describe('ResponseCacheService', () => {
  it('reuses cached values and clears them by prefix', async () => {
    const cache = new ResponseCacheService();
    const key = cache.key('catalog:colors:1', { page: 1, empresaId: 1n });
    const factory = jest.fn().mockResolvedValue({ value: 1 });

    await expect(cache.getOrSet(key, 60_000, factory)).resolves.toEqual({
      value: 1,
    });
    await expect(cache.getOrSet(key, 60_000, factory)).resolves.toEqual({
      value: 1,
    });
    cache.deletePrefix('catalog:colors:1');
    await cache.getOrSet(key, 60_000, factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
