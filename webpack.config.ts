import path from 'path';
import type { Configuration } from 'webpack';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  return {
    ...baseConfig,
    entry: { module: path.join(process.cwd(), 'src', 'module.ts') },
    plugins: baseConfig.plugins,
  };
};

export default config;
