import {
  clearTemporaryChat,
  createTemporaryChatMessage,
  loadTemporaryChat,
  MAX_CHAT_MESSAGE_BYTES,
  MAX_PROVIDER_CHAT_MESSAGES,
  providerConversation,
  saveTemporaryChat,
  temporaryChatStorageKey,
} from './temporaryChat';

describe('temporary AI chat', () => {
  const context = {
    dashboardUid: 'demo',
    panelId: 7,
    bindings: [],
    schemaFingerprint: 'fnv1a-a',
  };

  beforeEach(() => sessionStorage.clear());

  it('uses a fresh storage namespace after the assistant capability contract changes', () => {
    sessionStorage.setItem(
      'flint-ai-chat:v1:demo:7',
      JSON.stringify({
        version: 1,
        schemaFingerprint: context.schemaFingerprint,
        messages: [{ id: 'legacy', role: 'assistant', content: '当前权限：只读。', createdAt: 1 }],
      })
    );

    expect(temporaryChatStorageKey(context)).toBe('flint-ai-chat:v2:demo:7');
    expect(
      loadTemporaryChat(sessionStorage, temporaryChatStorageKey(context), context.schemaFingerprint).messages
    ).toEqual([]);
    expect(temporaryChatStorageKey({ ...context, dashboardUid: undefined })).toBeUndefined();
  });

  it('round-trips bounded messages and resets them when the schema changes', () => {
    const key = temporaryChatStorageKey(context);
    const messages = [createTemporaryChatMessage('user', 'show a waterfall', 1)];
    saveTemporaryChat(sessionStorage, key, context.schemaFingerprint, messages);

    expect(loadTemporaryChat(sessionStorage, key, context.schemaFingerprint).messages).toEqual(messages);
    expect(loadTemporaryChat(sessionStorage, key, 'fnv1a-b')).toEqual({
      messages: [],
      resetForSchemaChange: true,
    });
    expect(sessionStorage.getItem(key!)).toBeNull();
  });

  it('rejects oversized input and bounds provider history', () => {
    expect(() => createTemporaryChatMessage('user', 'x'.repeat(MAX_CHAT_MESSAGE_BYTES + 1))).toThrow(/UTF-8/);
    const messages = Array.from({ length: 15 }, (_, index) =>
      createTemporaryChatMessage(index % 2 ? 'assistant' : 'user', `message ${index}`, index)
    );
    expect(providerConversation(messages)).toHaveLength(MAX_PROVIDER_CHAT_MESSAGES);
    expect(providerConversation(messages)[0].content).toBe('message 5');
  });

  it('clears only the selected panel conversation', () => {
    const key = temporaryChatStorageKey(context)!;
    sessionStorage.setItem(key, '{}');
    sessionStorage.setItem('another', '{}');
    clearTemporaryChat(sessionStorage, key);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem('another')).toBe('{}');
  });
});
