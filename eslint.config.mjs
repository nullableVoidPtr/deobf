import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'out/**',
			'src/web_shim.mjs',
		],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
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