// lib/client.raw.cjs → lib/client.js в формате клиентских модулей DeepSeek Harness.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const rawUrl = new URL('../lib/client.raw.cjs', import.meta.url)
const body = readFileSync(rawUrl, 'utf8').replace(/\n\/\/# sourceMappingURL=.*$/u, '')
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`
writeFileSync(new URL('../lib/client.js', import.meta.url), wrapped)
rmSync(rawUrl)
rmSync(new URL('../lib/client.raw.cjs.map', import.meta.url), { force: true })
console.log(`lib/client.js: ${wrapped.length} bytes`)
