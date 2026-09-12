import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Hydration flag without an effect: the server snapshot is false, the client's is true.
const subscribe = () => () => {};
const useHasHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const hasHydrated = useHasHydrated();

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
