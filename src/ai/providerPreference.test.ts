import {
  AI_PROVIDER_PREFERENCE_KEY,
  loadAiProviderPreference,
  saveAiProviderPreference,
} from './providerPreference';

describe('AI provider preference', () => {
  beforeEach(() => localStorage.clear());

  it('persists the last provider and restores it only while it remains available', () => {
    saveAiProviderPreference(localStorage, ' provider-b ');

    expect(localStorage.getItem(AI_PROVIDER_PREFERENCE_KEY)).toBe('provider-b');
    expect(loadAiProviderPreference(localStorage, ['provider-a', 'provider-b'])).toBe('provider-b');
  });

  it('discards a remembered provider that is no longer available', () => {
    localStorage.setItem(AI_PROVIDER_PREFERENCE_KEY, 'deleted-provider');

    expect(loadAiProviderPreference(localStorage, ['provider-a'])).toBeUndefined();
    expect(localStorage.getItem(AI_PROVIDER_PREFERENCE_KEY)).toBeNull();
  });
});
