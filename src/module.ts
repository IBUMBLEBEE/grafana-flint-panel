import React, { lazy, Suspense } from 'react';
import { PanelPlugin, type StandardEditorProps } from '@grafana/data';

import { FlintPanel } from './components/FlintPanel';
import { defaultAiConfig, type FlintAiConfig, FlintOptions } from './types';
import { hasLegacyDataScope, migrateFlintOptions } from './migrations';

const LazyAiAssistEditor = lazy(() =>
  import(/* webpackChunkName: "ai-assist" */ './components/AiAssistEditor').then(({ AiAssistEditor }) => ({
    default: AiAssistEditor,
  }))
);

const AiAssistEditor = (props: StandardEditorProps<FlintAiConfig, unknown, FlintOptions>) =>
  React.createElement(Suspense, { fallback: null }, React.createElement(LazyAiAssistEditor, props));

export const plugin = new PanelPlugin<FlintOptions>(FlintPanel)
  .setMigrationHandler(migrateFlintOptions, hasLegacyDataScope)
  .setPanelOptions((builder) => {
    return builder.addCustomEditor({
      id: 'ai',
      path: 'ai',
      name: 'AI Assist',
      description: 'Data hints plus provider-free Auto and explicit Generate through a selected Flint AI data source.',
      category: ['AI Assist'],
      editor: AiAssistEditor,
      defaultValue: defaultAiConfig,
    });
  });
