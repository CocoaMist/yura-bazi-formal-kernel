import { captureExactDataRecord, deepFreeze, requiredString } from '../shared/assert.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';
import { assertTypedFact, factDerivationOf } from './typed-fact.mjs';

export const TYPED_FACT_CLOSURE_VERSION = 'formal.typed_fact_closure.v2';
export const TYPED_FACT_CLOSURE_PROFILE_VERSION = 'formal.typed_fact_closure_profile.v1';
export const CLOSURE_ENGINE_IDENTITY = deepFreeze({
  engineId: 'formal.delta_typed_fact_closure',
  engineVersion: 'formal.delta_typed_fact_closure.v1',
});
export const TYPED_FACT_CLOSURE_STATUSES = Object.freeze([
  'running', 'fixed_point', 'limit_reached', 'non_converged', 'failed',
]);

const typedFactClosures = new WeakSet();
const closureProfiles = new WeakSet();

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}

export function buildTypedFactClosureProfileV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'closureRuleRegistryHash', 'releaseManifestHash', 'maxRounds', 'maxFacts',
  ], 'TypedFactClosureProfileV1');
  if (source.version !== TYPED_FACT_CLOSURE_PROFILE_VERSION) {
    throw new TypeError('TypedFactClosureProfileV1.version is unsupported');
  }
  for (const field of ['closureRuleRegistryHash', 'releaseManifestHash']) {
    if (!/^sha256:[0-9a-f]{64}$/.test(source[field] ?? '')) {
      throw new TypeError(`TypedFactClosureProfileV1.${field} must be a sha256 hash`);
    }
  }
  const body = deepFreeze({
    version: source.version,
    closureRuleRegistryHash: source.closureRuleRegistryHash,
    closureEngineIdentity: CLOSURE_ENGINE_IDENTITY,
    releaseManifestHash: source.releaseManifestHash,
    maxRounds: positiveInteger(source.maxRounds, 'TypedFactClosureProfileV1.maxRounds'),
    maxFacts: positiveInteger(source.maxFacts, 'TypedFactClosureProfileV1.maxFacts'),
  });
  const profile = deepFreeze({
    ...body,
    closureProfileHash: domainHashV1('formal.typed_fact_closure_profile.v1', body),
  });
  closureProfiles.add(profile);
  return profile;
}

function assertClosureProfile(value) {
  if (!value || typeof value !== 'object' || !closureProfiles.has(value)) {
    throw new TypeError('TypedFactClosureProfile must be factory-produced');
  }
  return value;
}

function canonicalFacts(facts) {
  return Object.freeze([...facts].sort(
    (left, right) => compareCanonical(left.semanticHash, right.semanticHash),
  ));
}

function canonicalDerivations(derivations) {
  return Object.freeze([...derivations].sort(
    (left, right) => compareCanonical(left.derivationHash, right.derivationHash),
  ));
}

function assertFactDependencyGraph(facts) {
  const byId = new Map(facts.map((fact) => [fact.factId, fact]));
  if (byId.size !== facts.length) throw new TypeError('TypedFactClosure contains duplicate factId');
  const state = new Map();
  function visit(fact) {
    if (state.get(fact.factId) === 'done') return;
    if (state.get(fact.factId) === 'visiting') {
      throw new TypeError(`TypedFactClosure dependency cycle at ${fact.factId}`);
    }
    state.set(fact.factId, 'visiting');
    for (const inputRef of fact.inputFactRefs) {
      const input = byId.get(inputRef);
      if (!input) throw new TypeError(`TypedFactClosure dangling inputFactRef: ${inputRef}`);
      if (fact.stratum < input.stratum) {
        throw new TypeError(`TypedFactClosure stratum regression: ${fact.factId}`);
      }
      visit(input);
    }
    state.set(fact.factId, 'done');
  }
  for (const fact of facts) visit(fact);
}

