import { readFile } from 'node:fs/promises';
import {
  admitReleaseManifestV2,
  canonicalJsonV1,
  compileNatalRequest,
} from '../src/index.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const releaseSource = input.releaseManifestPath == null
  ? canonicalJsonV1(input.releaseManifest)
  : await readFile(input.releaseManifestPath, 'utf8');
const releaseContext = admitReleaseManifestV2(releaseSource);
const batch = compileNatalRequest(
  input.request,
  input.candidateSnapshotSet,
  input.calendarDecisionTrace,
  releaseContext,
);
process.stdout.write(`${canonicalJsonV1(batch)}\n`);
