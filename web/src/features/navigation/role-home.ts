import { Role, type StaffRole } from '@panter/contracts';

/** Panel de inicio de cada rol de personal (sección 5.3). Lo usará el middleware de HU de auth. */
export const STAFF_HOME: Record<StaffRole, `/${string}`> = {
  [Role.ADMIN]: '/admin',
  [Role.DISPATCHER]: '/despacho',
  [Role.TOUR_OPERATOR]: '/operador',
};

export const STAFF_PANEL_LABEL: Record<StaffRole, string> = {
  [Role.ADMIN]: 'Panel administrativo',
  [Role.DISPATCHER]: 'Consola de despacho',
  [Role.TOUR_OPERATOR]: 'Panel de operador turístico',
};

export const PUBLIC_HOME = '/';
export const LOGIN_PATH = '/login';
