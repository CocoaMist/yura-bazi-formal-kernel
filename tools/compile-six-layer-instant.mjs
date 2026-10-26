import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
  TEMPORAL_KERNEL_REQUEST_VERSION,
  TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
  admitReleaseManifestV2,
  assertNatalFixedBundleV1,
  buildTemporalKernelRequestV1,
  buildTemporalLayerCandidateSetV1,
  canonicalJsonV1,
  compileTemporalRequest,
  domainHashV1,
} from '../src/index.mjs';
import {
  LUCK_SCHEDULE_BUNDLE_VERSION,
  MAJOR_LUCK_PROFILE_ID,
  MINOR_LUCK_PROFILE_ID,
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  assembleSixLayerCandidateV1,
  buildNamedLuckSchedulesV1,
  resolveTimeRequest,
  scheduleAt,
} from '../capabilities/src/index.mjs';
import { captureExactDataRecord, captureJsonData, deepFreeze } from '../src/shared/assert.mjs';

const REQUEST_VERSION = 'yuracore.six_layer_instant_compile_request.v1';
const OUTPUT_VERSION = 'yuracore.six_layer_instant_bundle.v1';
const ERROR_VERSION = 'yuracore.six_layer_instant_error.v1';
const STEM_ZH = {
  jia: '甲', yi: '乙', bing: '丙', ding: '丁', wu: '戊',
  ji: '己', geng: '庚', xin: '辛', ren: '壬', gui: '癸',
};
const BRANCH_ZH = {
  zi: '子', chou: '丑', yin: '寅', mao: '卯', chen: '辰', si: '巳',
  wu: '午', wei: '未', shen: '申', you: '酉', xu: '戌', hai: '亥',
};

function pillarZh(pillar) {
  return `${STEM_ZH[pillar.stemId]}${BRANCH_ZH[pillar.branchId]}`;
}

function parseInput(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('stdin must contain one JSON object');
  }
  return captureExactDataRecord(value, [
    'version', 'natalFixedBundle', 'natalFixedBundlePath',
    'releaseManifest', 'releaseManifestPath', 'local', 'clockPolicy',
  ], 'SixLayerInstantCompileRequestV1');
}

async function readJsonChoice(input, inlineField, pathField, defaultPath = null) {
  const hasInline = Object.hasOwn(input, inlineField);
  const hasPath = Object.hasOwn(input, pathField);
  if (hasInline && hasPath) throw new TypeError(`${inlineField} and ${pathField} are mutually exclusive`);
  if (hasInline) return captureJsonData(input[inlineField], inlineField);
  const path = hasPath ? input[pathField] : defaultPath;
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError(`${inlineField} or ${pathField} is required`);
  }
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
}

function civilCalendarPath(bundle) {
  const path = bundle.calendarResolution.candidatePaths.find((row) => (
    row.calendarResolution?.request?.solarTime?.mode === 'civil'
    || row.decisionPath?.decisions?.solarClock === 'civil'
));
if (path == null) throw new TypeError('natal bundle has no civil calendar path');
  const binding = bundle.pathBindings.find((row) => row.candidateOrdinal === path.candidateOrdinal);
  if (binding == null || binding.fixedStateRef == null) {
    throw new TypeError('civil calendar path has no compiled fixed state');
  }
  return { path, binding };
}

function genuineFiveHe(match, leftStemId, rightStemId) {
  if (match.relationRuleId !== 'bazi.relation_rule.stem_five_combination.v1') return false;
  return leftStemId !== rightStemId
    && Array.isArray(match.requiredSymbols)
    && match.requiredSymbols.includes(leftStemId)
    && match.requiredSymbols.includes(rightStemId);
}

function keepStructuralMatch(match, leftStemId, rightStemId) {
  if (!String(match.relationRuleId).startsWith('bazi.relation_rule.')) return false;
  if (match.relationRuleId === 'bazi.relation_rule.stem_five_combination.v1') {
    return genuineFiveHe(match, leftStemId, rightStemId);
  }
  return true;
}

function shortRule(relationRuleId) {
  return relationRuleId.replace(/^bazi\.relation_rule\./, '').replace(/\.v1$/, '');
}

function projectPairs(pairs) {
  return pairs.map((pair) => {
    const structural = pair.structuralMatches
      .filter((match) => keepStructuralMatch(match, pair.left.stemId, pair.right.stemId))
      .map((match) => ({
        rule: shortRule(match.relationRuleId),
        membership: match.membership,
        missing: match.missingRequirements,
      }));
    return {
      left: `${pair.left.layerId}:${pillarZh(pair.left)}`,
      right: `${pair.right.layerId}:${pillarZh(pair.right)}`,
      structural,
    };
  }).filter((row) => row.structural.length > 0);
}

