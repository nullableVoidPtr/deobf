import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
	globalIgnores([
		'out/**',
		'src/web_shim.mjs',
	]),
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				sourceType: 'module',
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			indent: ['error', 'tab'],
			quotes: ['error', 'single'],

			'@typescript-eslint/no-unused-vars': ['warn', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
				caughtErrorsIgnorePattern: '^_',
			}],
		},
	},
);