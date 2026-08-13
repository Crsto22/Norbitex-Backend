import { Injectable } from '@nestjs/common';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

@Injectable()
export class ResponseCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private cleanupAt = 0;

  async getOrSet<T>(key: string, ttlMs: number, factory: () => Promise<T>) {
    const now = Date.now();
    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (entry && entry.expiresAt > now) {
      return entry.value;
    }

    const value = await factory();
    this.store.set(key, { value, expiresAt: now + ttlMs });
    this.cleanup(now);
    return value;
  }

  deletePrefix(prefix: string) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  key(prefix: string, ...parts: unknown[]) {
    return `${prefix}:${this.stringify(parts)}`;
  }

  private cleanup(now: number) {
    if (now < this.cleanupAt) return;
    this.cleanupAt = now + 60_000;

    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private stringify(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return item.toString();
      if (!item || typeof item !== 'object' || item instanceof Date) {
        return item;
      }

      if (Array.isArray(item)) return [...(item as unknown[])];

      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    });
  }
}
