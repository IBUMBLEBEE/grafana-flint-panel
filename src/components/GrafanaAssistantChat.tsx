import React, { useCallback, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, renderMarkdown } from '@grafana/data';
import { Button, Combobox, Spinner, TextArea, type ComboboxOption, useStyles2 } from '@grafana/ui';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';

import type { TemporaryChatMessage } from '../ai/temporaryChat';

export type AssistantBusyAction = 'chat' | 'generate';

interface GrafanaAssistantChatProps {
  messages: TemporaryChatMessage[];
  busy?: AssistantBusyAction;
  models: Array<ComboboxOption<string>>;
  selectedModel?: string;
  onModelChange: (model: string) => void;
  onSend: (content: string) => Promise<void>;
  onCancel: () => void;
  children?: React.ReactNode;
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  `,
  viewport: css`
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: ${theme.spacing(2)};
    scrollbar-width: thin;
  `,
  empty: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  message: css`
    margin-bottom: ${theme.spacing(2)};
    overflow-wrap: anywhere;
  `,
  assistantRow: css`
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: start;
    gap: ${theme.spacing(1)};
  `,
  avatar: css`
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid ${theme.colors.primary.border};
    border-radius: 50%;
    color: ${theme.colors.primary.text};
    background: ${theme.colors.primary.transparent};
    font-size: 10px;
    font-weight: ${theme.typography.fontWeightBold};
  `,
  role: css`
    margin-bottom: ${theme.spacing(0.5)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  messageBody: css`
    p {
      margin: 0;
    }
  `,
  userMessage: css`
    width: fit-content;
    max-width: 90%;
    margin-left: ${theme.spacing(3)};
    padding: ${theme.spacing(1)};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
    white-space: pre-wrap;
  `,
  scrollToBottom: css`
    position: sticky;
    bottom: 0;
    display: block;
    margin: ${theme.spacing(1)} auto 0;
  `,
  composer: css`
    padding: ${theme.spacing(1.5, 2)};
    border-top: 1px solid ${theme.colors.border.weak};
    background: ${theme.colors.background.secondary};
  `,
  input: css`
    min-height: 72px;
    max-height: 180px;
    resize: vertical;
  `,
  messageComposer: css`
    display: flex;
    flex-direction: column;
  `,
  composerFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(1)};
  `,
  modelSelector: css`
    min-width: 0;
    flex: 1 1 auto;
  `,
  messageActions: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  screenReaderOnly: css`
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `,
});

function messageToThreadMessage(message: TemporaryChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: [{ type: 'text', text: message.content }],
    createdAt: new Date(message.createdAt),
  };
}

function messageText(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

const AssistantText = ({ text }: { text: string }) => (
  <div className="markdown-html" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
);

const assistantMessageComponents = { Text: AssistantText };

const UserMessage = ({ styles }: { styles: ReturnType<typeof getStyles> }) => (
  <MessagePrimitive.Root className={styles.message}>
    <div className={styles.role}>You</div>
    <div className={`${styles.messageBody} ${styles.userMessage}`}>
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessage = ({ styles }: { styles: ReturnType<typeof getStyles> }) => (
  <MessagePrimitive.Root className={`${styles.message} ${styles.assistantRow}`}>
    <div className={styles.avatar} aria-hidden="true">
      AI
    </div>
    <div>
      <div className={styles.role}>AI Assist</div>
      <div className={styles.messageBody}>
        <MessagePrimitive.Parts components={assistantMessageComponents} />
      </div>
    </div>
  </MessagePrimitive.Root>
);

interface ComposerActionsProps extends Pick<
  GrafanaAssistantChatProps,
  'busy' | 'models' | 'selectedModel' | 'onModelChange'
> {
  styles: ReturnType<typeof getStyles>;
}

const ComposerActions = ({ styles, busy, models, selectedModel, onModelChange }: ComposerActionsProps) => {
  return (
    <div className={styles.messageComposer} role="group" aria-label="Message composer">
      <ComposerPrimitive.Input
        className={styles.input}
        aria-label="Message"
        placeholder="Ask about or refine this chart…"
        submitMode="enter"
        data-testid="flint-ai-prompt"
        render={<TextArea rows={3} />}
      />
      <div className={styles.composerFooter}>
        <div className={styles.modelSelector}>
          <span className={styles.screenReaderOnly} id="flint-ai-model-label">
            AI model
          </span>
          <Combobox
            id="flint-ai-model"
            aria-labelledby="flint-ai-model-label"
            options={models}
            value={selectedModel}
            placeholder="Choose model"
            prefixIcon="ai"
            width="auto"
            minWidth={14}
            maxWidth={28}
            disabled={Boolean(busy)}
            onChange={(model) => onModelChange(model.value)}
            noOptionsMessage="Configure a Flint AI datasource"
            data-testid="flint-ai-provider"
          />
        </div>
        <div className={styles.messageActions}>
          {busy === 'chat' && (
            <ComposerPrimitive.Cancel
              render={
                <Button size="sm" type="button" variant="secondary">
                  Cancel
                </Button>
              }
            />
          )}
          <ComposerPrimitive.Send
            render={
              <Button size="sm" type="submit" aria-label="Send message">
                {busy === 'chat' ? <Spinner /> : 'Send'}
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
};

export const GrafanaAssistantChat = ({
  messages,
  busy,
  models,
  selectedModel,
  onModelChange,
  onSend,
  onCancel,
  children,
}: GrafanaAssistantChatProps) => {
  const styles = useStyles2(getStyles);
  const onSendRef = useRef(onSend);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onSendRef.current = onSend;
    onCancelRef.current = onCancel;
  }, [onCancel, onSend]);

  const handleNew = useCallback(async (message: AppendMessage) => {
    const content = messageText(message);
    if (content) {
      await onSendRef.current(content);
    }
  }, []);
  const handleCancel = useCallback(async () => onCancelRef.current(), []);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: messageToThreadMessage,
    isRunning: busy === 'chat',
    isSendDisabled: Boolean(busy),
    onNew: handleNew,
    onCancel: handleCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className={styles.root} data-testid="flint-assistant-ui-thread">
        <ThreadPrimitive.Viewport
          className={styles.viewport}
          aria-live="polite"
          data-testid="flint-ai-chat-thread"
          autoScroll
        >
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className={styles.empty}>Describe the chart you want, or ask about the current data.</div>
          </AuiIf>
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === 'user' ? (
                <UserMessage styles={styles} />
              ) : message.role === 'assistant' ? (
                <AssistantMessage styles={styles} />
              ) : null
            }
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ScrollToBottom
            aria-label="Scroll to latest message"
            className={styles.scrollToBottom}
            render={
              <Button size="sm" type="button" variant="secondary">
                Latest
              </Button>
            }
          />
        </ThreadPrimitive.Viewport>

        {children}

        <ComposerPrimitive.Root className={styles.composer} data-testid="flint-ai-composer">
          <ComposerActions
            styles={styles}
            busy={busy}
            models={models}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
          />
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
};