function materialize({ profile, seedSetHash, iteration, facts, derivations,
  deltaSemanticHashes, status, stableErrorCode = null }) {
  const orderedFacts = canonicalFacts(facts);
  const orderedDerivations = canonicalDerivations(derivations);
  const orderedDelta = Object.freeze([...deltaSemanticHashes].sort(compareCanonical));
  const body = deepFreeze({
    version: TYPED_FACT_CLOSURE_VERSION,
    closureProfileHash: profile.closureProfileHash,
    closureRuleRegistryHash: profile.closureRuleRegistryHash,
    closureEngineIdentity: profile.closureEngineIdentity,
    releaseManifestHash: profile.releaseManifestHash,
    seedSetHash,
    maxRounds: profile.maxRounds,
    maxFacts: profile.maxFacts,
    iteration,
    status,
    stableErrorCode,
    factCount: orderedFacts.length,
    derivationCount: orderedDerivations.length,
    deltaCount: orderedDelta.length,
    deltaSemanticHashes: orderedDelta,
    facts: orderedFacts,
    derivations: orderedDerivations,
  });
  const closure = deepFreeze({
    ...body,
    closureHash: domainHashV1('formal.typed_fact_closure.v2', body),
  });
  typedFactClosures.add(closure);
  return closure;
}

export function buildTypedFactClosure(seedFacts = [], profileValue) {
  const profile = assertClosureProfile(profileValue);
  if (!Array.isArray(seedFacts)) throw new TypeError('TypedFactClosure seedFacts must be an array');
  const facts = seedFacts.map((fact, index) => assertTypedFact(fact, `seedFacts[${index}]`));
  assertFactDependencyGraph(facts);
  const semantic = new Map();
  for (const fact of facts) {
    const prior = semantic.get(fact.semanticHash);
    if (prior !== undefined) {
      throw new TypeError(`TypedFactClosure semantic alias requires one factId: ${fact.semanticHash}`);
    }
    semantic.set(fact.semanticHash, fact);
  }
  if (semantic.size > profile.maxFacts) throw new TypeError('TypedFactClosure seed exceeds maxFacts');
  const uniqueFacts = [...semantic.values()];
  const derivations = new Map(facts.map((fact) => [fact.derivationHash, factDerivationOf(fact)]));
  const seedSetHash = domainHashV1('formal.typed_fact_closure_seed_set.v1', {
    semanticHashes: [...semantic.keys()].sort(compareCanonical),
    derivationHashes: [...derivations.keys()].sort(compareCanonical),
  });
  return materialize({
    profile,
    seedSetHash,
    iteration: 0,
    facts: uniqueFacts,
    derivations: derivations.values(),
    deltaSemanticHashes: semantic.keys(),
    status: semantic.size === 0 ? 'fixed_point' : 'running',
  });
}

export function assertTypedFactClosure(value, field = 'TypedFactClosure') {
  if (!value || typeof value !== 'object' || !typedFactClosures.has(value)) {
    throw new TypeError(`${field} must be a factory-produced TypedFactClosure`);
  }
  return value;
}

function profileFromClosure(prior) {
  const profile = deepFreeze({
    version: TYPED_FACT_CLOSURE_PROFILE_VERSION,
    closureRuleRegistryHash: prior.closureRuleRegistryHash,
    closureEngineIdentity: prior.closureEngineIdentity,
    releaseManifestHash: prior.releaseManifestHash,
    maxRounds: prior.maxRounds,
    maxFacts: prior.maxFacts,
    closureProfileHash: prior.closureProfileHash,
  });
  closureProfiles.add(profile);
  return profile;
}

