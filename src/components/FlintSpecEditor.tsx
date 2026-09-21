import React, { useMemo } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { CodeEditor } from '@grafana/ui';

export const FlintSpecEditor: React.FC<StandardEditorProps<string>> = ({ value, onChange }) => {
  const text = value ?? '';
  // Remount when AI / external apply updates specJson — Monaco keeps internal buffer otherwise.
  const editorKey = useMemo(() => `${text.length}:${text.slice(0, 64)}`, [text]);

  return (
    <CodeEditor
      key={editorKey}
      language="json"
      width="100%"
      height={220}
      value={text}
      showLineNumbers={true}
      showMiniMap={false}
      onBlur={onChange}
    />
  );
};
