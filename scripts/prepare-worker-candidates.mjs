import { readFile, writeFile } from 'node:fs/promises';
import { reviewItems } from './render-review-board.mjs';

const report=JSON.parse(await readFile('.tmp/candidates.json','utf8'));
const candidates=reviewItems(report).map(item=>({
  ...item,liked:false,status:'review_only'
}));
const moduleText='// Auto-generated during deployment; do not commit real user lists.\n'+
  'export const candidates = '+JSON.stringify(candidates)+';\n';
await writeFile('src/worker-candidates.mjs',moduleText,'utf8');
console.log('Worker candidate count: '+candidates.length);
