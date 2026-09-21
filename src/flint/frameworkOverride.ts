import type { ChartAssemblyInput } from 'flint-chart';

import type { FrameworkOverride, FrameworkOverrides, FrameworkPatchOperation, RenderBackend } from '../types';

export const FLINT_CHART_COMPILER_VERSION = '0.5.1';
const MAX_FRAMEWORK_SPEC_BYTES = 256 * 1024;
const MAX_PATCH_OPERATIONS = 512;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface OverrideArgs {
  backend: RenderBackend;
  input: ChartAssemblyInput;
  generated: Record<string, unknown>;
}

interface CreateOverrideArgs extends OverrideArgs {
  edited: Record<string, unknown>;
}

interface ApplyOverrideArgs extends OverrideArgs {
  override?: FrameworkOverride;
}

export interface AppliedFrameworkOverride {
  payload: Record<string, unknown>;
  warnings: string[];
}

/** Keep an explicit deletion marker until Grafana has merged the new Panel options. */
export function clearFrameworkOverride(
  overrides: FrameworkOverrides | undefined,
  backend: RenderBackend
): FrameworkOverrides {
  return { ...overrides, [backend]: undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalText(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function frameworkSourceFingerprint(backend: RenderBackend, input: ChartAssemblyInput): string {
  const { canvasSize: _canvasSize, baseSize: _baseSize, ...chartSpec } = input.chart_spec;
  return hashText(
    canonicalText({
      backend,
      compilerVersion: FLINT_CHART_COMPILER_VERSION,
      semantic_types: input.semantic_types,
      field_display_names: input.field_display_names,
      options: input.options,
      chart_spec: chartSpec,
    })
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalText(left) === canonicalText(right);
}

function isRuntimeOwnedPath(backend: RenderBackend, path: string[]): boolean {
  if (backend === 'vegalite') {
    return path[0] === 'data' || (path.length === 1 && ['width', 'height', 'autosize'].includes(path[0]));
  }

  if (backend === 'echarts') {
    if (path[0] === 'dataset') {
      return true;
    }
    if ((path[0] === 'xAxis' || path[0] === 'yAxis') && path.slice(1, 3).includes('data')) {
      return true;
    }
    return path[0] === 'series' && path[2] === 'data';
  }

  if (backend === 'plotly') {
    if (path[0] === 'layout' && path.length === 2 && ['width', 'height'].includes(path[1])) {
      return true;
    }
    if (path[0] === 'layout' && (path[1] === 'xaxis' || path[1] === 'yaxis') && path[2] === 'categoryarray') {
      return true;
    }
    return (
      path[0] === 'data' &&
      path.length >= 3 &&
      ['x', 'y', 'z', 'values', 'labels', 'ids', 'customdata'].includes(path[2])
    );
  }

  return (
    (path[0] === 'data' && path[1] === 'labels') || (path[0] === 'data' && path[1] === 'datasets' && path[3] === 'data')
  );
}

function isRuntimeContainerPath(backend: RenderBackend, path: string[]): boolean {
  if (backend === 'echarts') {
    const isSeriesOrAxis = path[0] === 'series' || path[0] === 'xAxis' || path[0] === 'yAxis';
    const isIndexedEntry = path.length === 2 && /^\d+$/.test(path[1]);
    return (isSeriesOrAxis && (path.length === 1 || isIndexedEntry)) || path[0] === 'dataset';
  }
  if (backend === 'plotly') {
    return (path[0] === 'data' && path.length <= 2) || (path[0] === 'layout' && path.length === 1);
  }
  if (backend === 'chartjs') {
    return (
      (path[0] === 'data' && path.length === 1) || (path[0] === 'data' && path[1] === 'datasets' && path.length <= 3)
    );
  }
  return path[0] === 'data';
}

function pointer(path: string[]): string {
  return `/${path.map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function assertSafeValue(value: unknown, path: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeValue(child, [...path, String(index)]));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`UI Framework Spec contains unsafe key "${key}" at ${pointer([...path, key])}`);
    }
    if (key === 'data') {
      throw new Error(`UI Framework Spec cannot add embedded data at ${pointer([...path, key])}`);
    }
    assertSafeValue(child, [...path, key]);
  }
}

function diffValue(
  backend: RenderBackend,
  generated: unknown,
  edited: unknown,
  path: string[],
  operations: FrameworkPatchOperation[]
): void {
  if (sameJson(generated, edited)) {
    return;
  }
  if (isRuntimeOwnedPath(backend, path)) {
    throw new Error(`UI Framework Spec cannot modify query data or runtime sizing at ${pointer(path)}`);
  }

  if (Array.isArray(generated) && Array.isArray(edited)) {
    if (generated.length !== edited.length) {
      if (isRuntimeContainerPath(backend, path)) {
        throw new Error(`UI Framework Spec cannot change runtime series structure at ${pointer(path)}`);
      }
      assertSafeValue(edited, path);
      operations.push({ op: 'replace', path: pointer(path), value: cloneJson(edited) });
      return;
    }
    generated.forEach((value, index) => diffValue(backend, value, edited[index], [...path, String(index)], operations));
    return;
  }

  if (isRecord(generated) && isRecord(edited)) {
    const keys = new Set([...Object.keys(generated), ...Object.keys(edited)]);
    for (const key of keys) {
      if (UNSAFE_KEYS.has(key)) {
        throw new Error(`UI Framework Spec contains unsafe key "${key}" at ${pointer([...path, key])}`);
      }
      diffValue(backend, generated[key], edited[key], [...path, key], operations);
    }
    return;
  }

  if (isRuntimeContainerPath(backend, path)) {
    throw new Error(`UI Framework Spec cannot replace runtime-owned structure at ${pointer(path)}`);
  }
  if (edited === undefined) {
    operations.push({ op: 'remove', path: pointer(path) });
    return;
  }
  assertSafeValue(edited, path);
  operations.push({
    op: generated === undefined ? 'add' : 'replace',
    path: pointer(path),
    value: cloneJson(edited),
  });
}

function parsePointer(value: string): string[] {
  if (!value.startsWith('/') || value === '/') {
    throw new Error(`Invalid UI Framework override path "${value}"`);
  }
  return value
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function applyOperation(root: Record<string, unknown>, operation: FrameworkPatchOperation): void {
  const path = parsePointer(operation.path);
  const key = path.at(-1)!;
  if (UNSAFE_KEYS.has(key) || path.some((part) => UNSAFE_KEYS.has(part))) {
    throw new Error(`Unsafe UI Framework override path "${operation.path}"`);
  }

  let parent: unknown = root;
  for (const part of path.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        throw new Error(`UI Framework override path no longer exists: ${operation.path}`);
      }
      parent = parent[index];
    } else if (isRecord(parent) && Object.hasOwn(parent, part)) {
      parent = parent[part];
    } else {
      throw new Error(`UI Framework override path no longer exists: ${operation.path}`);
    }
  }

  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`UI Framework override array path no longer exists: ${operation.path}`);
    }
    if (operation.op === 'remove') {
      parent.splice(index, 1);
    } else {
      parent[index] = cloneJson(operation.value);
    }
    return;
  }
  if (!isRecord(parent)) {
    throw new Error(`UI Framework override parent no longer exists: ${operation.path}`);
  }
  if (operation.op === 'remove') {
    delete parent[key];
  } else {
    parent[key] = cloneJson(operation.value);
  }
}

export function createFrameworkOverride(args: CreateOverrideArgs): FrameworkOverride | undefined {
  if (!isRecord(args.generated) || !isRecord(args.edited)) {
    throw new Error('UI Framework Spec must be a JSON object');
  }
  if (new TextEncoder().encode(JSON.stringify(args.edited)).length > MAX_FRAMEWORK_SPEC_BYTES) {
    throw new Error(`UI Framework Spec exceeds the ${MAX_FRAMEWORK_SPEC_BYTES / 1024} KiB limit`);
  }

  const patch: FrameworkPatchOperation[] = [];
  diffValue(args.backend, args.generated, args.edited, [], patch);
  if (!patch.length) {
    return undefined;
  }
  if (patch.length > MAX_PATCH_OPERATIONS) {
    throw new Error(`UI Framework Spec produces more than ${MAX_PATCH_OPERATIONS} saved edits`);
  }

  return {
    version: 1,
    backend: args.backend,
    compilerVersion: FLINT_CHART_COMPILER_VERSION,
    sourceFingerprint: frameworkSourceFingerprint(args.backend, args.input),
    patch,
  };
}

export function validateFrameworkOverrides(overrides: FrameworkOverrides | undefined): void {
  if (overrides === undefined) {
    return;
  }
  if (!isRecord(overrides)) {
    throw new Error('UI Framework overrides must be an object');
  }
  for (const [backend, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    if (!['echarts', 'vegalite', 'plotly', 'chartjs'].includes(backend) || !isRecord(value)) {
      throw new Error(`Invalid UI Framework override for "${backend}"`);
    }
    const override = value as unknown as FrameworkOverride;
    if (
      override.version !== 1 ||
      override.backend !== backend ||
      typeof override.compilerVersion !== 'string' ||
      typeof override.sourceFingerprint !== 'string' ||
      !Array.isArray(override.patch) ||
      override.patch.length > MAX_PATCH_OPERATIONS
    ) {
      throw new Error(`Invalid UI Framework override metadata for "${backend}"`);
    }
    for (const operation of override.patch) {
      if (
        !isRecord(operation) ||
        !['add', 'replace', 'remove'].includes(operation.op) ||
        typeof operation.path !== 'string'
      ) {
        throw new Error(`Invalid UI Framework patch operation for "${backend}"`);
      }
      const operationPath = parsePointer(operation.path);
      if (isRuntimeOwnedPath(backend as RenderBackend, operationPath)) {
        throw new Error(`UI Framework override cannot modify query data or runtime sizing at ${operation.path}`);
      }
      if (isRuntimeContainerPath(backend as RenderBackend, operationPath)) {
        throw new Error(`UI Framework override cannot replace runtime-owned structure at ${operation.path}`);
      }
      if (operation.op !== 'remove') {
        if (!Object.hasOwn(operation, 'value')) {
          throw new Error(`UI Framework patch operation requires a value at ${operation.path}`);
        }
        assertSafeValue(operation.value, operationPath);
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(overrides)).length > MAX_FRAMEWORK_SPEC_BYTES) {
    throw new Error(`UI Framework overrides exceed the ${MAX_FRAMEWORK_SPEC_BYTES / 1024} KiB limit`);
  }
}

export function applyFrameworkOverride(args: ApplyOverrideArgs): AppliedFrameworkOverride {
  if (!args.override) {
    return { payload: args.generated, warnings: [] };
  }
  if (args.override.version !== 1 || args.override.backend !== args.backend) {
    return { payload: args.generated, warnings: ['Ignored an incompatible UI Framework override.'] };
  }
  if (args.override.compilerVersion !== FLINT_CHART_COMPILER_VERSION) {
    return {
      payload: args.generated,
      warnings: ['Ignored the UI Framework override because the Flint compiler version changed.'],
    };
  }
  if (args.override.sourceFingerprint !== frameworkSourceFingerprint(args.backend, args.input)) {
    return {
      payload: args.generated,
      warnings: ['Ignored the UI Framework override because its Flint source changed.'],
    };
  }

  try {
    const payload = cloneJson(args.generated);
    for (const operation of args.override.patch) {
      const operationPath = parsePointer(operation.path);
      if (isRuntimeOwnedPath(args.backend, operationPath)) {
        throw new Error(`override contains a runtime-owned path: ${operation.path}`);
      }
      if (isRuntimeContainerPath(args.backend, operationPath)) {
        throw new Error(`override replaces runtime-owned structure: ${operation.path}`);
      }
      if (operation.op !== 'remove') {
        assertSafeValue(operation.value, operationPath);
      }
      applyOperation(payload, operation);
    }
    return { payload, warnings: [] };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { payload: args.generated, warnings: [`Ignored an invalid UI Framework override: ${message}`] };
  }
}
