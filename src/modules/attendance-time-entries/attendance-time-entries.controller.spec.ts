import { requiredModuleKey } from '../../common/decorators/require-module.decorator';
import { AttendanceTimeEntriesController } from './attendance-time-entries.controller';

describe('AttendanceTimeEntriesController', () => {
  it('protege el historial con el modulo separado', () => {
    const handler = Object.getOwnPropertyDescriptor(
      AttendanceTimeEntriesController.prototype,
      'findHistory',
    )?.value as unknown;
    const modules = Reflect.getMetadata(requiredModuleKey, handler) as string[];

    expect(modules).toEqual(['asistencias-historial-marcaciones']);
  });
});
