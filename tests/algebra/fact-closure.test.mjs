import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPED_FACT_CLOSURE_VERSION,
  advanceTypedFactClosure,
  assertTypedFactClosure,
  buildTypedFactClosure as buildClosure,
  buildTypedFactClosureProfileV1,
  domainHashV1,
  failTypedFactClosure,
  finalizeTypedFactClosure,
} from '../../src/index.mjs';
import {
  assertTypedFact,
  buildTypedFact,
  factDerivationOf,
} from '../../src/algebra/typed-fact.mjs';

const HASH = `sha256:${'a'.repeat(64)}`;
const PROFILE = buildTypedFactClosureProfileV1({
  version: 'formal.typed_fact_closure_profile.v1',
  closureRuleRegistryHash: HASH,
  releaseManifestHash: HASH,
  maxRounds: 10,
  maxFacts: 100,
});
const buildTypedFactClosure = (facts) => buildClosure(facts, PROFILE);

function fact(overrides = {}) {
  return buildTypedFact({
    factId: 'fact:root',
    factType: 'test_fact',
    predicate: 'test.root',
    valueSchemaId: 'test.value.v1',
    subjectRefs: ['subject:test'],
    value: { value: 'root' },
    stratum: 0,
    recursionPolicy: 'forwardable',
    derivationId: 'derivation:test.root.v1',
    configVersion: 'test.config.v1',
    inputFactRefs: [],
    natalContentHash: HASH,
    snapshotRef: HASH,
    provenance: { authority: 'test' },
    ...overrides,
  });
}

test('typed facts separate semantic identity, derivation identity and full content identity', () => {
  const sourceValue = { nested: { answer: 42 } };
  const sourceProvenance = { authority: 'test', refs: ['source:a'] };
  const first = fact({ value: sourceValue, provenance: sourceProvenance });
  const alternate = fact({
    value: sourceValue,
    provenance: { authority: 'test', refs: ['source:b'] },
    derivationId: 'derivation:test.alternate.v1',
  });
  sourceValue.nested.answer = 0;
  sourceProvenance.refs.push('mutated');

  assert.equal(assertTypedFact(first), first);
  assert.equal(first.value.nested.answer, 42);
  assert.deepEqual(first.provenance.refs, ['source:a']);
  assert.equal(first.semanticHash, alternate.semanticHash);
  assert.notEqual(first.derivationHash, alternate.derivationHash);
  assert.notEqual(first.contentHash, alternate.contentHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.value.nested), true);

  const derivation = factDerivationOf(first);
  assert.equal(derivation.semanticHash, first.semanticHash);
  assert.equal(derivation.derivationHash, first.derivationHash);
  assert.equal(Object.isFrozen(derivation), true);

  assert.throws(() => assertTypedFact({ ...first }), /factory-produced TypedFact/);
  assert.throws(() => factDerivationOf({}), /factory-produced TypedFact/);
  assert.throws(() => fact({ subjectRefs: [] }), /must not be empty/);
  assert.throws(() => fact({ recursionPolicy: 'unbounded' }), /must be one of/);
  assert.throws(() => fact({ stratum: -1 }), /finite number/);
  assert.throws(() => fact({ stratum: 0.5 }), /must be an integer/);
  assert.throws(() => fact({ extra: true }), /unknown fields: extra/);
});

test('a typed fact closure advances by delta, deduplicates semantics and retains new proofs', () => {
  const root = fact();
  const seed = buildTypedFactClosure([root]);
  assert.equal(assertTypedFactClosure(seed), seed);
  assert.equal(seed.version, TYPED_FACT_CLOSURE_VERSION);
  assert.equal(seed.iteration, 0);
  assert.equal(seed.factCount, 1);
  assert.equal(seed.derivationCount, 1);
  assert.equal(seed.deltaCount, 1);
  assert.equal(seed.status, 'running');
  const { closureHash, ...seedBody } = seed;
  assert.equal(closureHash, domainHashV1('formal.typed_fact_closure.v2', seedBody));

  const derived = fact({
    factId: 'fact:derived',
    factType: 'test_relation',
    predicate: 'test.derived',
    valueSchemaId: 'test.relation.v1',
    value: { relation: 'derived' },
    stratum: 1,
    derivationId: 'derivation:test.derived.v1',
    inputFactRefs: [root.factId],
  });
  const next = advanceTypedFactClosure(seed, [derived]);
  assert.equal(next.iteration, 1);
  assert.equal(next.factCount, 2);
  assert.equal(next.derivationCount, 2);
  assert.deepEqual(next.deltaSemanticHashes, [derived.semanticHash]);

  const alternateProof = fact({
    factId: derived.factId,
    factType: derived.factType,
    predicate: derived.predicate,
    valueSchemaId: derived.valueSchemaId,
    value: derived.value,
    stratum: derived.stratum,
    derivationId: 'derivation:test.derived.alternate.v1',
    inputFactRefs: [derived.factId],
  });
  const proofOnly = advanceTypedFactClosure(next, [alternateProof]);
  assert.equal(proofOnly.factCount, 2);
  assert.equal(proofOnly.derivationCount, 3);
  assert.equal(proofOnly.deltaCount, 0);
  assert.equal(proofOnly.status, 'fixed_point');

  const repeatedProof = advanceTypedFactClosure(next, [alternateProof]);
  assert.equal(repeatedProof.factCount, 2);
  assert.equal(repeatedProof.derivationCount, 3);
  assert.equal(repeatedProof.status, 'fixed_point');
});

