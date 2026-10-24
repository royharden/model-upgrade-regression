// Static syntax check for erasable-syntax .ts files: strips types (no execution) then parses as ESM.
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
let bad = 0;
for (const f of process.argv.slice(2)) {
  try {
    const js = stripTypeScriptTypes(readFileSync(f, 'utf8'), { mode: 'strip' });
    new vm.SourceTextModule(js, { identifier: f });
  } catch (e) { bad++; console.log(`FAIL ${f}: ${e.message.split('\n')[0]}`); }
}
console.log(`checked ${process.argv.length - 2}, failed ${bad}`);
process.exit(bad ? 1 : 0);
