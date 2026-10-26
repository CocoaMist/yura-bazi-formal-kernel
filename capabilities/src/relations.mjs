import { BRANCHES, RAW_RELATION_PROFILE, STEMS } from './profile.mjs';
import { assertNonEmptyString, captureRecord, contentHash, deepFreeze, fail } from './shared.mjs';

const STEM_ELEMENTS = Object.freeze(['wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water']);
const BRANCH_ELEMENTS = Object.freeze(['water', 'earth', 'wood', 'wood', 'earth', 'fire', 'fire', 'earth', 'metal', 'metal', 'earth', 'water']);
const GENERATES = Object.freeze({ wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' });
const CONTROLS = Object.freeze({ wood: 'earth', earth: 'water', water: 'fire', fire: 'metal', metal: 'wood' });

function pair(left, right) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

const STEM_COMBINES = new Map([
  ['jia', 'ji', 'earth'], ['yi', 'geng', 'metal'], ['bing', 'xin', 'water'],
  ['ding', 'ren', 'wood'], ['wu', 'gui', 'fire']
].map(([left, right, element]) => [pair(left, right), element]));

function pairSet(values) {
  return new Set(values.map(([left, right]) => pair(left, right)));
}

const BRANCH_RELATIONS = Object.freeze({
  six_harmony: pairSet([['zi', 'chou'], ['yin', 'hai'], ['mao', 'xu'], ['chen', 'you'], ['si', 'shen'], ['wu', 'wei']]),
  clash: pairSet([['zi', 'wu'], ['chou', 'wei'], ['yin', 'shen'], ['mao', 'you'], ['chen', 'xu'], ['si', 'hai']]),
  harm: pairSet([['zi', 'wei'], ['chou', 'wu'], ['yin', 'si'], ['mao', 'chen'], ['shen', 'hai'], ['you', 'xu']]),
  break: pairSet([['zi', 'you'], ['chou', 'chen'], ['yin', 'hai'], ['mao', 'wu'], ['si', 'shen'], ['wei', 'xu']]),
  punishment: pairSet([['zi', 'mao'], ['yin', 'si'], ['si', 'shen'], ['yin', 'shen'], ['chou', 'xu'], ['xu', 'wei'], ['chou', 'wei']])
});

const SELF_PUNISHMENT = new Set(['chen', 'wu', 'you', 'hai']);
const BRANCH_GROUPS = Object.freeze([
  ['three_harmony', ['shen', 'zi', 'chen']],
  ['three_harmony', ['hai', 'mao', 'wei']],
  ['three_harmony', ['yin', 'wu', 'xu']],
  ['three_harmony', ['si', 'you', 'chou']],
  ['three_meeting', ['hai', 'zi', 'chou']],
  ['three_meeting', ['yin', 'mao', 'chen']],
  ['three_meeting', ['si', 'wu', 'wei']],
  ['three_meeting', ['shen', 'you', 'xu']],
  ['three_member_punishment', ['yin', 'si', 'shen']],
  ['three_member_punishment', ['chou', 'xu', 'wei']]
]);

function elementCodes(left, right) {
  if (left === right) return ['same_element'];
  const codes = [];
  if (GENERATES[left] === right) codes.push('left_generates_right');
  if (GENERATES[right] === left) codes.push('right_generates_left');
  if (CONTROLS[left] === right) codes.push('left_controls_right');
  if (CONTROLS[right] === left) codes.push('right_controls_left');
  return codes;
}

function captureOccurrence(value, kind, label) {
  const input = captureRecord(
    value,
    label,
    ['occurrenceId', 'scope', 'location', `${kind}Id`],
    ['subjectRef']
  );
  const id = input[`${kind}Id`];
  const vocabulary = kind === 'stem' ? STEMS : BRANCHES;
  if (!vocabulary.includes(id)) fail(`${label}.${kind}Id is unknown`);
  return {
    occurrenceId: assertNonEmptyString(input.occurrenceId, `${label}.occurrenceId`),
    scope: assertNonEmptyString(input.scope, `${label}.scope`),
    location: assertNonEmptyString(input.location, `${label}.location`),
    subjectRef: input.subjectRef ?? null,
    [`${kind}Id`]: id
  };
}

function combinations(choiceSets, index = 0, current = [], output = []) {
  if (index === choiceSets.length) {
    output.push([...current]);
    return output;
  }
  for (const choice of choiceSets[index]) {
    current.push(choice);
    combinations(choiceSets, index + 1, current, output);
    current.pop();
  }
  return output;
}

export function detectCompleteBranchGroups(values) {
  if (!Array.isArray(values)) fail('branch occurrences must be an array');
  const occurrences = values.map((value, index) => captureOccurrence(value, 'branch', `occurrences[${index}]`));
  const groups = [];
  for (const [code, members] of BRANCH_GROUPS) {
    const choices = members.map((member) => occurrences.filter((item) => item.branchId === member));
    if (choices.some((items) => items.length === 0)) continue;
    for (const participants of combinations(choices)) {
      groups.push(deepFreeze({
        kind: 'branch_group',
        groupId: contentHash({ code, participants }),
        code,
        members,
        participants,
        complete: true,
        transformationEstablished: false,
        profileId: RAW_RELATION_PROFILE.profileId,
        effectEligible: false
      }));
    }
  }
  return deepFreeze(groups);
}

export function relateStemOccurrences(leftValue, rightValue) {
  const left = captureOccurrence(leftValue, 'stem', 'left');
  const right = captureOccurrence(rightValue, 'stem', 'right');
  const leftIndex = STEMS.indexOf(left.stemId);
  const rightIndex = STEMS.indexOf(right.stemId);
  const codes = elementCodes(STEM_ELEMENTS[leftIndex], STEM_ELEMENTS[rightIndex]);
  const transformedElementCandidate = STEM_COMBINES.get(pair(left.stemId, right.stemId));
  if (transformedElementCandidate) codes.push('stem_five_combination');
  const result = {
    kind: 'stem_pair',
    relationId: contentHash({ kind: 'stem_pair', left, right, codes }),
    left,
    right,
    codes,
    transformedElementCandidate: transformedElementCandidate ?? null,
    transformationEstablished: false,
    profileId: RAW_RELATION_PROFILE.profileId,
    effectEligible: false
  };
  return deepFreeze(result);
}

export function relateBranchOccurrences(leftValue, rightValue) {
  const left = captureOccurrence(leftValue, 'branch', 'left');
  const right = captureOccurrence(rightValue, 'branch', 'right');
  const leftIndex = BRANCHES.indexOf(left.branchId);
  const rightIndex = BRANCHES.indexOf(right.branchId);
  const codes = elementCodes(BRANCH_ELEMENTS[leftIndex], BRANCH_ELEMENTS[rightIndex]);
  if (left.branchId === right.branchId) {
    codes.push('same_branch');
    if (SELF_PUNISHMENT.has(left.branchId)) codes.push('self_punishment');
  } else {
    const key = pair(left.branchId, right.branchId);
    for (const [code, members] of Object.entries(BRANCH_RELATIONS)) {
      if (members.has(key)) codes.push(code);
    }
  }
  const result = {
    kind: 'branch_pair',
    relationId: contentHash({ kind: 'branch_pair', left, right, codes }),
    left,
    right,
    codes,
    profileId: RAW_RELATION_PROFILE.profileId,
    effectEligible: false
  };
  return deepFreeze(result);
}

export function relatePillars(left, right) {
  const leftStem = { ...left.occurrence, stemId: left.pillar.stemId };
  const rightStem = { ...right.occurrence, stemId: right.pillar.stemId };
  const leftBranch = { ...left.occurrence, branchId: left.pillar.branchId };
  const rightBranch = { ...right.occurrence, branchId: right.pillar.branchId };
  return deepFreeze({
    leftPillar: left.pillar,
    rightPillar: right.pillar,
    stem: relateStemOccurrences(leftStem, rightStem),
    branch: relateBranchOccurrences(leftBranch, rightBranch),
    effectEligible: false
  });
}
