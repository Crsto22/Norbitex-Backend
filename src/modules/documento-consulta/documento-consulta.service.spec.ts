import { BadRequestException } from '@nestjs/common';
import { DocumentoConsultaService } from './documento-consulta.service';

describe('DocumentoConsultaService', () => {
  let service: DocumentoConsultaService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const user = { sub: '7', empresaId: '3', roles: ['OWNER'] };
  const plansService = { recordDocumentQuery: jest.fn() };

  beforeEach(() => {
    plansService.recordDocumentQuery.mockReset().mockResolvedValue({
      used: 1,
      limit: 10,
      remaining: 9,
    });
    service = new DocumentoConsultaService(
      { get: () => undefined } as never,
      plansService as never,
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('rechaza DNI invalido', async () => {
    await expect(service.consultarDni(user, '123')).rejects.toThrow(
      new BadRequestException('DNI invalido'),
    );
  });

  it('rechaza RUC invalido', async () => {
    await expect(service.consultarRuc(user, 'abc')).rejects.toThrow(
      new BadRequestException('RUC invalido'),
    );
  });

  it('convierte respuesta SUNAT de DNI en nombres y apellidos', async () => {
    mockSunatResponse({
      message: 'success',
      lista: [{ nombresapellidos: 'DE LA CRUZ SAN MARTIN, JUAN CARLOS' }],
    });

    await expect(service.consultarDni(user, '12345678')).resolves.toEqual({
      success: true,
      dni: '12345678',
      nombres: 'JUAN CARLOS',
      apellidoPaterno: 'DE LA CRUZ',
      apellidoMaterno: 'SAN MARTIN',
      codVerifica: null,
      codVerificaLetra: null,
    });
    expect(plansService.recordDocumentQuery).toHaveBeenCalledWith(
      3n,
      7n,
      'dni',
    );
  });

  it('convierte respuesta SUNAT de RUC en razon social, direccion y ubigeo', async () => {
    mockSunatResponse({
      message: 'success',
      lista: [
        {
          apenomdenunciado: 'EMPRESA DEMO S.A.C.   ',
          direstablecimiento: ' AV. LIMA 123 ',
          desdepartamento: 'LIMA ',
          desprovincia: ' LIMA',
          desdistrito: ' MIRAFLORES ',
          iddepartamento: '15',
          idprovincia: '01',
          iddistrito: '22',
        },
      ],
    });

    await expect(service.consultarRuc(user, '20131312955')).resolves.toEqual({
      ruc: '20131312955',
      razonSocial: 'EMPRESA DEMO S.A.C.',
      nombreComercial: null,
      telefonos: [],
      tipo: null,
      estado: null,
      condicion: null,
      direccion: 'AV. LIMA 123',
      departamento: 'LIMA',
      provincia: 'LIMA',
      distrito: 'MIRAFLORES',
      ubigeo: '150122',
      capital: null,
    });
  });

  it('propaga error devuelto por SUNAT', async () => {
    mockSunatResponse({
      error: 'No existen datos para los filtros seleccionados',
    });

    await expect(service.consultarDni(user, '12345678')).rejects.toThrow(
      'No existen datos para los filtros seleccionados',
    );
    expect(plansService.recordDocumentQuery).not.toHaveBeenCalled();
  });

  it('propaga error cuando lista esta vacia', async () => {
    mockSunatResponse({ message: 'success', lista: [] });

    await expect(service.consultarRuc(user, '20131312955')).rejects.toThrow(
      'No se pudo obtener informacion para el RUC 20131312955',
    );
    expect(plansService.recordDocumentQuery).not.toHaveBeenCalled();
  });

  function mockSunatResponse(body: unknown) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
});
