export interface LiveEvent {
  id: number;
  leadId: string;
  type: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export function createBus() {
  const listeners = new Set<(event: LiveEvent) => void>();
  return {
    publish(event: LiveEvent) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener: (event: LiveEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Bus = ReturnType<typeof createBus>;
