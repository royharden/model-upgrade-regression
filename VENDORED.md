# Provenance

`src/shared/{providers,callledger,evalkit,cited,rulings}.ts` are small, locally authored contract ports. No implementation was copied from upstream repositories. Their names describe responsibilities; they do not claim compatibility with packages of the same name.

The portable provider parsers, request builder, billing adapter and edge handler were authored for this repository. Anthropic Messages and OpenAI-compatible Chat Completions response shapes inform these adapters; fixtures are synthetic and contain no real provider traffic. Tool calls are retained as data and are never invoked.

Runtime libraries are pinned in `package.json`: zod (MIT), Ajv (MIT), `@noble/hashes` (MIT), `diff` (BSD-3-Clause), React (MIT), and `@supabase/supabase-js` (MIT). Dependencies are referenced, not vendored here. Dependency installation, lockfile generation and transitive-license review remain deferred.

The edge imports the existing `src/core/regressdiff` canonical serialiser, normaliser, schemas and hashes. `supabase/functions/run-task/deno.json` pins matching npm versions for those core imports; the portable folder has only relative `.ts` imports. Deployment must explicitly bundle those files outside the function directory and verify Deno/npm resolution before activation. Source inspection cannot prove deployment packaging.
