import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, CodeEditor, Combobox, IconButton, Tab, TabsBar, ToolbarButton, useStyles2 } from '@grafana/ui';

import { isSamePanelContext, type FlintPanelContextSnapshot } from '../ai/panelContext';
import { proposalOwner, type SpecEditorStatus } from '../ai/proposalOwnership';
import { assemblePanelChart } from '../flint/assemble';
import { RENDER_BACKENDS, type RenderBackend } from '../flint/backends';
import { allowedChartTypesForBackend } from '../flint/chartTypes';
import { clearFrameworkOverride } from '../flint/frameworkOverride';
import { createManualChartDraft, type ManualChartSettingsPatch } from '../flint/manualChartDraft';
import { preparePanelData } from '../flint/preparePanelData';
import { editableFlintSpecText, evaluateFlintSpecDraft, type FlintSpecEvaluation } from '../flint/specDraft';
import { evaluateFrameworkSpecDraft, type FrameworkSpecEvaluation } from '../flint/frameworkSpecDraft';
import { resolveVisualizationRevision, type FlintRenderOptions } from '../flint/visualizationRevision';
import { defaultFlintOptions, type FlintOptions, type FlintPendingViz, type WaterfallTotalsMode } from '../types';
import { AiChartLivePreview } from './AiChartLivePreview';

type WorkbenchView = 'preview' | 'settings' | 'flint' | 'framework';
type PreviewStatus = 'checking' | 'ready' | 'error';
export type { SpecEditorStatus } from '../ai/proposalOwnership';

interface SpecDraftControls {
  canApply: boolean;
  onDraftChange: (draft: FlintPendingViz) => void;
  onStatusChange: (status: SpecEditorStatus) => void;
  onApply: () => void;
  onDiscard: (restoreDraft?: FlintPendingViz) => void;
}

interface SpecEditSession {
  text: string;
  baseOptions: FlintRenderOptions;
  baseDraft?: FlintPendingViz;
  context?: FlintPanelContextSnapshot;
}

type SpecEvaluationState =
  { status: 'pristine' | 'checking' } | Extract<FlintSpecEvaluation, { status: 'valid' | 'invalid' }>;
type FrameworkEvaluationState =
  { status: 'pristine' | 'checking' } | Extract<FrameworkSpecEvaluation, { status: 'valid' | 'invalid' }>;

interface AiChartWorkbenchProps {
  frames: DataFrame[];
  options?: FlintOptions;
  draft?: FlintPendingViz;
  querySummary: string;
  previewLabel: string;
  panelContext?: FlintPanelContextSnapshot;
  specDraftControls: SpecDraftControls;
  isChatOpen: boolean;
  onToggleChat: () => void;
  onPreviewStatusChange: (status: PreviewStatus, error?: string) => void;
}

const COMPILE_SIZE = { width: 800, height: 450 };
const AUTO_FIELD_VALUE = '__flint_auto_field__';
const WATERFALL_TOTAL_OPTIONS: Array<{ label: string; value: WaterfallTotalsMode }> = [
  { label: 'Auto', value: 'auto' },
  { label: 'None', value: 'none' },
  { label: 'First only', value: 'first' },
  { label: 'Last only', value: 'last' },
  { label: 'First and last', value: 'both' },
];

