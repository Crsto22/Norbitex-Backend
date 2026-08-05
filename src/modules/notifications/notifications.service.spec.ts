import { NotFoundException } from '@nestjs/common';
import { NotificacionNivel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('paginates a users notifications with totals', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(12);
    const service = new NotificationsService({
      notificacionDestinatario: { findMany, count },
    } as never);

    const result = await service.findMine(
      { sub: '1', roles: ['OWNER'] },
      { page: 2, limit: 10 },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 11 }),
    );
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
  });

  it('snapshots active recipients when publishing a manual notice', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      empresaUsuario: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ usuarioId: 10n }, { usuarioId: 20n }]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({
          notificacion: {
            create: jest.fn().mockResolvedValue({ id: 1n }),
          },
          notificacionDestinatario: { createMany },
        }),
      ),
    };
    const service = new NotificationsService(prisma as never);

    await service.publish(
      { sub: '1', roles: ['SUPERADMIN'] },
      {
        title: 'Mantenimiento programado',
        message: 'El sistema estara en mantenimiento.',
        level: NotificacionNivel.informacion,
        audience: 'todos',
      },
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { notificacionId: 1n, usuarioId: 10n },
        { notificacionId: 1n, usuarioId: 20n },
      ],
      skipDuplicates: true,
    });
  });

  it('does not mark another users notification as read', async () => {
    const prisma = {
      notificacionDestinatario: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new NotificationsService(prisma as never);

    await expect(
      service.markRead({ sub: '1', roles: ['OWNER'] }, '99'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
