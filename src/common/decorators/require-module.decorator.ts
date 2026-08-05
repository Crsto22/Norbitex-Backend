import { SetMetadata } from '@nestjs/common';

export const requiredModuleKey = 'requiredModuleKey';

export const RequireModule = (...moduleKeys: string[]) =>
  SetMetadata(requiredModuleKey, moduleKeys);
