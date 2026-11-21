import { Redirect } from 'expo-router';
import { useSession } from '../features/auth/session/session-context';
import { groupHome } from '../navigation/group-home';
import { resolveRootGroup } from '../navigation/root-group';

/**
 * Respaldo para cualquier ruta que no exista o que no corresponda a la sesión (por ejemplo un
 * enlace `panter://` viejo): lleva a la pantalla principal del grupo activo en lugar de mostrar
 * la pantalla "Unmatched Route" de Expo Router.
 */
export default function NotFound() {
  const session = useSession();
  if (session.status === 'loading') return null;
  return <Redirect href={groupHome(resolveRootGroup(session))} />;
}
