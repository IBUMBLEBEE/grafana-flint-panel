interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AI_PROVIDER_PREFERENCE_KEY = 'flint-ai-provider:v1';

export function loadAiProviderPreference(
  storage: StorageLike | undefined,
  availableProviderUids: string[]
): string | undefined {
  if (!storage) {
    return undefined;
  }
  try {
    const providerUid = storage.getItem(AI_PROVIDER_PREFERENCE_KEY)?.trim();
    if (!providerUid) {
      return undefined;
    }
    const available = new Set(availableProviderUids.map((uid) => uid.trim()).filter(Boolean));
    if (!available.has(providerUid)) {
      if (available.size > 0) {
        storage.removeItem(AI_PROVIDER_PREFERENCE_KEY);
      }
      return undefined;
    }
    return providerUid;
  } catch {
    return undefined;
  }
}

export function saveAiProviderPreference(storage: StorageLike | undefined, providerUid: string): void {
  const normalized = providerUid.trim();
  if (!storage || !normalized) {
    return;
  }
  try {
    storage.setItem(AI_PROVIDER_PREFERENCE_KEY, normalized);
  } catch {
    // Browser storage is optional; selecting a provider must still work without it.
  }
}

export function getLocalStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