function natalSlotOf(occurrenceRef) {
  const match = /^pillar\.(year|month|day|hour)\.(visible_stem|branch)$/.exec(occurrenceRef);
  return match == null ? occurrenceRef : `${match[1]}.${match[2] === 'visible_stem' ? 'stem' : 'branch'}`;
}

function projectNatalMatches(matchSet, layers, natalPillars) {
  return matchSet.matches.flatMap((match) => {
    if (!String(match.relationRuleId).startsWith('bazi.relation_rule.')) return [];
    const temporalId = match.temporalOccurrenceRefs[0];
    const layer = layers.find((item) => (
      item.stemOccurrenceId === temporalId || item.branchOccurrenceId === temporalId
    ));
    if (layer == null) return [];
    if (match.relationRuleId === 'bazi.relation_rule.stem_five_combination.v1') {
      const natalStemRef = match.natalOccurrenceRefs.find((ref) => ref.endsWith('.visible_stem'));
      const natalSlot = natalStemRef?.match(/^pillar\.(year|month|day|hour)\./)?.[1];
      const natalStemId = natalSlot == null ? null : natalPillars[natalSlot].stemId;
      if (!genuineFiveHe(match, layer.stemId, natalStemId)) return [];
    }
    return [{
      temporal: `${layer.layerId}:${pillarZh(layer)}`,
      natal: match.natalOccurrenceRefs.map(natalSlotOf),
      rule: shortRule(match.relationRuleId),
      membership: match.membership,
      missing: match.missingRequirements,
    }];
  });
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = parseInput(Buffer.concat(chunks).toString('utf8'));
  if (input.version !== REQUEST_VERSION) throw new TypeError('six-layer instant request version is unsupported');
  if (input.clockPolicy !== 'civil') throw new TypeError('clockPolicy must be civil for this adapter');
  if (typeof input.local !== 'string' || input.local.length === 0) {
    throw new TypeError('local is required');
  }

  const natalFixedBundle = assertNatalFixedBundleV1(await readJsonChoice(
    input,
    'natalFixedBundle',
    'natalFixedBundlePath',
  ));
  const releaseSource = await readJsonChoice(
    input,
    'releaseManifest',
    'releaseManifestPath',
    'release-manifest.json',
  );
  const releaseContext = admitReleaseManifestV2(JSON.stringify(releaseSource));
  if (natalFixedBundle.release.releaseManifestHash !== releaseContext.releaseManifestHash) {
    throw new TypeError('natalFixedBundle and releaseManifest do not share release identity');
  }

  const { path, binding } = civilCalendarPath(natalFixedBundle);
  const state = natalFixedBundle.fixedStatesByHash[binding.fixedStateRef];
  const pillars = state.coordinates.pillars;
  const birthResolution = path.calendarResolution;
  const decisions = path.decisionPath.decisions;
  const schedules = buildNamedLuckSchedulesV1({
    version: LUCK_SCHEDULE_BUNDLE_VERSION,
    subjectRef: natalFixedBundle.subjectContext.subjectRef,
    snapshotRef: natalFixedBundle.bundleHash,
    traditionalSexClass: natalFixedBundle.subjectContext.traditionalSexClass,
    yearStemId: pillars.year.stemId,
    monthPillar: pillars.month,
    hourPillar: pillars.hour,
    birthInstant: birthResolution.resolvedInstantIso,
    previousJieInstant: decisions.previousJieInstant,
    nextJieInstant: decisions.nextJieInstant,
    calendarBasisRef: 'calendar:gregorian',
    boundaryProfileRef: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    locationTimeRef: `timezone:${natalFixedBundle.subjectContext.birthInput.timeZoneId}`,
    authorityRef: 'capability:named-luck-schedule.v1',
    majorLuckProfileId: MAJOR_LUCK_PROFILE_ID,
    minorLuckProfileId: MINOR_LUCK_PROFILE_ID,
    inputDependencyRefs: [birthResolution.request.requestHash],
  });

  const location = natalFixedBundle.subjectContext.birthInput.location;
  const target = await resolveTimeRequest({
    version: 'bazi.time_request.v1',
    mode: 'instant',
    calendar: natalFixedBundle.subjectContext.birthInput.calendar,
    timeZoneId: natalFixedBundle.subjectContext.birthInput.timeZoneId,
    location,
    solarTime: { mode: 'civil' },
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    input: { local: input.local },
  }, REFERENCE_CALENDAR_PROVIDER);

  const major = scheduleAt(schedules.majorLuckSchedule, target.resolved.atMs, 'major_luck');
  const minor = scheduleAt(schedules.minorLuckSchedule, target.resolved.atMs, 'minor_luck');
  const candidate = assembleSixLayerCandidateV1({
    subjectRef: natalFixedBundle.subjectContext.subjectRef,
    resolution: target,
    majorSegment: major,
    minorSegment: minor,
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    timeZoneId: natalFixedBundle.subjectContext.birthInput.timeZoneId,
    provenanceRefs: [
      `luck-schedule:${schedules.bundleHash}`,
      `natal-fixed-bundle:${natalFixedBundle.bundleHash}`,
    ],
  });
  const candidateSet = buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef: natalFixedBundle.subjectContext.subjectRef,
    candidates: [{
      temporalCandidateId: `instant:${target.resolutionHash}`,
      calendarDecisionPathRef: `calendar-path:${target.resolutionHash}`,
      candidate,
    }],
    provenanceRefs: [`luck-schedule:${schedules.bundleHash}`],
  });
  const request = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: natalFixedBundle.bundleHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    activeProfileId: natalFixedBundle.release.profileId,
    subjectRef: natalFixedBundle.subjectContext.subjectRef,
    targetRangeRef: `instant:${input.local}`,
    provenanceRefs: [
      `luck-schedule:${schedules.bundleHash}`,
      `natal-fixed-bundle:${natalFixedBundle.bundleHash}`,
    ],
    metadata: {
      sampling: 'single_civil_instant',
      notIntervalCoverage: true,
      majorLuckProfileId: MAJOR_LUCK_PROFILE_ID,
      minorLuckProfileId: MINOR_LUCK_PROFILE_ID,
    },
  });
  const batch = compileTemporalRequest(
    request,
    candidateSet,
    natalFixedBundle,
    releaseContext,
  );
  const compiled = batch.results[0];