export function advanceTypedFactClosure(priorClosure, candidateFacts = []) {
  const prior = assertTypedFactClosure(priorClosure);
  if (prior.status !== 'running') throw new TypeError(`cannot advance closure in ${prior.status} status`);
  if (!Array.isArray(candidateFacts)) throw new TypeError('TypedFactClosure candidateFacts must be an array');
  const profile = profileFromClosure(prior);
  const candidates = candidateFacts.map(
    (fact, index) => assertTypedFact(fact, `candidateFacts[${index}]`),
  );
  const factsById = new Map(prior.facts.map((fact) => [fact.factId, fact]));
  const factsBySemantic = new Map(prior.facts.map((fact) => [fact.semanticHash, fact]));
  const derivations = new Map(
    prior.derivations.map((derivation) => [derivation.derivationHash, derivation]),
  );
  const priorDelta = new Set(prior.deltaSemanticHashes);
  const nextDelta = new Set();

  for (const fact of candidates) {
    if (fact.inputFactRefs.length === 0) {
      throw new TypeError(`closure advance requires derived input facts: ${fact.factId}`);
    }
    let readsDelta = false;
    let maxInputStratum = 0;
    for (const inputRef of fact.inputFactRefs) {
      const input = factsById.get(inputRef);
      if (!input) throw new TypeError(`closure advance dangling inputFactRef: ${inputRef}`);
      if (input.recursionPolicy !== 'forwardable') {
        throw new TypeError(`closure advance cannot read ${input.recursionPolicy} fact: ${inputRef}`);
      }
      if (priorDelta.has(input.semanticHash)) readsDelta = true;
      maxInputStratum = Math.max(maxInputStratum, input.stratum);
    }
    if (!readsDelta) throw new TypeError(`closure advance must read the prior delta: ${fact.factId}`);
    if (fact.stratum < maxInputStratum) throw new TypeError(`closure advance stratum regression: ${fact.factId}`);
    const sameId = factsById.get(fact.factId);
    if (sameId && sameId.semanticHash !== fact.semanticHash) {
      throw new TypeError(`closure advance factId collision: ${fact.factId}`);
    }
    const sameSemantic = factsBySemantic.get(fact.semanticHash);
    if (sameSemantic && sameSemantic.factId !== fact.factId) {
      throw new TypeError(`closure advance semantic alias requires one factId: ${fact.semanticHash}`);
    }
    if (!sameSemantic) {
      factsById.set(fact.factId, fact);
      factsBySemantic.set(fact.semanticHash, fact);
      nextDelta.add(fact.semanticHash);
    }
    if (!derivations.has(fact.derivationHash)) {
      derivations.set(fact.derivationHash, factDerivationOf(fact));
    }
  }

  const iteration = prior.iteration + 1;
  const overLimit = factsBySemantic.size > prior.maxFacts
    || (nextDelta.size > 0 && iteration >= prior.maxRounds);
  return materialize({
    profile,
    seedSetHash: prior.seedSetHash,
    iteration,
    facts: overLimit ? prior.facts : factsBySemantic.values(),
    derivations: overLimit ? prior.derivations : derivations.values(),
    deltaSemanticHashes: overLimit ? prior.deltaSemanticHashes : nextDelta,
    status: overLimit ? 'limit_reached' : nextDelta.size === 0 ? 'fixed_point' : 'running',
  });
}

export function finalizeTypedFactClosure(priorClosure) {
  const prior = assertTypedFactClosure(priorClosure);
  if (prior.status !== 'running') return prior;
  return materialize({
    profile: profileFromClosure(prior),
    seedSetHash: prior.seedSetHash,
    iteration: prior.iteration,
    facts: prior.facts,
    derivations: prior.derivations,
    deltaSemanticHashes: prior.deltaSemanticHashes,
    status: 'non_converged',
  });
}

export function failTypedFactClosure(priorClosure, stableErrorCodeValue) {
  const prior = assertTypedFactClosure(priorClosure);
  const stableErrorCode = requiredString(stableErrorCodeValue, 'stableErrorCode');
  return materialize({
    profile: profileFromClosure(prior),
    seedSetHash: prior.seedSetHash,
    iteration: prior.iteration,
    facts: prior.facts,
    derivations: prior.derivations,
    deltaSemanticHashes: [],
    status: 'failed',
    stableErrorCode,
  });
}