test('closure construction rejects aliases, dangling inputs, cycles and stratum regression', () => {
  const root = fact();
  const alias = fact({ factId: 'fact:alias' });
  assert.throws(
    () => buildTypedFactClosure([root, alias]),
    /semantic alias requires one factId/,
  );
  assert.throws(() => buildTypedFactClosure('facts'), /seedFacts must be an array/);
  assert.throws(() => buildTypedFactClosure([{}]), /factory-produced TypedFact/);
  assert.throws(
    () => buildTypedFactClosure([root, fact({
      factId: root.factId,
      value: { value: 'different' },
    })]),
    /duplicate factId/,
  );
  assert.throws(
    () => buildTypedFactClosure([fact({ inputFactRefs: ['fact:missing'] })]),
    /dangling inputFactRef/,
  );

  const left = fact({ factId: 'fact:left', inputFactRefs: ['fact:right'] });
  const right = fact({ factId: 'fact:right', inputFactRefs: ['fact:left'] });
  assert.throws(() => buildTypedFactClosure([left, right]), /dependency cycle/);

  const high = fact({ factId: 'fact:high', stratum: 2 });
  const low = fact({ factId: 'fact:low', stratum: 1, inputFactRefs: [high.factId] });
  assert.throws(() => buildTypedFactClosure([high, low]), /stratum regression/);
  assert.throws(() => assertTypedFactClosure({}), /factory-produced TypedFactClosure/);

  const sharedRoot = fact({ factId: 'fact:shared-root' });
  const leftLeaf = fact({
    factId: 'fact:left-leaf', predicate: 'test.left', value: { value: 'left' },
    inputFactRefs: [sharedRoot.factId], stratum: 1,
  });
  const rightLeaf = fact({
    factId: 'fact:right-leaf', predicate: 'test.right', value: { value: 'right' },
    inputFactRefs: [sharedRoot.factId], stratum: 1,
  });
  assert.equal(buildTypedFactClosure([sharedRoot, leftLeaf, rightLeaf]).factCount, 3);
});

test('closure advance fails closed on invalid recursion and identity paths', () => {
  const root = fact();
  const seed = buildTypedFactClosure([root]);
  const derived = fact({
    factId: 'fact:derived',
    predicate: 'test.derived',
    value: { value: 'derived' },
    stratum: 1,
    inputFactRefs: [root.factId],
  });
  const next = advanceTypedFactClosure(seed, [derived]);

  assert.throws(() => advanceTypedFactClosure({}, []), /factory-produced TypedFactClosure/);
  assert.throws(() => advanceTypedFactClosure(seed, 'facts'), /candidateFacts must be an array/);
  assert.throws(() => advanceTypedFactClosure(seed, [{}]), /factory-produced TypedFact/);
  assert.throws(
    () => advanceTypedFactClosure(seed, [fact({ factId: 'fact:no-input' })]),
    /requires derived input facts/,
  );
  assert.throws(
    () => advanceTypedFactClosure(seed, [fact({
      factId: 'fact:dangling', inputFactRefs: ['fact:missing'],
    })]),
    /dangling inputFactRef/,
  );

  const terminal = fact({ recursionPolicy: 'terminal' });
  const terminalSeed = buildTypedFactClosure([terminal]);
  assert.throws(
    () => advanceTypedFactClosure(terminalSeed, [fact({
      factId: 'fact:reads-terminal', inputFactRefs: [terminal.factId],
    })]),
    /cannot read terminal fact/,
  );
  assert.throws(
    () => advanceTypedFactClosure(next, [fact({
      factId: 'fact:stale', inputFactRefs: [root.factId], stratum: 1,
    })]),
    /must read the prior delta/,
  );
  assert.throws(
    () => advanceTypedFactClosure(next, [fact({
      factId: 'fact:regression',
      predicate: 'test.regression',
      value: { value: 'regression' },
      inputFactRefs: [derived.factId],
      stratum: 0,
    })]),
    /stratum regression/,
  );
  assert.throws(
    () => advanceTypedFactClosure(seed, [fact({
      factId: root.factId,
      predicate: 'test.collision',
      value: { value: 'collision' },
      inputFactRefs: [root.factId],
    })]),
    /factId collision/,
  );

  const alias = fact({
    factId: 'fact:alias',
    predicate: derived.predicate,
    value: derived.value,
    stratum: derived.stratum,
    inputFactRefs: [derived.factId],
  });
  assert.throws(
    () => advanceTypedFactClosure(next, [alias]),
    /semantic alias requires one factId/,
  );
});