const getStyles = (theme: GrafanaTheme2) => ({
  root: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  `,
  header: css`
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(1, 2)};
    background: ${theme.colors.background.primary};
  `,
  titleRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  title: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  headerActions: css`
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  frameworkSelect: css`
    min-width: 112px;
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
  tabs: css`
    flex: 0 0 auto;
    padding: 0 ${theme.spacing(2)};
    background: ${theme.colors.background.primary};
  `,
  draftBar: css`
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
    min-height: 42px;
    padding: ${theme.spacing(0.75, 2)};
    background: ${theme.colors.background.secondary};
  `,
  draftStatus: css`
    min-width: 0;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    overflow-wrap: anywhere;
  `,
  draftActions: css`
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  panel: css`
    flex: 1;
    min-width: 0;
    min-height: 0;
  `,
  previewPanel: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  `,
  previewStage: css`
    flex: 1;
    min-height: 0;
    padding: ${theme.spacing(2)};
  `,
  settingsPanel: css`
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: ${theme.spacing(2)};
    background: ${theme.colors.background.canvas};
  `,
  settingsContent: css`
    max-width: 680px;
    padding: ${theme.spacing(2)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
  `,
  settingsHeading: css`
    margin-bottom: ${theme.spacing(0.5)};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  settingsHelp: css`
    margin-bottom: ${theme.spacing(2)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  settingsGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${theme.spacing(2)};

    ${theme.breakpoints.down('sm')} {
      grid-template-columns: 1fr;
    }
  `,
  setting: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    min-width: 0;
  `,
  settingLabel: css`
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  settingsNotice: css`
    margin-top: ${theme.spacing(2)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  specPanel: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(190px, 28%);
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    min-height: 0;

    ${theme.breakpoints.down('sm')} {
      grid-template-columns: 1fr;
    }
  `,
  editor: css`
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.canvas};
  `,
  codeEditor: css`
    width: 100%;
    height: 100%;
  `,
  inspector: css`
    grid-column: 2;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-y: auto;
    padding: ${theme.spacing(2)};
    border-left: 1px solid ${theme.colors.border.weak};
    background: ${theme.colors.background.primary};

    ${theme.breakpoints.down('sm')} {
      display: none;
    }
  `,
  inspectorTitle: css`
    margin-bottom: ${theme.spacing(2)};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  inspectorTitleRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    margin-bottom: ${theme.spacing(2)};
  `,
  inspectorRow: css`
    margin-bottom: ${theme.spacing(1.5)};
  `,
  inspectorLabel: css`
    margin-bottom: 2px;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  inspectorValue: css`
    overflow-wrap: anywhere;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  valid: css`
    color: ${theme.colors.success.text};
  `,
  invalid: css`
    color: ${theme.colors.error.text};
  `,
  warning: css`
    color: ${theme.colors.warning.text};
  `,
  warningValue: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  inspectorActions: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
    margin-top: auto;
    padding-top: ${theme.spacing(2)};
  `,
  error: css`
    padding: ${theme.spacing(2)};
  `,
});

export const AiChartWorkbench = ({
  frames,
  options,
  draft,
  querySummary,
  previewLabel,
  panelContext,
  specDraftControls,
  isChatOpen,
  onToggleChat,
  onPreviewStatusChange,
}: AiChartWorkbenchProps) => {
  const styles = useStyles2(getStyles);
  const [activeView, setActiveView] = useState<WorkbenchView>('preview');
  const [specSession, setSpecSession] = useState<SpecEditSession>();
  const [specEvaluation, setSpecEvaluation] = useState<SpecEvaluationState>({ status: 'pristine' });
  const [frameworkSession, setFrameworkSession] = useState<SpecEditSession>();
  const [frameworkEvaluation, setFrameworkEvaluation] = useState<FrameworkEvaluationState>({ status: 'pristine' });
  const specDraftControlsRef = useRef(specDraftControls);
  const prepared = useMemo(() => preparePanelData(frames), [frames]);
  const visualization = useMemo(
    () => resolveVisualizationRevision(options ?? defaultFlintOptions, draft),
    [draft, options]
  );
  const effectiveOptions = visualization.options;
  const chartTypeOptions = useMemo(
    () =>
      allowedChartTypesForBackend(effectiveOptions.renderBackend).map((chartType) => ({
        label: chartType === 'auto' ? 'Auto' : chartType,
        value: chartType,
      })),
    [effectiveOptions.renderBackend]
  );
  const fieldOptions = useMemo(
    () => [
      { label: 'Auto', value: AUTO_FIELD_VALUE },
      ...prepared.table.fields.map((field) => ({ label: field.name, value: field.name })),
    ],
    [prepared.table.fields]
  );
  const compiled = useMemo(() => {
    if (!frames.length || !prepared.table.values.length) {
      return {
        flintSpec: '{}',
        frameworkSpec: '{}',
        warnings: [] as string[],
        error: 'Run the Panel query to inspect generated specifications.',
      };
    }

    try {
      const result = assemblePanelChart(prepared.table, effectiveOptions, COMPILE_SIZE);
      return {
        flintSpec: editableFlintSpecText(effectiveOptions, result),
        frameworkSpec: JSON.stringify(result.payload, null, 2),
        assembled: result,
        backend: result.backend,
        chartType: result.input.chart_spec.chartType,
        warnings: result.warnings,
        error: undefined,
      };
    } catch (cause) {
      return {
        flintSpec: effectiveOptions.specJson || '{}',
        frameworkSpec: '{}',
        assembled: undefined,
        warnings: [] as string[],
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
    // The stable revision key intentionally excludes Provider and other non-visual options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualization.key, frames.length, prepared.table]);

  useEffect(() => {
    specDraftControlsRef.current = specDraftControls;
  }, [specDraftControls]);

  useEffect(() => {
    if (!specSession) {
      return;
    }

    const contextMatches =
      (!specSession.context && !panelContext) || isSamePanelContext(specSession.context, panelContext);
    if (!contextMatches) {
      return;
    }

    const timer = window.setTimeout(() => {
      const result = evaluateFlintSpecDraft({
        text: specSession.text,
        options: specSession.baseOptions,
        table: prepared.table,
        size: COMPILE_SIZE,
        context: specSession.context,
      });
      setSpecEvaluation(result);
      specDraftControlsRef.current.onStatusChange(result.status);
      if (result.status === 'valid') {
        specDraftControlsRef.current.onDraftChange(result.draft);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [panelContext, prepared.table, specSession]);

  useEffect(() => {
    if (!frameworkSession) {
      return;
    }

    const contextMatches =
      (!frameworkSession.context && !panelContext) || isSamePanelContext(frameworkSession.context, panelContext);
    if (!contextMatches) {
      return;
    }

    const timer = window.setTimeout(() => {
      const result = evaluateFrameworkSpecDraft({
        text: frameworkSession.text,
        options: frameworkSession.baseOptions,
        table: prepared.table,
        size: COMPILE_SIZE,
        context: frameworkSession.context,
      });
      setFrameworkEvaluation(result);
      specDraftControlsRef.current.onStatusChange(result.status);
      if (result.status === 'valid') {
        specDraftControlsRef.current.onDraftChange(result.draft);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [frameworkSession, panelContext, prepared.table]);

  const selectView = (view: WorkbenchView) => () => setActiveView(view);
  const specIsDirty = Boolean(specSession);
  const frameworkIsDirty = Boolean(frameworkSession);
  const specIsStale = Boolean(
    specSession && !((!specSession.context && !panelContext) || isSamePanelContext(specSession.context, panelContext))
  );
  const frameworkIsStale = Boolean(
    frameworkSession &&
    !((!frameworkSession.context && !panelContext) || isSamePanelContext(frameworkSession.context, panelContext))
  );
  const specStatus = specIsStale ? 'stale' : specEvaluation.status;
  const frameworkStatus = frameworkIsStale ? 'stale' : frameworkEvaluation.status;
  const activeEditorStatus = frameworkIsDirty ? frameworkStatus : specStatus;
  const displayedFlintSpec = specSession?.text ?? compiled.flintSpec;
  const lastValidAssembly = specEvaluation.status === 'valid' ? specEvaluation.assembled : undefined;
  const displayedFrameworkSpec =
    frameworkSession?.text ??
    (lastValidAssembly ? JSON.stringify(lastValidAssembly.payload, null, 2) : compiled.frameworkSpec);
  const displayedChartType = lastValidAssembly?.input.chart_spec.chartType ?? compiled.chartType;
  const displayedWarnings = lastValidAssembly?.warnings ?? compiled.warnings;
  const displayedWarningCount = displayedWarnings.length;
  const overrideWasIgnored = displayedWarnings.some((warning) => /Ignored .*UI Framework override/i.test(warning));
  const specError = specEvaluation.status === 'invalid' ? specEvaluation.error : undefined;
  const frameworkError = frameworkEvaluation.status === 'invalid' ? frameworkEvaluation.error : undefined;
  const activeEditorError = frameworkIsDirty ? frameworkError : specError;
  const hasFrameworkOverride = Boolean(effectiveOptions.frameworkOverrides?.[effectiveOptions.renderBackend]);
  const frameworkInspectorStatus =
    frameworkStatus === 'checking'
      ? 'Checking…'
      : frameworkStatus === 'invalid' && frameworkEvaluation.status === 'invalid'
        ? frameworkEvaluation.error
        : frameworkStatus === 'stale'
          ? 'Stale: Panel query or fields changed'
          : specIsDirty
            ? 'Finish Flint Spec edits first'
            : overrideWasIgnored
              ? 'Stale override ignored'
              : hasFrameworkOverride && !frameworkIsDirty
                ? 'Saved override applied'
                : 'Valid UI Framework Spec';
  const showWorkbenchDraftActions = proposalOwner(draft, activeEditorStatus) === 'workbench';
  const draftStatusMessage = (() => {
    switch (activeEditorStatus) {
      case 'checking':
        return `Validating ${frameworkIsDirty ? 'UI Framework Spec' : 'Flint Spec'}… Preview shows the last valid revision.`;
      case 'invalid':
        return `Invalid ${frameworkIsDirty ? 'UI Framework Spec' : 'Flint Spec'}: ${activeEditorError ?? 'Unknown validation error.'} Preview shows the last valid revision.`;
      case 'stale':
        return 'The Panel query changed. Revalidate this Spec before Apply.';
      case 'valid':
        if (frameworkIsDirty) {
          return previewLabel === 'Preview ready'
            ? 'Preview ready · UI Framework Spec changes are not applied.'
            : 'UI Framework Spec is valid; building preview…';
        }
        return previewLabel === 'Preview ready'
          ? 'Preview ready · Flint Spec changes are not applied.'
          : activeView === 'preview'
            ? 'Flint Spec is valid; building preview…'
            : 'Flint Spec is valid. Open UI Preview to complete render validation.';
      default:
        if (!draft) {
          return '';
        }
        if (previewLabel === 'Preview failed') {
          return 'Preview failed · Fix or discard these unapplied changes.';
        }
        return previewLabel === 'Preview ready'
          ? 'Preview ready · Changes are not applied.'
          : 'Building preview… Changes are not applied.';
    }
  })();

  const discardEdits = () => {
    specDraftControls.onDiscard(frameworkSession?.baseDraft ?? specSession?.baseDraft);
    setSpecSession(undefined);
    setSpecEvaluation({ status: 'pristine' });
    setFrameworkSession(undefined);
    setFrameworkEvaluation({ status: 'pristine' });
  };

  const applyDraft = () => {
    specDraftControls.onApply();
  };

  const updateSpecText = (text: string) => {
    if (frameworkIsDirty) {
      return;
    }
    if ((!specSession && text === displayedFlintSpec) || specSession?.text === text) {
      return;
    }
    setSpecEvaluation({ status: 'checking' });
    specDraftControls.onStatusChange('checking');
    setSpecSession((current) => ({
      text,
      baseOptions: current?.baseOptions ?? effectiveOptions,
      baseDraft: current?.baseDraft ?? draft,
      context: current?.context ?? panelContext,
    }));
  };

  const updateFrameworkSpecText = (text: string) => {
    if (specIsDirty) {
      return;
    }
    if ((!frameworkSession && text === displayedFrameworkSpec) || frameworkSession?.text === text) {
      return;
    }
    setFrameworkEvaluation({ status: 'checking' });
    specDraftControls.onStatusChange('checking');
    setFrameworkSession((current) => ({
      text,
      baseOptions: current?.baseOptions ?? effectiveOptions,
      baseDraft: current?.baseDraft ?? draft,
      context: current?.context ?? panelContext,
    }));
  };

  const resetFrameworkOverride = () => {
    const frameworkOverrides = clearFrameworkOverride(
      effectiveOptions.frameworkOverrides,
      effectiveOptions.renderBackend
    );
    const resetOptions = {
      ...effectiveOptions,
      frameworkOverrides,
    };
    const resetAssembly = assemblePanelChart(prepared.table, resetOptions, COMPILE_SIZE);
    setFrameworkSession({
      text: JSON.stringify(resetAssembly.payload, null, 2),
      baseOptions: resetOptions,
      baseDraft: draft,
      context: panelContext,
    });
    setFrameworkEvaluation({ status: 'checking' });
    specDraftControls.onStatusChange('checking');
  };

  const manualSettingsDisabled = specIsDirty || frameworkIsDirty;

  const updateManualSettings = (patch: ManualChartSettingsPatch) => {
    if (manualSettingsDisabled) {
      return;
    }
    specDraftControls.onDraftChange(
      createManualChartDraft({
        options: effectiveOptions,
        patch,
        context: panelContext,
      })
    );
  };

  const changeRenderBackend = (renderBackend: RenderBackend) => {
    if (renderBackend !== effectiveOptions.renderBackend) {
      updateManualSettings({ renderBackend });
    }
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.title}>Chart workbench</div>
          <IconButton
            name="info-circle"
            size="sm"
            type="button"
            tooltip={`${querySummary}. Preview uses the actual Panel DataFrame with the ${effectiveOptions.renderBackend} renderer. Draft changes are not saved until Apply.`}
            tooltipPlacement="bottom-start"
          />
        </div>
        <div className={styles.headerActions}>
          <div className={styles.frameworkSelect}>
            <span className={styles.screenReaderOnly} id="flint-ui-framework-label">
              UI framework
            </span>
            <Combobox
              id="flint-ui-framework"
              aria-labelledby="flint-ui-framework-label"
              options={RENDER_BACKENDS}
              value={effectiveOptions.renderBackend}
              width="auto"
              minWidth={14}
              maxWidth={24}
              disabled={manualSettingsDisabled}
              onChange={(option) => changeRenderBackend(option.value)}
            />
          </div>
          <ToolbarButton
            icon="ai"
            iconOnly={isChatOpen}
            narrow
            variant={isChatOpen ? 'active' : 'default'}
            tooltip={isChatOpen ? 'Hide AI Chat' : 'Show AI Chat'}
            aria-label={isChatOpen ? 'Hide AI Chat' : 'Show AI Chat'}
            type="button"
            aria-controls="flint-ai-chat-pane"
            aria-expanded={isChatOpen}
            onClick={onToggleChat}
          >
            AI Chat
          </ToolbarButton>
        </div>
      </header>

      <TabsBar className={styles.tabs} role="tablist" aria-label="Chart workbench views">
        <Tab
          id="flint-workbench-preview-tab"
          label="UI Preview"
          active={activeView === 'preview'}
          aria-selected={activeView === 'preview'}
          aria-controls="flint-workbench-preview"
          onChangeTab={selectView('preview')}
        />
        <Tab
          id="flint-workbench-settings-tab"
          label="Chart Settings"
          active={activeView === 'settings'}
          aria-selected={activeView === 'settings'}
          aria-controls="flint-workbench-settings"
          onChangeTab={selectView('settings')}
        />
        <Tab
          id="flint-workbench-spec-tab"
          label="Flint Spec"
          icon={specIsDirty ? 'circle' : undefined}
          tooltip={specIsDirty ? 'Flint Spec has unsaved edits' : undefined}
          active={activeView === 'flint'}
          aria-selected={activeView === 'flint'}
          aria-controls="flint-workbench-spec"
          onChangeTab={selectView('flint')}
        />
        <Tab
          id="flint-workbench-framework-tab"
          label="UI Framework Spec"
          icon={frameworkIsDirty ? 'circle' : undefined}
          tooltip={frameworkIsDirty ? 'UI Framework Spec has unsaved edits' : undefined}
          active={activeView === 'framework'}
          aria-selected={activeView === 'framework'}
          aria-controls="flint-workbench-framework"
          onChangeTab={selectView('framework')}
        />
      </TabsBar>

      {showWorkbenchDraftActions && (
        <div className={styles.draftBar} aria-live="polite" data-testid="flint-spec-draft-bar">
          <div className={styles.draftStatus}>{draftStatusMessage}</div>
          <div className={styles.draftActions}>
            <Button size="sm" type="button" variant="secondary" onClick={discardEdits}>
              Discard edits
            </Button>
            <Button
              size="sm"
              type="button"
              onClick={applyDraft}
              disabled={!specDraftControls.canApply}
              data-testid="flint-workbench-apply-draft"
            >
              Apply to panel
            </Button>
          </div>
        </div>
      )}

      <div
        id="flint-workbench-preview"
        className={`${styles.panel} ${styles.previewPanel}`}
        role="tabpanel"
        aria-labelledby="flint-workbench-preview-tab"
        hidden={activeView !== 'preview'}
      >
        <div className={styles.previewStage}>
          <AiChartLivePreview frames={frames} options={options} draft={draft} onStatusChange={onPreviewStatusChange} />
        </div>
      </div>

      {activeView === 'settings' && (
        <div
          id="flint-workbench-settings"
          className={`${styles.panel} ${styles.settingsPanel}`}
          role="tabpanel"
          aria-labelledby="flint-workbench-settings-tab"
        >
          <div className={styles.settingsContent}>
            <div className={styles.settingsHeading}>Manual chart settings</div>
            <div className={styles.settingsHelp}>
              Changes create a preview draft. Review it in UI Preview, then Apply to panel.
            </div>
            <div className={styles.settingsGrid}>
              <div className={styles.setting}>
                <span id="flint-chart-type-label" className={styles.settingLabel}>
                  Chart type
                </span>
                <Combobox
                  id="flint-chart-type"
                  aria-labelledby="flint-chart-type-label"
                  options={chartTypeOptions}
                  value={effectiveOptions.chartType}
                  disabled={manualSettingsDisabled}
                  onChange={(option) => updateManualSettings({ chartType: option.value })}
                />
              </div>
              <div className={styles.setting}>
                <span id="flint-x-field-label" className={styles.settingLabel}>
                  X field
                </span>
                <Combobox
                  id="flint-x-field"
                  aria-labelledby="flint-x-field-label"
                  options={fieldOptions}
                  value={effectiveOptions.xField || AUTO_FIELD_VALUE}
                  disabled={manualSettingsDisabled}
                  onChange={(option) =>
                    updateManualSettings({ xField: option.value === AUTO_FIELD_VALUE ? '' : option.value })
                  }
                />
              </div>
              <div className={styles.setting}>
                <span id="flint-y-field-label" className={styles.settingLabel}>
                  Y field
                </span>
                <Combobox
                  id="flint-y-field"
                  aria-labelledby="flint-y-field-label"
                  options={fieldOptions}
                  value={effectiveOptions.yField || AUTO_FIELD_VALUE}
                  disabled={manualSettingsDisabled}
                  onChange={(option) =>
                    updateManualSettings({ yField: option.value === AUTO_FIELD_VALUE ? '' : option.value })
                  }
                />
              </div>
              <div className={styles.setting}>
                <span id="flint-color-field-label" className={styles.settingLabel}>
                  Color field
                </span>
                <Combobox
                  id="flint-color-field"
                  aria-labelledby="flint-color-field-label"
                  options={fieldOptions}
                  value={effectiveOptions.colorField || AUTO_FIELD_VALUE}
                  disabled={manualSettingsDisabled}
                  onChange={(option) =>
                    updateManualSettings({ colorField: option.value === AUTO_FIELD_VALUE ? '' : option.value })
                  }
                />
              </div>
              {effectiveOptions.chartType === 'Waterfall Chart' && (
                <div className={styles.setting}>
                  <span id="flint-waterfall-totals-label" className={styles.settingLabel}>
                    Waterfall totals
                  </span>
                  <Combobox<WaterfallTotalsMode>
                    id="flint-waterfall-totals"
                    aria-labelledby="flint-waterfall-totals-label"
                    options={WATERFALL_TOTAL_OPTIONS}
                    value={effectiveOptions.waterfallTotals}
                    disabled={manualSettingsDisabled}
                    onChange={(option) => updateManualSettings({ waterfallTotals: option.value })}
                  />
                </div>
              )}
            </div>
            {effectiveOptions.specJson.trim() && (
              <div className={styles.settingsNotice}>
                Changing Chart type or field mappings replaces the current custom Flint Spec in this draft.
              </div>
            )}
          </div>
        </div>
      )}

      {activeView === 'flint' && (
        <div
          id="flint-workbench-spec"
          className={`${styles.panel} ${styles.specPanel}`}
          role="tabpanel"
          aria-labelledby="flint-workbench-spec-tab"
        >
          <aside className={styles.inspector} aria-label="Flint Spec inspector">
            <div className={styles.inspectorTitle}>Semantic model</div>
            <div className={styles.inspectorRow}>
              <div className={styles.inspectorLabel}>Chart type</div>
              <div className={styles.inspectorValue}>{displayedChartType ?? 'Unavailable'}</div>
            </div>
            <div className={styles.inspectorRow}>
              <div className={styles.inspectorLabel}>Query fields</div>
              <div className={styles.inspectorValue}>{prepared.table.fields.map((field) => field.name).join(', ')}</div>
            </div>
            <div className={styles.inspectorRow}>
              <div className={styles.inspectorLabel}>Source</div>
              <div className={styles.inspectorValue}>
                {specIsDirty ? 'Manual draft' : draft ? `${draft.source ?? 'AI'} draft` : 'Current Panel'}
              </div>
            </div>
            <div className={styles.inspectorRow}>
              <div className={styles.inspectorLabel}>Validation</div>
              <div
                className={`${styles.inspectorValue} ${
                  specStatus === 'invalid' || specStatus === 'stale' ? styles.invalid : styles.valid
                }`}
              >
                {specStatus === 'checking'
                  ? 'Checking…'
                  : specStatus === 'invalid' && specEvaluation.status === 'invalid'
                    ? specEvaluation.error
                    : specStatus === 'stale'
                      ? 'Stale: Panel query or fields changed'
                      : 'Valid Flint Spec'}
              </div>
            </div>
            <div className={styles.inspectorRow}>
              <div className={styles.inspectorLabel}>Warnings</div>
              <div className={styles.inspectorValue}>{displayedWarningCount ?? 0}</div>
            </div>
            {compiled.error && !specIsDirty && (
              <Alert title="Current Flint Spec cannot compile" severity="error">
                {compiled.error}
              </Alert>
            )}
            <div className={styles.inspectorActions}>
              {specEvaluation.status === 'valid' && specSession && (
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  onClick={() => updateSpecText(specEvaluation.normalizedText)}
                >
                  Format JSON
                </Button>
              )}
              {specStatus === 'stale' && specSession && (
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSpecEvaluation({ status: 'checking' });
                    specDraftControls.onStatusChange('checking');
                    setSpecSession({ ...specSession, context: panelContext });
                  }}
                >
                  Revalidate
                </Button>
              )}
            </div>
          </aside>
          <div className={styles.editor}>
            <CodeEditor
              value={displayedFlintSpec}
              language="json"
              width="100%"
              height="100%"
              wordWrap
              showMiniMap={false}
              showLineNumbers
              readOnly={frameworkIsDirty}
              onChange={updateSpecText}
              onSave={updateSpecText}
              containerStyles={styles.codeEditor}
            />
          </div>
        </div>
      )}

      {activeView === 'framework' && (
        <div
          id="flint-workbench-framework"
          className={`${styles.panel} ${styles.specPanel}`}
          role="tabpanel"
          aria-labelledby="flint-workbench-framework-tab"
        >
          {compiled.error && !lastValidAssembly ? (
            <div className={styles.error}>
              <Alert title="Framework Spec unavailable" severity="error">
                {compiled.error}
              </Alert>
            </div>
          ) : (
            <>
              <aside className={styles.inspector} aria-label="UI Framework Spec inspector">
                <div className={styles.inspectorTitleRow}>
                  <div className={styles.title}>Framework output</div>
                  <IconButton
                    name="info-circle"
                    size="sm"
                    type="button"
                    aria-label="About Framework Override"
                    tooltip="Generated from the validated Flint Spec. You can edit the full output; Apply stores only data-free display changes as a Framework Override."
                    tooltipPlacement="bottom-start"
                  />
                </div>
                <div className={styles.inspectorRow}>
                  <div className={styles.inspectorLabel}>Renderer</div>
                  <div className={styles.inspectorValue}>{lastValidAssembly?.backend ?? compiled.backend}</div>
                </div>
                <div className={styles.inspectorRow}>
                  <div className={styles.inspectorLabel}>Status</div>
                  <div
                    className={`${styles.inspectorValue} ${
                      frameworkStatus === 'invalid' || frameworkStatus === 'stale'
                        ? styles.invalid
                        : overrideWasIgnored
                          ? styles.warning
                          : styles.valid
                    }`}
                  >
                    {frameworkInspectorStatus}
                  </div>
                </div>
                {Boolean(displayedWarningCount) && (
                  <div className={styles.inspectorRow}>
                    <div className={styles.inspectorLabel}>Warnings</div>
                    <div className={`${styles.inspectorValue} ${styles.warningValue}`}>
                      <span>{displayedWarningCount}</span>
                      <IconButton
                        name="info-circle"
                        size="sm"
                        type="button"
                        tooltip={displayedWarnings.join(' ')}
                        tooltipPlacement="bottom-start"
                      />
                    </div>
                  </div>
                )}
                <div className={styles.inspectorActions}>
                  {frameworkEvaluation.status === 'valid' && frameworkSession && (
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => updateFrameworkSpecText(frameworkEvaluation.normalizedText)}
                    >
                      Format JSON
                    </Button>
                  )}
                  {frameworkStatus === 'stale' && frameworkSession && (
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setFrameworkEvaluation({ status: 'checking' });
                        specDraftControls.onStatusChange('checking');
                        setFrameworkSession({ ...frameworkSession, context: panelContext });
                      }}
                    >
                      Revalidate
                    </Button>
                  )}
                  {hasFrameworkOverride && !specIsDirty && (
                    <Button size="sm" type="button" variant="secondary" onClick={resetFrameworkOverride}>
                      Reset override
                    </Button>
                  )}
                </div>
              </aside>
              <div className={styles.editor}>
                <CodeEditor
                  value={displayedFrameworkSpec}
                  language="json"
                  width="100%"
                  height="100%"
                  readOnly={specIsDirty}
                  wordWrap
                  showMiniMap={false}
                  showLineNumbers
                  onChange={updateFrameworkSpecText}
                  onSave={updateFrameworkSpecText}
                  containerStyles={styles.codeEditor}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
