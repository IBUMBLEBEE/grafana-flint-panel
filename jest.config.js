process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

const baseConfig = require('./.config/jest.config');

module.exports = {
  ...baseConfig,
  transformIgnorePatterns: [
    nodeModulesToTransform([
      ...grafanaESModules,
      '@react-hookz',
      '@uwdata',
      '@ver0',
      'd3.*',
      'delaunator',
      'flint-chart',
      'internmap',
      'robust-predicates',
      'vega.*',
    ]),
  ],
};
