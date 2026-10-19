import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const SECRET_ENV = /^(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)$/

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // NFR-SEC-01: secret key hanya boleh dibaca di satu tempat.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/supabase/admin.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.name=${SECRET_ENV}]`,
          message: 'Secret key Supabase hanya boleh dibaca di src/lib/supabase/admin.ts (NFR-SEC-01).',
        },
        {
          selector: 'MemberExpression[object.object.name=\'process\'][object.property.name=\'env\'][property.name=/^NEXT_PUBLIC_.*(SECRET|SERVICE_ROLE)/]',
          message: 'Nilai rahasia tidak boleh memakai prefix NEXT_PUBLIC_ (akan dikirim ke browser).',
        },
      ],
    },
  },
  {
    // Koreksi #2: sesi hanya di server (cookie HttpOnly) — client Supabase di
    // browser tidak akan melihat sesi. Lihat docs/review-fase-0.md.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/ssr',
              importNames: ['createBrowserClient'],
              message:
                'Sesi Supabase disimpan di cookie HttpOnly dan hanya dibaca server. Ambil data lewat Server Component / Server Action / Route Handler (koreksi #2).',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'supabase/.temp/**']),
])

export default eslintConfig
