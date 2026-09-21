// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// React 19's browser server renderer expects MessageChannel, which jsdom does
// not install even though the active Node.js runtime provides it.
if (typeof global.MessageChannel !== 'function') {
  global.MessageChannel = class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = {
        postMessage: (data) => queueMicrotask(() => this.port1.onmessage?.({ data })),
      };
    }
  };
}

// flint-chart uses structuredClone, which jsdom does not provide.
if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}
