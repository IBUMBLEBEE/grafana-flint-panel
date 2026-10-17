import React, { useCallback, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import { Alert, Button, IconButton, Modal, ToolbarButton, Tooltip, useStyles2 } from '@grafana/ui';
import { config } from '@grafana/runtime';

import { buildDataHint } from '../ai/dataHint';
import {
  chartHistoryContext,
  chartHistoryKey,
  isRestoreRequest,
  loadChartHistory,
  prepareChartRestore,
  recordChartApplication,
  saveChartHistory,
  type ChartRevision,
} from '../ai/chartHistory';
import { buildAiDiagnosticReport, createAiDiagnostics, downloadAiDiagnostics } from '../ai/diagnostics';
import { generateFlintOptionsFromAi } from '../ai/generateOptions';
import {
  buildPanelContextSnapshot,
  isSamePanelContext,
  loadCurrentPanelContextSnapshot,
  mergePanelContextSnapshots,
  subscribePanelQueryContext,
} from '../ai/panelContext';
import { getLocalStorage, loadAiProviderPreference, saveAiProviderPreference } from '../ai/providerPreference';
import { aiProviderClient, listAiProviders, type ProposalPlan } from '../ai/providerClient';
import { planProposalFromAi, proposalChatContext } from '../ai/proposalPlan';
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
  snapshotWithDraft,
  type FlintVizSnapshot,
} from '../flint/visualizationRevision';
import { RENDER_BACKENDS } from '../flint/backends';
import { chartSettings, toChartState } from '../flint/chartState';
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
    flex: 1 1 auto;
    width: calc(100% - 32px);
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    min-width: 0;
  `,
  chatToggle: css`
    margin-left: auto;
    margin-right: ${theme.spacing(2)};
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
  modeControls: css`
    flex: 0 0 auto;
    padding: ${theme.spacing(1, 2)};
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
    flex-wrap: wrap;
    justify-content: flex-end;
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
  const diagnostics = useMemo(() => createAiDiagnostics(aiProviderClient), []);
  const [notice, setNotice] = useState<string>();
  const [workbenchNotice, setWorkbenchNotice] = useState<string>();
  const [workbenchError, setWorkbenchError] = useState<string>();
  const [draft, setDraft] = useState<FlintPendingViz | undefined>(ai.draft);
  const [preview, setPreview] = useState<PreviewState>({ status: ai.draft ? 'checking' : 'ready' });
  const [history, setHistory] = useState<ChartRevision[]>([]);
  const [restoreConversation, setRestoreConversation] = useState(false);
  const [savedPanelContext, setSavedPanelContext] = useState<ReturnType<typeof buildPanelContextSnapshot>>();
  const [previewPanePercent, setPreviewPanePercent] = useState(DEFAULT_PREVIEW_PANE_PERCENT);
  const [isChatOpen, setChatOpen] = useState(providers.length > 0);
  const [proposalPlan, setProposalPlan] = useState<ProposalPlan>();
  const [specEditorStatus, setSpecEditorStatus] = useState<SpecEditorStatus>('pristine');
  const [specEditorResetVersion, setSpecEditorResetVersion] = useState(0);
  const [preferredProviderUid, setPreferredProviderUid] = useState(() =>
    loadAiProviderPreference(providerPreferenceStorage, availableProviderUids)
  );
  const [, setPanelContextVersion] = useState(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const sourceEditRevisionRef = useRef(0);
  const latestChartRef = useRef({
    committed: '',
    effective: '',
    panelContext: undefined as ReturnType<typeof buildPanelContextSnapshot>,
  });
  const generatedPromptRef = useRef(ai.lastPrompt);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const selectedRenderBackend =
    draft?.renderBackend ?? context.options?.renderBackend ?? defaultFlintOptions.renderBackend;
  const committedRenderBackend = context.options?.renderBackend || defaultFlintOptions.renderBackend;
  const committedChartType = chartSettings(toChartState(context.options)).chartType;
  const proposalSettings = draft ? chartSettings(toChartState(draft)) : undefined;
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
  const historyKey = chartHistoryKey(panelContext);
  const selectedProviderUid = preferredProviderUid ?? ai.providerUid;
  const schemaFingerprint = panelContext?.schemaFingerprint ?? 'unbound';
  const committedFingerprint = snapshotFingerprint(captureVizSnapshot(context.options ?? defaultFlintOptions));
  const effectiveFingerprint = snapshotFingerprint(
    draft
      ? snapshotWithDraft(context.options ?? defaultFlintOptions, draft)
      : captureVizSnapshot(context.options ?? defaultFlintOptions)
  );
  React.useLayoutEffect(() => {
    latestChartRef.current = { committed: committedFingerprint, effective: effectiveFingerprint, panelContext };
  });
  const draftIsStale = Boolean(
    draft &&
    (!isSamePanelContext(draft.context, panelContext) ||
      (draft.baseFingerprint !== undefined && draft.baseFingerprint !== committedFingerprint))
  );
  const specEditorBlocksApply =
    specEditorStatus === 'checking' || specEditorStatus === 'invalid' || specEditorStatus === 'stale';
  const currentProposalOwner = proposalOwner(draft, specEditorStatus);
  const canApplyDraft = Boolean(draft && !draftIsStale && preview.status === 'ready' && !specEditorBlocksApply);
  const restoreContext = chartHistoryContext(
    history,
    captureVizSnapshot(context.options ?? defaultFlintOptions),
    panelContext
  );

  React.useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setHistory(loadChartHistory(storage, historyKey));
        setRestoreConversation(false);
      }
    });
    return () => {
      active = false;
    };
  }, [storage, historyKey]);

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
    if (!notice && !workbenchNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setNotice(undefined);
      setWorkbenchNotice(undefined);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [notice, workbenchNotice]);

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

  React.useEffect(() => {
    const head = history.at(-1);
    if (
      !head ||
      head.confirmed !== false ||
      committedFingerprint !== snapshotFingerprint(head.snapshot) ||
      !isSamePanelContext(head.context, panelContext)
    ) {
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      const next = history.map((revision) => (revision.id === head.id ? { ...revision, confirmed: true } : revision));
      setHistory(next);
      saveChartHistory(storage, historyKey, next);
      if (head.notificationTarget === 'workbench') {
        setNotice(undefined);
        setWorkbenchNotice('Applied the changes to Panel options. Dashboard changes still require Save.');
      } else {
        setWorkbenchNotice(undefined);
        appendMessage(
          'assistant',
          `${head.action === 'restored' ? 'Restored' : 'Applied'} ${head.label} to Panel options. Dashboard changes still require Save.`,
          messages
        );
        setNotice('Applied the proposal to Panel options.');
      }
    });
    return () => {
      active = false;
    };
    // The current chat is captured when the matching committed revision is observed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedFingerprint, history, historyKey, storage, panelContext]);

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
    setProposalPlan(undefined);
    setError(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (isRestoreRequest(content) || restoreConversation) {
        setRestoreConversation(true);
        const baseline = { ...latestChartRef.current, revision: sourceEditRevisionRef.current };
        const plan = await planProposalFromAi({
          providerUid: selectedProviderUid!,
          frames,
          currentChartState: captureVizSnapshot(context.options ?? defaultFlintOptions),
          conversation: providerConversation(next),
          chartHistory: restoreContext,
          signal: controller.signal,
          client: diagnostics.client,
        });
        if (controller.signal.aborted || abortRef.current !== controller) {
          return;
        }
        if (
          baseline.committed !== latestChartRef.current.committed ||
          baseline.effective !== latestChartRef.current.effective ||
          baseline.revision !== sourceEditRevisionRef.current ||
          !isSamePanelContext(baseline.panelContext, latestChartRef.current.panelContext)
        ) {
          throw new Error('The chart or Panel query changed while selecting a restore. Request it again.');
        }
        setProposalPlan(plan);
        if (plan.mode === 'restore') {
          stageRestore(plan.restoreRevisionId!, next);
        } else if (plan.mode === 'clarify') {
          appendMessage('assistant', plan.question, next);
        } else {
          setRestoreConversation(false);
          appendMessage(
            'assistant',
            isRestoreRequest(content)
              ? (restoreContext.unavailableReason ??
                  'Choose a saved version from Chart history to prepare an exact restore preview.')
              : `${plan.summary} Choose Generate proposal to review this new change.`,
            next
          );
        }
        return;
      }
      const response = await diagnostics.client.chat(
        selectedProviderUid!,
        {
          messages: providerConversation(next),
          panelContext: {
            ...proposalChatContext(frames, captureVizSnapshot(context.options ?? defaultFlintOptions)),
            chartHistory: restoreContext,
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
    if (nextDraft.source === 'manual') {
      setProposalPlan(undefined);
    }
    sourceEditRevisionRef.current++;
    setSpecEditorResetVersion((version) => version + 1);
    setSpecEditorStatus('pristine');
    setDraft({
      ...toChartState(nextDraft),
      context: nextDraft.context,
      rationale: nextDraft.rationale,
      source: nextDraft.source,
      ...(nextDraft.restoreRevisionId ? { restoreRevisionId: nextDraft.restoreRevisionId } : {}),
      ...(nextDraft.baseFingerprint !== undefined ? { baseFingerprint: nextDraft.baseFingerprint } : {}),
    });
    setPreview({ status: 'checking' });
    setError(undefined);
  };

  const stageRestore = (revisionId: string, base = messages) => {
    const restored = prepareChartRestore(
      history,
      revisionId,
      captureVizSnapshot(context.options ?? defaultFlintOptions),
      panelContext
    );
    stageDraft(restored);
    setProposalPlan((current) =>
      current?.mode === 'restore' && current.restoreRevisionId === revisionId
        ? current
        : { mode: 'restore', summary: restored.rationale, question: '', restoreRevisionId: revisionId }
    );
    setRestoreConversation(false);
    appendMessage(
      'assistant',
      `${restored.rationale} Preparing the exact saved snapshot for preview. Review it, then click Restore this version.`,
      base
    );
  };

  const stageManualSpecDraft = (nextDraft: FlintPendingViz) => {
    setWorkbenchError(undefined);
    setProposalPlan(undefined);
    sourceEditRevisionRef.current++;
    setDraft({
      ...toChartState(nextDraft),
      context: nextDraft.context,
      rationale: nextDraft.rationale,
      source: nextDraft.source,
      ...((nextDraft.baseFingerprint ?? draft?.baseFingerprint) !== undefined
        ? { baseFingerprint: nextDraft.baseFingerprint ?? draft?.baseFingerprint }
        : {}),
    });
    setError(undefined);
  };

  const discardDraft = (restoreDraft?: FlintPendingViz) => {
    const manual = currentProposalOwner === 'workbench';
    setProposalPlan(undefined);
    sourceEditRevisionRef.current++;
    setSpecEditorResetVersion((version) => version + 1);
    setSpecEditorStatus('pristine');
    setDraft(restoreDraft);
    setPreview({ status: restoreDraft ? 'checking' : 'ready' });
    setError(undefined);
    setWorkbenchError(undefined);
    const message = restoreDraft
      ? 'Discarded manual edits and restored the previous proposal.'
      : manual
        ? 'Discarded manual changes.'
        : 'Discarded the proposal.';
    if (manual) {
      setNotice(undefined);
      setWorkbenchNotice(message);
    } else {
      setWorkbenchNotice(undefined);
      setNotice(message);
    }
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
    const baseline = draft
      ? snapshotWithDraft(context.options ?? defaultFlintOptions, draft)
      : captureVizSnapshot(context.options ?? defaultFlintOptions);
    const generationBaseline = { ...latestChartRef.current, revision: sourceEditRevisionRef.current };
    setBusy('generate');
    setError(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const plan = await planProposalFromAi({
        providerUid: selectedProviderUid!,
        frames,
        currentChartState: baseline,
        conversation: providerConversation(messages),
        signal: controller.signal,
        client: diagnostics.client,
        chartHistory: restoreContext,
      });
      if (controller.signal.aborted || abortRef.current !== controller) {
        return;
      }
      if (
        generationBaseline.committed !== latestChartRef.current.committed ||
        generationBaseline.effective !== latestChartRef.current.effective ||
        generationBaseline.revision !== sourceEditRevisionRef.current ||
        !isSamePanelContext(generationBaseline.panelContext, latestChartRef.current.panelContext)
      ) {
        throw new Error('The chart or Panel query changed while AI was planning this proposal. Generate again.');
      }
      setProposalPlan(plan);
      if (plan.mode === 'clarify') {
        appendMessage('assistant', plan.question, messages);
        return;
      }
      if (plan.mode === 'restore') {
        stageRestore(plan.restoreRevisionId!);
        return;
      }
      if (isRestoreRequest(prompt)) {
        throw new Error(
          restoreContext.unavailableReason ??
            'An exact restore must select a saved version. Choose a version from Chart history.'
        );
      }
      const generated = await generateFlintOptionsFromAi({
        providerUid: selectedProviderUid!,
        frames,
        userPrompt: plan.summary,
        renderBackend: selectedRenderBackend,
        generationMode: plan.mode,
        currentChartState: baseline,
        conversation: providerConversation(messages),
        signal: controller.signal,
        client: diagnostics.client,
      });
      if (controller.signal.aborted || abortRef.current !== controller) {
        return;
      }
      if (
        generationBaseline.committed !== latestChartRef.current.committed ||
        generationBaseline.effective !== latestChartRef.current.effective ||
        generationBaseline.revision !== sourceEditRevisionRef.current ||
        !isSamePanelContext(generationBaseline.panelContext, latestChartRef.current.panelContext)
      ) {
        throw new Error('This proposal is stale because the chart source or Panel query changed during generation.');
      }
      generatedPromptRef.current = prompt;
      stageDraft({
        ...generated,
        baseFingerprint: generationBaseline.committed,
        rationale: generated.rationale || 'AI-generated Flint proposal.',
        context: panelContext,
        source: 'provider',
      });
      appendMessage(
        'assistant',
        [
          `Prepared a ${generated.flintInput.chart_spec.chartType} proposal.`,
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
    const reportError = currentProposalOwner === 'workbench' ? setWorkbenchError : setError;
    if (!draft || !panelContext || !isSamePanelContext(draft.context, panelContext)) {
      reportError('This proposal is stale because the Panel query or schema changed.');
      return;
    }
    if (draft.baseFingerprint !== undefined && draft.baseFingerprint !== committedFingerprint) {
      reportError('This proposal is stale because the chart source changed before Apply.');
      return;
    }
    if (!context.options || preview.status !== 'ready') {
      reportError('Wait for the live preview to render successfully before applying it.');
      return;
    }
    if (specEditorBlocksApply) {
      reportError('Fix and validate the current Spec revision before applying it.');
      return;
    }
    sourceEditRevisionRef.current++;
    if (draft.restoreRevisionId) {
      try {
        prepareChartRestore(history, draft.restoreRevisionId, captureVizSnapshot(context.options), panelContext);
      } catch (cause) {
        reportError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    const label = (state: FlintVizSnapshot) => {
      try {
        return (
          proposalChatContext(frames, state).dataHint?.split('\n')[0].replace('Current chart: ', '') ??
          state.flintInput.chart_spec.chartType
        );
      } catch {
        return state.flintInput.chart_spec.chartType;
      }
    };
    const before = captureVizSnapshot(context.options);
    const after = snapshotWithDraft(context.options, draft);
    const next = recordChartApplication(
      history,
      before,
      after,
      panelContext,
      { before: label(before), after: label(after) },
      draft.restoreRevisionId,
      false,
      currentProposalOwner === 'workbench' ? 'workbench' : 'chat'
    );
    // Persist before onChange: Grafana may recreate the editor when consuming ai.pending.
    saveChartHistory(storage, historyKey, next);
    setHistory(next);
    setSpecEditorResetVersion((version) => version + 1);
    setSpecEditorStatus('pristine');
    setDraft(undefined);
    onChange({ ...ai, lastPrompt: generatedPromptRef.current, draft: undefined, pending: draft });
  };

  const undoApply = () => {
    try {
      const previous = restoreContext.revisions.at(-1);
      if (!previous) {
        throw new Error(restoreContext.unavailableReason);
      }
      cancelRequest();
      stageRestore(previous.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const dismissStudio = () => {
    const hasUncommittedWork = Boolean(draft) || specEditorStatus !== 'pristine';
    if (
      hasUncommittedWork &&
      !window.confirm('Discard the current chart proposal or Spec edits and close Chart workbench?')
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
        Open Chart workbench
      </Button>
      <Tooltip content={hint.querySummary} placement="bottom-start">
        <div className={styles.secondaryText} data-testid="flint-ai-current-chart">
          Current chart: {committedChartLabel} · {committedBackendLabel}
        </div>
      </Tooltip>

      <Modal
        title={
          <div className={styles.modalTitle}>
            <span>Chart workbench</span>
            <IconButton
              name="info-circle"
              size="sm"
              type="button"
              tooltip="Uses the current Grafana Panel. Drag the divider to resize the panes, or the lower-right corner to resize the dialog."
              tooltipPlacement="bottom-start"
            />
            <ToolbarButton
              className={styles.chatToggle}
              icon="ai"
              variant={isChatOpen ? 'active' : 'default'}
              tooltip={isChatOpen ? 'Hide AI Chat' : 'Show AI Chat'}
              aria-label={isChatOpen ? 'Hide AI Chat' : 'Show AI Chat'}
              type="button"
              aria-controls="flint-ai-chat-pane"
              aria-expanded={isChatOpen}
              onClick={() => setChatOpen((current) => !current)}
            >
              AI Chat
            </ToolbarButton>
          </div>
        }
        ariaLabel="Chart workbench"
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
              previewLabel={previewLabel}
              notice={workbenchNotice}
              error={workbenchError}
              previewError={currentProposalOwner !== 'chat' && preview.status === 'error' ? preview.error : undefined}
              draftIsStale={currentProposalOwner === 'workbench' && draftIsStale}
              onDismissNotice={() => setWorkbenchNotice(undefined)}
              panelContext={panelContext}
              specDraftControls={{
                canApply: canApplyDraft,
                onDraftChange: stageManualSpecDraft,
                onStatusChange: (status) => {
                  if (status === 'checking' || status !== specEditorStatus) {
                    sourceEditRevisionRef.current++;
                  }
                  setSpecEditorStatus(status);
                },
                onApply: applyDraft,
                onDiscard: discardDraft,
              }}
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
                <IconButton
                  name="download-alt"
                  tooltip="Export diagnostics: chat, chart state, AI calls and errors. Credentials and query rows are excluded."
                  aria-label="Export diagnostics"
                  type="button"
                  data-testid="flint-ai-export-diagnostics"
                  onClick={() => {
                    try {
                      const provider = providers.find((item) => item.value === selectedProviderUid);
                      downloadAiDiagnostics(
                        buildAiDiagnosticReport({
                          messages,
                          provider: { uid: selectedProviderUid, name: provider?.label, model: provider?.description },
                          panelContext,
                          frames,
                          committed: toChartState(context.options ?? defaultFlintOptions),
                          draft,
                          proposalPlan,
                          requests: diagnostics.snapshot(),
                          history: {
                            revisions: history,
                            available: !restoreContext.unavailableReason,
                            unavailableReason: restoreContext.unavailableReason,
                          },
                          status: {
                            busy,
                            error,
                            notice,
                            preview,
                            specEditor: specEditorStatus,
                            draftIsStale,
                            canApply: canApplyDraft,
                          },
                          environment: {
                            grafanaVersion: config.buildInfo.version,
                            pagePath: window.location.pathname,
                            userAgent: navigator.userAgent,
                          },
                        })
                      );
                    } catch (cause) {
                      setError(
                        `Could not export diagnostics: ${cause instanceof Error ? cause.message : String(cause)}`
                      );
                    }
                  }}
                />
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
                <Tooltip
                  content={restoreContext.unavailableReason ?? 'Preview the exact version before the last application.'}
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="history"
                    aria-label="Undo last apply"
                    type="button"
                    disabled={Boolean(restoreContext.unavailableReason)}
                    onClick={undoApply}
                    data-testid="flint-ai-undo-apply"
                  >
                    Undo last apply
                  </Button>
                </Tooltip>
                <IconButton
                  name="trash-alt"
                  tooltip="Clear chat"
                  aria-label="Clear chat"
                  type="button"
                  disabled={Boolean(busy) || messages.length === 0}
                  onClick={() => {
                    clearTemporaryChat(storage, storageKey);
                    diagnostics.clear();
                    setRestoreConversation(false);
                    setProposalPlan(undefined);
                    setMessages([]);
                    setNotice('Cleared the temporary conversation.');
                  }}
                />
              </div>
            </header>

            <div
              className={`${styles.secondaryText} ${styles.modeControls}`}
              data-testid="flint-ai-proposal-scope"
              aria-live="polite"
            >
              {proposalPlan && proposalPlan.mode !== 'clarify' ? (
                <>
                  <strong>
                    {proposalPlan.mode === 'restore'
                      ? 'Restore saved chart'
                      : proposalPlan.mode === 'refine'
                        ? 'Adjust current chart'
                        : 'Redesign chart'}
                  </strong>
                  <div>{proposalPlan.summary}</div>
                  {proposalPlan.mode === 'create' && <div>Review chart type and field bindings before Apply.</div>}
                </>
              ) : (
                'Describe your change in chat. AI determines its scope; review the preview before Apply.'
              )}
            </div>
            {history.length > 1 && (
              <details
                className={`${styles.secondaryText} ${styles.modeControls}`}
                data-testid="flint-ai-chart-history"
              >
                <summary>Chart history ({history.length - 1} earlier versions)</summary>
                {restoreContext.unavailableReason && <div>{restoreContext.unavailableReason}</div>}
                {history
                  .slice(0, -1)
                  .reverse()
                  .map((revision) => (
                    <div key={revision.id}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(restoreContext.unavailableReason) || Boolean(busy)}
                        onClick={() => {
                          try {
                            stageRestore(revision.id);
                          } catch (cause) {
                            setError(String(cause));
                          }
                        }}
                      >
                        Preview {revision.label} · {new Date(revision.createdAt).toLocaleTimeString()}
                      </Button>
                    </div>
                  ))}
              </details>
            )}
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
                        {proposalSettings?.chartType} ·{' '}
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
                    <span>{proposalSettings?.xField || 'Auto'}</span>
                    <span>Y</span>
                    <span>{proposalSettings?.yField || 'Auto'}</span>
                    <span>Color</span>
                    <span>{proposalSettings?.colorField || 'None'}</span>
                  </div>
                  <div className={styles.inlineActions}>
                    <Button
                      size="sm"
                      type="button"
                      onClick={applyDraft}
                      disabled={!canApplyDraft}
                      data-testid="flint-ai-apply-draft"
                    >
                      {draft.restoreRevisionId ? 'Restore this version' : 'Apply'}
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
                    The Panel query, field schema or committed chart source changed. Generate a new proposal before
                    Apply.
                  </Alert>
                </div>
              )}
              {currentProposalOwner === 'chat' && preview.status === 'error' && preview.error && (
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
                  <Alert title="Chart workbench" severity="info" onRemove={() => setNotice(undefined)}>
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
