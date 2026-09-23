import React, { useCallback, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import { Alert, Button, IconButton, Modal, Tooltip, useStyles2 } from '@grafana/ui';

import { buildDataHint } from '../ai/dataHint';
import { generateFlintOptionsFromAi } from '../ai/generateOptions';
import {
  buildPanelContextSnapshot,
  isSamePanelContext,
  loadCurrentPanelContextSnapshot,
  mergePanelContextSnapshots,
  subscribePanelQueryContext,
} from '../ai/panelContext';
import { getLocalStorage, loadAiProviderPreference, saveAiProviderPreference } from '../ai/providerPreference';
import { aiProviderClient, listAiProviders } from '../ai/providerClient';
import {
  clearTemporaryChat,
  createTemporaryChatMessage,
  getSessionStorage,
  loadTemporaryChat,
  providerConversation,
  saveTemporaryChat,
  temporaryChatStorageKey,
  type TemporaryChatMessage,
} from '../ai/temporaryChat';
import { proposalOwner, type SpecEditorStatus } from '../ai/proposalOwnership';
import {
  captureVizSnapshot,
  snapshotFingerprint,
  snapshotToPending,
  snapshotWithDraft,
  type FlintVizSnapshot,
} from '../flint/visualizationRevision';
import { RENDER_BACKENDS } from '../flint/backends';
import { clearFrameworkOverride } from '../flint/frameworkOverride';
import { preparePanelData } from '../flint/preparePanelData';
import {
  defaultAiConfig,
  defaultFlintOptions,
  FlintAiConfig,
  FlintOptions,
  sanitizeAiConfig,
  type FlintPendingViz,
} from '../types';
import { AiChartWorkbench } from './AiChartWorkbench';
import { GrafanaAssistantChat, type AssistantBusyAction } from './GrafanaAssistantChat';

interface UndoState {
  before: FlintVizSnapshot;
  appliedFingerprint: string;
  context: ReturnType<typeof buildPanelContextSnapshot>;
}

type PreviewState = { status: 'checking' | 'ready' | 'error'; error?: string };

const DEFAULT_PREVIEW_PANE_PERCENT = 60;
const MIN_PREVIEW_PANE_PERCENT = 30;
const MAX_PREVIEW_PANE_PERCENT = 70;

function clampPreviewPanePercent(value: number): number {
  return Math.min(MAX_PREVIEW_PANE_PERCENT, Math.max(MIN_PREVIEW_PANE_PERCENT, value));
}

const getStyles = (theme: GrafanaTheme2) => ({
  launcher: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
  secondaryText: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    line-height: ${theme.typography.bodySmall.lineHeight};
  `,
  modal: css`
    top: 32px;
    width: calc(100vw - 48px);
    max-width: 1400px;
    min-width: min(720px, calc(100vw - 64px));
    height: min(760px, calc(100vh - 64px));
    max-height: calc(100vh - 64px);
    min-height: min(520px, calc(100vh - 64px));
    overflow: hidden;
    resize: both;

    ${theme.breakpoints.down('sm')} {
      top: 0;
      width: 100vw;
      min-width: 0;
      height: 100vh;
      min-height: 0;
      max-height: 100vh;
      border-radius: 0;
      resize: none;
    }
  `,
  modalTitle: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    min-width: 0;
  `,
  modalContent: css`
    height: calc(100% - 50px);
    min-height: 0;
    margin-bottom: 0;
    padding: 0;
    overflow: hidden;
  `,
  workspace: css`
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;

    ${theme.breakpoints.down('md')} {
      flex-direction: column;
      overflow-y: auto;
    }
  `,
  previewPane: css`
    display: flex;
    flex: 0 0 var(--flint-preview-pane-width, 60%);
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: ${theme.colors.background.canvas};

    ${theme.breakpoints.down('md')} {
      flex-basis: auto;
      min-height: 460px;
      border-bottom: 1px solid ${theme.colors.border.weak};
    }
  `,
  paneSeparator: css`
    position: relative;
    z-index: 1;
    flex: 0 0 9px;
    width: 9px;
    padding: 0;
    border: 0;
    outline: none;
    cursor: col-resize;
    touch-action: none;
    background: ${theme.colors.background.primary};

    &::before {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 4px;
      width: 1px;
      content: '';
      background: ${theme.colors.border.weak};
      transition:
        background-color 0.15s ease,
        left 0.15s ease,
        width 0.15s ease;
    }

    &:hover::before,
    &:focus-visible::before,
    &:active::before {
      left: 3px;
      width: 3px;
      background: ${theme.colors.primary.border};
    }

    ${theme.breakpoints.down('md')} {
      display: none;
    }

    &[hidden] {
      display: none;
    }
  `,
  chatPane: css`
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: ${theme.colors.background.primary};

    ${theme.breakpoints.down('md')} {
      min-height: 520px;
    }

    &[hidden] {
      display: none;
    }
  `,
  paneHeader: css`
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(1, 2)};
    border-bottom: 1px solid ${theme.colors.border.weak};
  `,
  paneTitle: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  paneTitleRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  status: css`
    color: ${theme.colors.info.text};
    font-size: ${theme.typography.bodySmall.fontSize};
    white-space: nowrap;
  `,
  paneHeaderActions: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  proposal: css`
    margin: ${theme.spacing(0, 2, 1)};
    padding: ${theme.spacing(1.5)};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
  `,
  proposalHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(1)};
  `,
  proposalTitle: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  mapping: css`
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: ${theme.spacing(0.5, 1)};
    margin-bottom: ${theme.spacing(1)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  inlineActions: css`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
  `,
  chatAlert: css`
    margin: ${theme.spacing(0, 2, 1)};
  `,
});

function latestUserPrompt(messages: TemporaryChatMessage[]): string | undefined {
  return [...messages].reverse().find((message) => message.role === 'user')?.content;
}

/** Compact Panel-options launcher; the chart workspace lives in a Grafana Modal. */
export const AiAssistEditor: React.FC<StandardEditorProps<FlintAiConfig, unknown, FlintOptions>> = ({
  value,
  onChange,
  context,
}) => {
  const styles = useStyles2(getStyles);
  const ai = useMemo(() => sanitizeAiConfig(value ?? defaultAiConfig), [value]);
  const frames = useMemo(() => context.data ?? [], [context.data]);
  const hint = useMemo(() => buildDataHint(frames), [frames]);
  const prepared = useMemo(() => preparePanelData(frames), [frames]);
  const providers = useMemo(() => {
    try {
      return listAiProviders();
    } catch {
      return [];
    }
  }, []);
  const models = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.value,
        label: provider.description || provider.label,
        description: provider.description ? provider.label : undefined,
      })),
    [providers]
  );
  const availableProviderUids = useMemo(() => providers.map((provider) => provider.value), [providers]);
  const providerPreferenceStorage = getLocalStorage();
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<TemporaryChatMessage[]>([]);
  const [busy, setBusy] = useState<AssistantBusyAction>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState<FlintPendingViz | undefined>(ai.draft);
  const [preview, setPreview] = useState<PreviewState>({ status: ai.draft ? 'checking' : 'ready' });
  const [undo, setUndo] = useState<UndoState>();
  const [savedPanelContext, setSavedPanelContext] = useState<ReturnType<typeof buildPanelContextSnapshot>>();
  const [previewPanePercent, setPreviewPanePercent] = useState(DEFAULT_PREVIEW_PANE_PERCENT);
  const [isChatOpen, setChatOpen] = useState(true);
  const [specEditorStatus, setSpecEditorStatus] = useState<SpecEditorStatus>('pristine');
  const [specEditorResetVersion, setSpecEditorResetVersion] = useState(0);
  const [preferredProviderUid, setPreferredProviderUid] = useState(() =>
    loadAiProviderPreference(providerPreferenceStorage, availableProviderUids)
  );
  const [, setPanelContextVersion] = useState(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const generatedPromptRef = useRef(ai.lastPrompt);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const selectedRenderBackend =
    draft?.renderBackend ?? context.options?.renderBackend ?? defaultFlintOptions.renderBackend;
  const committedRenderBackend = context.options?.renderBackend || defaultFlintOptions.renderBackend;
  const committedChartType = context.options?.chartType || defaultFlintOptions.chartType;
  const committedBackendLabel =
    RENDER_BACKENDS.find((item) => item.value === committedRenderBackend)?.label.replace(' (default)', '') ??
    committedRenderBackend;
  const committedChartLabel = committedChartType === 'auto' ? 'Auto' : committedChartType;

  React.useEffect(() => {
    if (!context.eventBus) {
      return;
    }
    return subscribePanelQueryContext(context.eventBus, () => setPanelContextVersion((version) => version + 1), frames);
  }, [context.eventBus, frames]);

  React.useEffect(() => {
    let active = true;
    void loadCurrentPanelContextSnapshot(frames)
      .then((snapshot) => active && setSavedPanelContext(snapshot))
      .catch(() => active && setSavedPanelContext(undefined));
    return () => {
      active = false;
    };
  }, [frames]);

  // Rebuild on every render so async provenance notifications cannot be hidden
  // behind stable eventBus/frame references.
  const runtimePanelContext = buildPanelContextSnapshot(frames, context.eventBus);
  const panelContext = mergePanelContextSnapshots(savedPanelContext, runtimePanelContext);
  const storage = getSessionStorage();
  const storageKey = temporaryChatStorageKey(panelContext);
  const selectedProviderUid = preferredProviderUid ?? ai.providerUid;
  const schemaFingerprint = panelContext?.schemaFingerprint ?? 'unbound';
  const draftIsStale = Boolean(draft && !isSamePanelContext(draft.context, panelContext));
  const specEditorBlocksApply =
    specEditorStatus === 'checking' || specEditorStatus === 'invalid' || specEditorStatus === 'stale';
  const currentProposalOwner = proposalOwner(draft, specEditorStatus);
  const canApplyDraft = Boolean(draft && !draftIsStale && preview.status === 'ready' && !specEditorBlocksApply);

  React.useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      const loaded = loadTemporaryChat(storage, storageKey, schemaFingerprint);
      setMessages(loaded.messages);
      if (loaded.resetForSchemaChange) {
        setNotice('The query schema changed, so the temporary conversation was reset.');
      }
    });
    return () => {
      active = false;
    };
  }, [schemaFingerprint, storage, storageKey]);

  React.useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  React.useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updatePreview = useCallback((status: PreviewState['status'], previewError?: string) => {
    setPreview((current) =>
      current.status === status && current.error === previewError ? current : { status, error: previewError }
    );
  }, []);

  const commitMessages = (next: TemporaryChatMessage[]) => {
    const bounded = saveTemporaryChat(storage, storageKey, schemaFingerprint, next);
    setMessages(bounded);
    return bounded;
  };

  const appendMessage = (role: 'user' | 'assistant', content: string, base = messages) => {
    return commitMessages([...base, createTemporaryChatMessage(role, content)]);
  };

  const cancelRequest = () => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setBusy(undefined);
  };

  const requireProvider = () => {
    if (!selectedProviderUid) {
      setError('Choose a Flint AI provider first.');
      return false;
    }
    return true;
  };

  const sendChat = async (message: string) => {
    const content = message.trim();
    if (!content || !requireProvider()) {
      return;
    }
    let next: TemporaryChatMessage[];
    try {
      next = appendMessage('user', content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy('chat');
    setError(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await aiProviderClient.chat(
        selectedProviderUid!,
        {
          messages: providerConversation(next),
          panelContext: {
            fields: prepared.table.fields.map((field) => ({ name: field.name, type: String(field.type) })),
            dataHint: hint.summary,
            renderBackend: selectedRenderBackend,
          },
        },
        controller.signal
      );
      appendMessage('assistant', response.message, next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = undefined;
        setBusy(undefined);
      }
    }
  };

  const stageDraft = (nextDraft: FlintPendingViz) => {
    setSpecEditorResetVersion((version) => version + 1);
    setSpecEditorStatus('pristine');
    setDraft(nextDraft);
    setPreview({ status: 'checking' });
    setError(undefined);
  };

  const stageManualSpecDraft = (nextDraft: FlintPendingViz) => {
    setDraft(nextDraft);
    setError(undefined);
  };

  const discardDraft = (restoreDraft?: FlintPendingViz) => {
    setSpecEditorResetVersion((version) => version + 1);
    setSpecEditorStatus('pristine');
    setDraft(restoreDraft);
    setPreview({ status: restoreDraft ? 'checking' : 'ready' });
    setNotice(restoreDraft ? 'Discarded manual edits and restored the previous proposal.' : 'Discarded the proposal.');
  };

  const generateChart = async () => {
    const prompt = latestUserPrompt(messages);
    if (!prompt) {
      setError('Send a chart request before generating a proposal.');
      return;
    }
    if (!requireProvider() || !frames.length) {
      if (!frames.length) {
        setError('Run the Panel query before generating a chart.');
      }
      return;
    }
    if (
      !panelContext ||
      panelContext.bindings.length !== frames.length ||
      panelContext.bindings.some((item) => !item.datasource)
    ) {
      setError('Wait for Grafana to resolve every Panel query datasource before generating a chart.');
      return;
    }
    generatedPromptRef.current = prompt;
    setBusy('generate');
    setError(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const generated = await generateFlintOptionsFromAi({
        providerUid: selectedProviderUid!,
        frames,
        userPrompt: prompt,
        renderBackend: selectedRenderBackend,
        conversation: providerConversation(messages),
        signal: controller.signal,
      });
      stageDraft({
        renderBackend: selectedRenderBackend,
        chartType: generated.chartType,
        xField: generated.xField,
        yField: generated.yField,
        colorField: generated.colorField,
        specJson: generated.specJson,
        frameworkOverrides: clearFrameworkOverride(context.options?.frameworkOverrides, selectedRenderBackend),
        rationale: generated.rationale || 'AI-generated Flint proposal.',
        context: panelContext,
        source: 'provider',
      });
      appendMessage(
        'assistant',
        [
          `Prepared a ${generated.chartType} proposal.`,
          generated.fallbackReason,
          generated.repairAttempts && !generated.fallbackReason
            ? `The advanced Flint input compiled after ${generated.repairAttempts} repair attempt.`
            : undefined,
          'Review the live preview, then Apply or Discard it.',
        ]
          .filter(Boolean)
          .join(' '),
        messages
      );
      if (generated.fallbackReason) {
        setNotice(generated.fallbackReason);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = undefined;
        setBusy(undefined);
      }
    }
  };

  const applyDraft = () => {
    if (!draft || !isSamePanelContext(draft.context, panelContext)) {
      setError('This proposal is stale because the Panel query or schema changed.');
      return;
    }
    if (!context.options || preview.status !== 'ready') {
      setError('Wait for the live preview to render successfully before applying it.');
      return;
    }
    if (specEditorBlocksApply) {
      setError('Fix and validate the current Spec revision before applying it.');
      return;
    }
    setUndo({
      before: captureVizSnapshot(context.options),
      appliedFingerprint: snapshotFingerprint(snapshotWithDraft(context.options, draft)),
      context: panelContext,
    });
    setSpecEditorResetVersion((version) => version + 1);
    setSpecEditorStatus('pristine');
    setDraft(undefined);
    onChange({ ...ai, lastPrompt: generatedPromptRef.current, draft: undefined, pending: draft });
    setNotice('Applied the proposal to Panel options.');
  };

  const undoApply = () => {
    if (
      !undo ||
      !context.options ||
      snapshotFingerprint(captureVizSnapshot(context.options)) !== undo.appliedFingerprint ||
      !isSamePanelContext(undo.context, panelContext)
    ) {
      setError('Undo is no longer available because the Panel configuration or query schema changed.');
      return;
    }
    onChange({ ...ai, draft: undefined, pending: snapshotToPending(undo.before, panelContext) });
    setUndo(undefined);
    setNotice('Restoring the visualization from before the last AI Apply.');
  };

  const dismissStudio = () => {
    const hasUncommittedWork = Boolean(draft) || specEditorStatus !== 'pristine';
    if (
      hasUncommittedWork &&
      !window.confirm('Discard the current chart proposal or Spec edits and close AI Chart Studio?')
    ) {
      return;
    }
    cancelRequest();
    if (hasUncommittedWork) {
      setSpecEditorResetVersion((version) => version + 1);
      setSpecEditorStatus('pristine');
      setDraft(undefined);
      setPreview({ status: 'ready' });
    }
    setOpen(false);
  };

  const previewLabel = draft
    ? preview.status === 'ready'
      ? 'Preview ready'
      : preview.status === 'error'
        ? 'Preview failed'
        : 'Building preview'
    : 'Current Panel';

  const resizeFromPointer = (clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds?.width) {
      return;
    }
    setPreviewPanePercent(clampPreviewPanePercent(((clientX - bounds.left) / bounds.width) * 100));
  };

  const resizeFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 2;
    let nextPercent: number | undefined;

    if (event.key === 'ArrowLeft') {
      nextPercent = previewPanePercent - step;
    } else if (event.key === 'ArrowRight') {
      nextPercent = previewPanePercent + step;
    } else if (event.key === 'Home') {
      nextPercent = MIN_PREVIEW_PANE_PERCENT;
    } else if (event.key === 'End') {
      nextPercent = MAX_PREVIEW_PANE_PERCENT;
    }

    if (nextPercent !== undefined) {
      event.preventDefault();
      setPreviewPanePercent(clampPreviewPanePercent(nextPercent));
    }
  };

  return (
    <div className={styles.launcher} data-testid="flint-ai-assist">
      <Button type="button" onClick={() => setOpen(true)} data-testid="flint-ai-open-studio" fullWidth>
        Open AI Chart Studio
      </Button>
      <Tooltip content={hint.querySummary} placement="bottom-start">
        <div className={styles.secondaryText} data-testid="flint-ai-current-chart">
          Current chart: {committedChartLabel} · {committedBackendLabel}
        </div>
      </Tooltip>

      <Modal
        title={
          <div className={styles.modalTitle}>
            <span>AI Chart Studio</span>
            <IconButton
              name="info-circle"
              size="sm"
              type="button"
              tooltip="Uses the current Grafana Panel. Drag the divider to resize the panes, or the lower-right corner to resize the dialog."
              tooltipPlacement="bottom-start"
            />
          </div>
        }
        ariaLabel="AI Chart Studio"
        isOpen={isOpen}
        onDismiss={dismissStudio}
        className={styles.modal}
        contentClassName={styles.modalContent}
      >
        <div
          ref={workspaceRef}
          className={styles.workspace}
          data-testid="flint-ai-studio"
          style={
            {
              '--flint-preview-pane-width': isChatOpen ? `${previewPanePercent}%` : '100%',
            } as React.CSSProperties
          }
        >
          <section id="flint-chart-workbench-pane" className={styles.previewPane} aria-label="Live preview">
            <AiChartWorkbench
              key={specEditorResetVersion}
              frames={frames}
              options={context.options}
              draft={draft}
              querySummary={hint.querySummary}
              previewLabel={previewLabel}
              panelContext={panelContext}
              specDraftControls={{
                canApply: canApplyDraft,
                onDraftChange: stageManualSpecDraft,
                onStatusChange: setSpecEditorStatus,
                onApply: applyDraft,
                onDiscard: discardDraft,
              }}
              isChatOpen={isChatOpen}
              onToggleChat={() => setChatOpen((current) => !current)}
              onPreviewStatusChange={updatePreview}
            />
          </section>

          <div
            className={styles.paneSeparator}
            hidden={!isChatOpen}
            role="separator"
            aria-label="Resize Chart workbench and AI Chat"
            aria-controls="flint-chart-workbench-pane flint-ai-chat-pane"
            aria-orientation="vertical"
            aria-valuemin={MIN_PREVIEW_PANE_PERCENT}
            aria-valuemax={MAX_PREVIEW_PANE_PERCENT}
            aria-valuenow={Math.round(previewPanePercent)}
            aria-valuetext={`Chart workbench ${Math.round(previewPanePercent)} percent`}
            tabIndex={0}
            onDoubleClick={() => setPreviewPanePercent(DEFAULT_PREVIEW_PANE_PERCENT)}
            onKeyDown={resizeFromKeyboard}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeFromPointer(event.clientX);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                resizeFromPointer(event.clientX);
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          />

          <section
            id="flint-ai-chat-pane"
            className={styles.chatPane}
            aria-label="AI chat and proposal controls"
            hidden={!isChatOpen}
          >
            <header className={styles.paneHeader}>
              <div className={styles.paneTitleRow}>
                <div className={styles.paneTitle}>AI Chat</div>
                <IconButton
                  name="info-circle"
                  size="sm"
                  type="button"
                  tooltip="Uses the current Panel context. Send is advisory; Generate proposal uses the sent conversation."
                  tooltipPlacement="bottom-start"
                />
              </div>
              <div className={styles.paneHeaderActions}>
                {busy === 'generate' ? (
                  <Button size="sm" type="button" variant="secondary" onClick={cancelRequest}>
                    Cancel generation
                  </Button>
                ) : (
                  <Tooltip
                    content="Generate a reviewable chart proposal from the sent conversation."
                    placement="bottom"
                  >
                    <Button
                      size="sm"
                      type="button"
                      icon="ai-sparkle"
                      aria-label="Generate chart proposal"
                      disabled={!frames.length || !latestUserPrompt(messages) || Boolean(busy)}
                      onClick={() => void generateChart()}
                      data-testid="flint-ai-generate"
                    >
                      Generate proposal
                    </Button>
                  </Tooltip>
                )}
                {undo && (
                  <IconButton
                    name="history"
                    tooltip="Undo last apply"
                    aria-label="Undo last apply"
                    type="button"
                    onClick={undoApply}
                    data-testid="flint-ai-undo-apply"
                  />
                )}
                <IconButton
                  name="trash-alt"
                  tooltip="Clear chat"
                  aria-label="Clear chat"
                  type="button"
                  disabled={Boolean(busy) || messages.length === 0}
                  onClick={() => {
                    clearTemporaryChat(storage, storageKey);
                    setMessages([]);
                    setNotice('Cleared the temporary conversation.');
                  }}
                />
              </div>
            </header>

            <GrafanaAssistantChat
              messages={messages}
              busy={busy}
              models={models}
              selectedModel={selectedProviderUid}
              onModelChange={(providerUid) => {
                saveAiProviderPreference(providerPreferenceStorage, providerUid);
                setPreferredProviderUid(providerUid);
                onChange({ ...ai, providerUid, pending: undefined });
                setError(undefined);
              }}
              onSend={sendChat}
              onCancel={cancelRequest}
            >
              {draft && currentProposalOwner === 'chat' && (
                <aside className={styles.proposal} aria-label="Current chart proposal" data-testid="flint-ai-proposal">
                  <div className={styles.proposalHeader}>
                    <div className={styles.paneTitleRow}>
                      <div className={styles.proposalTitle}>
                        {draft.chartType} ·{' '}
                        {RENDER_BACKENDS.find((item) => item.value === selectedRenderBackend)?.label ??
                          selectedRenderBackend}
                      </div>
                      {draft.rationale && (
                        <IconButton
                          name="info-circle"
                          size="sm"
                          type="button"
                          tooltip={draft.rationale}
                          tooltipPlacement="bottom-start"
                        />
                      )}
                    </div>
                    <span className={styles.status}>{previewLabel}</span>
                  </div>
                  <div className={styles.mapping}>
                    <span>X</span>
                    <span>{draft.xField || 'Auto'}</span>
                    <span>Y</span>
                    <span>{draft.yField || 'Auto'}</span>
                    <span>Color</span>
                    <span>{draft.colorField || 'None'}</span>
                  </div>
                  <div className={styles.inlineActions}>
                    <Button
                      size="sm"
                      type="button"
                      onClick={applyDraft}
                      disabled={!canApplyDraft}
                      data-testid="flint-ai-apply-draft"
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => discardDraft()}
                      data-testid="flint-ai-discard-draft"
                    >
                      Discard
                    </Button>
                  </div>
                </aside>
              )}

              {draftIsStale && currentProposalOwner === 'chat' && (
                <div className={styles.chatAlert}>
                  <Alert title="Proposal is stale" severity="warning">
                    The Panel query or field schema changed. Generate a new proposal before Apply.
                  </Alert>
                </div>
              )}
              {preview.status === 'error' && preview.error && (
                <div className={styles.chatAlert}>
                  <Alert title="Preview failed" severity="error">
                    {preview.error}
                  </Alert>
                </div>
              )}
              {error && (
                <div className={styles.chatAlert}>
                  <Alert title="AI Assist error" severity="error">
                    {error}
                  </Alert>
                </div>
              )}
              {notice && (
                <div className={styles.chatAlert}>
                  <Alert title="AI Chart Studio" severity="info" onRemove={() => setNotice(undefined)}>
                    {notice}
                  </Alert>
                </div>
              )}
            </GrafanaAssistantChat>
          </section>
        </div>
      </Modal>
    </div>
  );
};
