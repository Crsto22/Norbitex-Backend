export type JwtPayload = {
  sub: string;
  empresaId?: string;
  empresaUsuarioId?: string;
  roles: string[];
  nombre?: string;
  apellido?: string | null;
  email?: string;
  refreshTokenVersion?: number;
};