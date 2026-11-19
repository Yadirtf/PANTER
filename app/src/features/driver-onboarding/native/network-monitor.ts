// Estado de la red con expo-network (módulo de Expo 58; equivale a NetInfo sin dependencia extra).
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import { isOnlineState } from '../upload/upload-policy';
import type { NetworkMonitor } from '../upload/upload-types';

export const expoNetworkMonitor: NetworkMonitor = {
  async isOnline() {
    return isOnlineState(await getNetworkStateAsync());
  },
  subscribe(listener) {
    const subscription = addNetworkStateListener((state) => listener(isOnlineState(state)));
    return () => subscription.remove();
  },
};
