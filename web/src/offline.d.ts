export type OfflineMutation = {
  mutationId: string;
  type: 'upsert_history' | 'set_avoid';
  entityId: string;
  value: Record<string, unknown>;
};

export type QueuedMutation = {
  sequence: number;
  mutationId: string;
  mutation: OfflineMutation;
  createdAt: number;
  failure: string;
};

export type OfflineSnapshot = { state: unknown; revision: number; lastSyncedAt: number | null };
export function loadOfflineData(): Promise<{ snapshot: (OfflineSnapshot & { key: string }) | null; outbox: QueuedMutation[] }>;
export function saveRemoteSnapshot(snapshot: OfflineSnapshot): Promise<void>;
export function enqueueMutation(mutation: OfflineMutation): Promise<number>;
export function acknowledgeMutation(sequence: number, snapshot: OfflineSnapshot): Promise<void>;
export function markMutationFailed(sequence: number, failure: string): Promise<void>;
export function clearMutationFailure(sequence: number): Promise<void>;
export function clearRemoteSnapshot(): Promise<void>;
export function applyQueuedMutations<T>(state: T, entries: QueuedMutation[]): T;
