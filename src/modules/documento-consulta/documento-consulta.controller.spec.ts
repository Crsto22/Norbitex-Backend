import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { DocumentoConsultaController } from './documento-consulta.controller';
import { DocumentoConsultaService } from './documento-consulta.service';

describe('DocumentoConsultaController', () => {
  let controller: DocumentoConsultaController;
  const service = {
    consultarDni: jest.fn(),
    consultarRuc: jest.fn(),
  };
  const user = { sub: '7', empresaId: '3', roles: ['OWNER'] };

  beforeEach(async () => {
    service.consultarDni.mockReset();
    service.consultarRuc.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentoConsultaController],
      providers: [{ provide: DocumentoConsultaService, useValue: service }],
    }).compile();

    controller = module.get(DocumentoConsultaController);
  });

  it('protege las rutas con el permiso de modulo', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      DocumentoConsultaController,
    ) as unknown;

    expect(guards).toContain(ModuleAccessGuard);
  });

  it('consulta DNI desde el servicio', async () => {
    const response = { success: true, dni: '12345678' };
    service.consultarDni.mockResolvedValue(response);

    await expect(controller.consultarDni(user, '12345678')).resolves.toBe(
      response,
    );
    expect(service.consultarDni).toHaveBeenCalledWith(user, '12345678');
  });

  it('consulta RUC desde el servicio', async () => {
    const response = { ruc: '20131312955', razonSocial: 'SUNAT' };
    service.consultarRuc.mockResolvedValue(response);

    await expect(controller.consultarRuc(user, '20131312955')).resolves.toBe(
      response,
    );
    expect(service.consultarRuc).toHaveBeenCalledWith(user, '20131312955');
  });
});
