import type { FlintPanelContextSnapshot } from './panelContext';

export type TemporaryChatRole = 'user' | 'assistant';

export interface TemporaryChatMessage {
  id: string;
  role: TemporaryChatRole;
  content: string;
  createdAt: number;
}

interface TemporaryChatState {
  version: 2;
  schemaFingerprint: string;
  messages: TemporaryChatMessage[];
}

export interface TemporaryChatLoadResult {
  messages: TemporaryChatMessage[];
  resetForSchemaChange: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MAX_TEMPORARY_CHAT_MESSAGES = 20;
export const MAX_PROVIDER_CHAT_MESSAGES = 10;
export const MAX_CHAT_MESSAGE_BYTES = 4 * 1024;
export const MAX_TEMPORARY_CHAT_BYTES = 64 * 1024;
export const MAX_PROVIDER_CHAT_BYTES = 16 * 1024;

let messageSequence = 0;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isMessage(value: unknown): value is TemporaryChatMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const message = value as Partial<TemporaryChatMessage>;
  return (
    typeof message.id === 'string' &&
    message.id.length > 0 &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0 &&
    utf8Bytes(message.content) <= MAX_CHAT_MESSAGE_BYTES &&
    typeof message.createdAt === 'number' &&
    Number.isFinite(message.createdAt)
  );
}

function serializedState(schemaFingerprint: string, messages: TemporaryChatMessage[]): string {
  return JSON.stringify({ version: 2, schemaFingerprint, messages } satisfies TemporaryChatState);
}

function trimToBounds(
  messages: TemporaryChatMessage[],
  schemaFingerprint: string,
  maxMessages: number,
  maxBytes: number
): TemporaryChatMessage[] {
  const next = messages.filter(isMessage).slice(-maxMessages);
  while (next.length && utf8Bytes(serializedState(schemaFingerprint, next)) > maxBytes) {
    next.shift();
  }
  return next;
}

export function temporaryChatStorageKey(context?: FlintPanelContextSnapshot): string | undefined {
  if (!context?.dashboardUid || !Number.isInteger(context.panelId)) {
    return undefined;
  }
  return `flint-ai-chat:v2:${context.dashboardUid}:${context.panelId}`;
}

export function createTemporaryChatMessage(
  role: TemporaryChatRole,
  content: string,
  now = Date.now()
): TemporaryChatMessage {
  const normalized = content.trim();
  if (!normalized || utf8Bytes(normalized) > MAX_CHAT_MESSAGE_BYTES) {
    throw new Error(`Message must be between 1 and ${MAX_CHAT_MESSAGE_BYTES} UTF-8 bytes.`);
  }
  messageSequence += 1;
  return { id: `${now}-${messageSequence}`, role, content: normalized, createdAt: now };
}

export function loadTemporaryChat(
  storage: StorageLike | undefined,
  key: string | undefined,
  schemaFingerprint: string
): TemporaryChatLoadResult {
  if (!storage || !key) {
    return { messages: [], resetForSchemaChange: false };
  }
  try {
    const raw = storage.getItem(key);
    if (!raw || utf8Bytes(raw) > MAX_TEMPORARY_CHAT_BYTES) {
      return { messages: [], resetForSchemaChange: false };
    }
    const value = JSON.parse(raw) as Partial<TemporaryChatState>;
    if (value.version !== 2 || !Array.isArray(value.messages) || typeof value.schemaFingerprint !== 'string') {
      storage.removeItem(key);
      return { messages: [], resetForSchemaChange: false };
    }
    if (value.schemaFingerprint !== schemaFingerprint) {
      storage.removeItem(key);
      return { messages: [], resetForSchemaChange: true };
    }
    return {
      messages: trimToBounds(value.messages, schemaFingerprint, MAX_TEMPORARY_CHAT_MESSAGES, MAX_TEMPORARY_CHAT_BYTES),
      resetForSchemaChange: false,
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // sessionStorage is optional; quota and privacy failures must not break the editor.
    }
    return { messages: [], resetForSchemaChange: false };
  }
}

export function saveTemporaryChat(
  storage: StorageLike | undefined,
  key: string | undefined,
  schemaFingerprint: string,
  messages: TemporaryChatMessage[]
): TemporaryChatMessage[] {
  const bounded = trimToBounds(messages, schemaFingerprint, MAX_TEMPORARY_CHAT_MESSAGES, MAX_TEMPORARY_CHAT_BYTES);
  if (storage && key) {
    try {
      storage.setItem(key, serializedState(schemaFingerprint, bounded));
    } catch {
      // Keep the in-memory conversation when sessionStorage is unavailable.
    }
  }
  return bounded;
}

export function clearTemporaryChat(storage: StorageLike | undefined, key: string | undefined): void {
  if (!storage || !key) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // Clearing transient state should always be safe and best-effort.
  }
}

export function providerConversation(messages: TemporaryChatMessage[]): Array<{
  role: TemporaryChatRole;
  content: string;
}> {
  const schemaFingerprint = 'provider';
  return trimToBounds(messages, schemaFingerprint, MAX_PROVIDER_CHAT_MESSAGES, MAX_PROVIDER_CHAT_BYTES).map(
    ({ role, content }) => ({ role, content })
  );
}

export function getSessionStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
