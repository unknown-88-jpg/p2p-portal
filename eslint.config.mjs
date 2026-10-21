import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

// Aturan arsitektur: domain murni (tanpa I/O), repo hanya bergantung ke domain,
// infra tidak boleh dipakai domain/repo-port. Pelanggaran = lint merah = CI merah.
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/**/*', mode: 'full' },
        { type: 'ports', pattern: 'src/ports/**/*', mode: 'full' },
        { type: 'testing', pattern: 'src/testing/**/*', mode: 'full' },
        { type: 'repo', pattern: 'src/repo/**/*', mode: 'full' },
        { type: 'infra', pattern: 'src/infra/**/*', mode: 'full' },
        { type: 'lib', pattern: 'src/lib/**/*', mode: 'full' },
        { type: 'server', pattern: 'src/server/**/*', mode: 'full' },
        { type: 'app', pattern: 'src/app/**/*', mode: 'full' },
        { type: 'ui', pattern: 'src/ui/**/*', mode: 'full' },
      ],
    },
    rules: {
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'domain', allow: ['domain'] },
          { from: 'lib', allow: ['lib', 'domain'] },
          { from: 'ports', allow: ['ports', 'repo', 'domain', 'lib'] },
          { from: 'testing', allow: ['testing', 'ports', 'repo', 'domain', 'lib', 'infra', 'server'] },
          { from: 'repo', allow: ['repo', 'domain', 'lib'] },
          { from: 'infra', allow: ['infra', 'ports', 'repo', 'domain', 'lib'] },
          { from: 'server', allow: ['server', 'ports', 'domain', 'repo', 'infra', 'lib'] },
          { from: 'app', allow: ['app', 'server', 'lib', 'ui', 'domain'] },
          { from: 'ui', allow: ['ui', 'lib', 'domain'] },
        ],
      }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
