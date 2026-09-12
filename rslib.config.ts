import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: true,
      output: {
        // Babylon is a peer dependency: the consuming app already has it, and
        // bundling it here would ship a second copy of the engine (and turn a
        // ~200 kB library into a ~2.4 MB one).
        externals: [
          /^@babylonjs\/core(\/.*)?$/,
        ],
      },
    },
  ],
});