test('closure profiles bound termination and expose every terminal status', () => {
  const empty = buildTypedFactClosure([]);
  assert.equal(empty.status, 'fixed_point');
  assert.throws(() => advanceTypedFactClosure(empty, []), /cannot advance closure in fixed_point/);

  const root = fact();
  const oneRound = buildTypedFactClosureProfileV1({
    version: 'formal.typed_fact_closure_profile.v1',
    closureRuleRegistryHash: HASH,
    releaseManifestHash: HASH,
    maxRounds: 1,
    maxFacts: 2,
  });
  const limitedSeed = buildClosure([root], oneRound);
  const derived = fact({
    factId: 'fact:limited', predicate: 'test.limited', value: { value: 'limited' },
    stratum: 1, inputFactRefs: [root.factId],
  });
  assert.equal(advanceTypedFactClosure(limitedSeed, [derived]).status, 'limit_reached');
  const factLimitedProfile = buildTypedFactClosureProfileV1({
    version: 'formal.typed_fact_closure_profile.v1',
    closureRuleRegistryHash: HASH,
    releaseManifestHash: HASH,
    maxRounds: 10,
    maxFacts: 1,
  });
  assert.equal(
    advanceTypedFactClosure(buildClosure([root], factLimitedProfile), [derived]).status,
    'limit_reached',
  );
  assert.equal(finalizeTypedFactClosure(limitedSeed).status, 'non_converged');
  const failed = failTypedFactClosure(limitedSeed, 'test.failed');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stableErrorCode, 'test.failed');
  assert.equal(finalizeTypedFactClosure(failed), failed);
});

test('closure profile admission rejects version, hash, bounds and forged instances', () => {
  const valid = {
    version: 'formal.typed_fact_closure_profile.v1',
    closureRuleRegistryHash: HASH,
    releaseManifestHash: HASH,
    maxRounds: 2,
    maxFacts: 2,
  };
  assert.throws(() => buildTypedFactClosureProfileV1({ ...valid, version: 'bad' }), /version/);
  assert.throws(() => buildTypedFactClosureProfileV1({ ...valid, closureRuleRegistryHash: 'bad' }), /sha256/);
  const missingRegistry = { ...valid };
  delete missingRegistry.closureRuleRegistryHash;
  assert.throws(() => buildTypedFactClosureProfileV1(missingRegistry), /sha256/);
  assert.throws(() => buildTypedFactClosureProfileV1({ ...valid, releaseManifestHash: 'bad' }), /sha256/);
  assert.throws(() => buildTypedFactClosureProfileV1({ ...valid, maxRounds: 0 }), /positive/);
  assert.throws(() => buildTypedFactClosureProfileV1({ ...valid, maxFacts: 1.5 }), /positive/);
  assert.throws(() => buildClosure([], {}), /factory-produced/);
  assert.throws(() => buildClosure([], null), /factory-produced/);
  assert.throws(() => buildClosure([], 'profile'), /factory-produced/);
  assert.throws(() => assertTypedFactClosure(null), /factory-produced/);
  assert.throws(() => assertTypedFactClosure('closure'), /factory-produced/);
  assert.equal(buildClosure(undefined, PROFILE).status, 'fixed_point');
  const maxOne = buildTypedFactClosureProfileV1({ ...valid, maxFacts: 1 });
  assert.throws(() => buildClosure([
    fact({ factId: 'fact:max-a', predicate: 'test.max.a', value: 'a' }),
    fact({ factId: 'fact:max-b', predicate: 'test.max.b', value: 'b' }),
  ], maxOne), /seed exceeds maxFacts/);
  assert.throws(() => failTypedFactClosure(buildTypedFactClosure([fact()]), ''), /non-empty string/);
});
