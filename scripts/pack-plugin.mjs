import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function packPlugin(directory, output) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const compiled = await build({
    entryPoints: [resolve(directory, 'main.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2020',
    write: false,
    metafile: true,
  });
  if (Object.values(compiled.metafile.outputs).some((o) => o.imports.length))
    throw new Error('Plugin must be a self-contained JavaScript module');
  const source = compiled.outputFiles[0].text;
  const result = JSON.stringify({ ...manifest, runtime: { ...manifest.runtime, source } }, null, 2) + '\n';
  if (Buffer.byteLength(source) > 200000 || Buffer.byteLength(result) > 256000)
    throw new Error('Plugin exceeds package size limits');
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, result);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw new Error('Usage: npm run plugin:pack -- PLUGIN_DIRECTORY OUTPUT.json');
  await packPlugin(directory, output);
  console.log(output);
}
