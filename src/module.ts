import React, { lazy, Suspense } from 'react';
import { PanelPlugin, type StandardEditorProps } from '@grafana/data';

import { FlintPanel } from './components/FlintPanel';
import { defaultAiConfig, type FlintAiConfig, FlintOptions } from './types';
import { needsChartStateMigration, migrateFlintOptions } from './migrations';

const LazyAiAssistEditor = lazy(() =>
  import(/* webpackChunkName: "ai-assist" */ './components/AiAssistEditor').then(({ AiAssistEditor }) => ({
    default: AiAssistEditor,
  }))
);

const AiAssistEditor = (props: StandardEditorProps<FlintAiConfig, unknown, FlintOptions>) =>
  React.createElement(Suspense, { fallback: null }, React.createElement(LazyAiAssistEditor, props));

export const plugin = new PanelPlugin<FlintOptions>(FlintPanel)
  .setMigrationHandler(migrateFlintOptions, needsChartStateMigration)
  .setPanelOptions((builder) => {
    return builder.addCustomEditor({
      id: 'ai',
      path: 'ai',
      name: 'Chart workbench',
      description: 'Configure charts manually, preview and apply changes. AI Chat is optional.',
      category: ['Chart settings'],
      editor: AiAssistEditor,
      defaultValue: defaultAiConfig,
    });
  });
