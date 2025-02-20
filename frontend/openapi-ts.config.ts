import { defaultPlugins } from '@hey-api/openapi-ts';

const config = {
  input: './../src/utils/generator/swagger-generator/openapi-docs.json',
  output: 'src/lib/api/generated',
  plugins: [
    ...defaultPlugins,
    '@hey-api/client-axios',
    '@hey-api/schemas',
    {
      dates: true,
      name: '@hey-api/transformers',
    },
    {
      enums: 'javascript',
      name: '@hey-api/typescript',
    },
    {
      name: '@hey-api/sdk',
      transformer: true,
    },
  ],
};

export default config;
