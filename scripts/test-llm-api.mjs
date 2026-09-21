#!/usr/bin/env node
/**
 * Smoke-test OpenAI-compatible Chat Completions using OPENAI_* env vars.
 *
 *   OPENAI_BASE_URL=https://api.example/v1 \
 *   OPENAI_AUTH_TOKEN=sk-... \
 *   OPENAI_MODEL=deepseek-v4-pro \
 *   node scripts/test-llm-api.mjs
 */

const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const apiKey = process.env.OPENAI_AUTH_TOKEN || '';
const model = process.env.OPENAI_MODEL || 'deepseek-v4-pro';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!apiKey) {
  fail('OPENAI_AUTH_TOKEN is not set');
}

const sampleRows = [
  { region: 'North', revenue: 120 },
  { region: 'South', revenue: 90 },
];

const body = {
  model,
  temperature: 0.2,
  response_format: { type: 'json_object' },
  messages: [
    {
      role: 'system',
      content:
        'Return a single JSON object with chartType, xField, yField, colorField, specJson, rationale for a bar chart.',
    },
    {
      role: 'user',
      content: `Data sample:\n${JSON.stringify(sampleRows, null, 2)}\nSuggest Flint panel options.`,
    },
  ],
};

console.log(`Testing ${baseUrl}/chat/completions`);
console.log(`Model: ${model}`);

const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
});

const text = await response.text();
if (!response.ok) {
  fail(`HTTP ${response.status}: ${text.slice(0, 500)}`);
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  fail(`Non-JSON response: ${text.slice(0, 200)}`);
}

const content = payload.choices?.[0]?.message?.content;
if (!content) {
  fail('Response missing choices[0].message.content');
}

let parsed;
try {
  parsed = JSON.parse(content);
} catch {
  fail(`Model content is not JSON: ${content.slice(0, 200)}`);
}

console.log('OK — model returned valid JSON:');
console.log(JSON.stringify(parsed, null, 2));