if (compiled.status !== 'compiled') {
throw new TypeError(`six-layer compile did not compile: ${compiled.status}`);
}
const fixedStateResult = compiled.fixedStateResults.find((result) => (
result.fixedStateHash === binding.fixedStateRef
));
if (fixedStateResult == null) {
throw new TypeError('six-layer compile has no result for the selected civil fixed state');
}
  const layers = compiled.candidate.layers.map((layer) => ({
    layerId: layer.layerId,
    pillar: pillarZh(layer),
    stemId: layer.stemId,
    branchId: layer.branchId,
    validFromMs: layer.validFromMs,
    validUntilMs: layer.validUntilMs,
    calculationProfileRef: layer.calculationProfileRef,
    subjectBound: layer.subjectRef != null,
  }));
  const natalTemporal = projectNatalMatches(
fixedStateResult.rawStructuralMatchSet,
    compiled.candidate.layers,
    pillars,
  );
  const natalTemporalComplete = natalTemporal.filter((row) => row.membership === 'complete_membership');
  const identity = deepFreeze({
    version: OUTPUT_VERSION,
    local: input.local,
natalFixedBundleHash: natalFixedBundle.bundleHash,
fixedStateRef: binding.fixedStateRef,
    luckScheduleHash: schedules.bundleHash,
    temporalKernelBatchHash: batch.temporalKernelBatchHash,
    luckStartInstant: schedules.luckStartInstant,
    direction: schedules.direction,
    majorLuckProfileId: MAJOR_LUCK_PROFILE_ID,
    minorLuckProfileId: MINOR_LUCK_PROFILE_ID,
    competingMinorMethodsNotSelected: true,
    judgmentStatus: compiled.judgmentStatus,
    causalStatus: compiled.causalStatus,
    effectEligible: compiled.effectEligible,
    compileTemporalRequestCalled: true,
  });
  process.stdout.write(`${canonicalJsonV1({
    ...identity,
    natalPillars: {
      year: pillarZh(pillars.year),
      month: pillarZh(pillars.month),
      day: pillarZh(pillars.day),
      hour: pillarZh(pillars.hour),
    },
    layers,
    interTemporalPairs: projectPairs(compiled.interTemporalRelationSet.pairs),
    natalTemporalRelationRules: natalTemporalComplete,
    natalTemporalPartialCount: natalTemporal.length - natalTemporalComplete.length,
mixedCompleteGroups: fixedStateResult.mixedCompleteGroupSet.groups.map((group) => ({
      groupId: group.groupId,
      requiredSymbols: group.requiredSymbols,
      occurrenceRefs: group.occurrenceRefs,
    })),
    sixLayerInstantHash: domainHashV1('yuracore.six_layer_instant_bundle.v1', identity),
  })}\n`);
}

main().catch((error) => {
  const body = {
    version: ERROR_VERSION,
    stableErrorCode: error instanceof TypeError || error instanceof RangeError
      ? 'yuracore.six_layer_instant_error.invalid_input'
      : 'yuracore.six_layer_instant_error.internal_error',
    retryable: !(error instanceof TypeError || error instanceof RangeError),
  };
  process.stderr.write(`${canonicalJsonV1({
    ...body,
    errorHash: domainHashV1('yuracore.six_layer_instant_error.v1', body),
    diagnostics: { errorName: error?.name ?? 'Error', message: error?.message ?? String(error) },
  })}\n`);
  process.exitCode = 1;
});
