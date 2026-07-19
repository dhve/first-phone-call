import { useSyncExternalStore } from 'react';
import { hostingService, type HostStatus } from './hostingService';

/** Subscribe a component to the hosting service's status. */
export function useHostingStatus(): HostStatus {
  return useSyncExternalStore(hostingService.subscribe, hostingService.getStatus);
}
