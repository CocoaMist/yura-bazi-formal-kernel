import { contentHash, deepFreeze, fail } from './shared.mjs';

function profile(body) {
  return deepFreeze({ ...body, profileHash: contentHash(body) });
}

export const COMPARISON_SCOPE_PROFILE = profile({
  profileId: 'bazi.comparison_scope.cross_subject_raw.v1',
  permittedScopes: ['left', 'right'],
  requiredScopes: ['left', 'right'],
  materialStatus: 'traditional_cross_subject_candidate',
  effectEligible: false,
  sourceRefs: [
    'book:sanming-tonghui:vol7:same-chart-distinct-subjects',
    'source-span:ctext:524726:0157199eb1cc80c1976aa2dbb403bcd8c64badef44099c1d377a59a9457d8240'
  ]
});

export const TEMPORAL_SCOPE_PROFILE = profile({
  profileId: 'bazi.temporal_scope.natal_and_explicit_layers_raw.v1',
  permittedScopes: ['natal', 'time'],
  requiredScopes: ['time'],
  materialStatus: 'traditional_temporal_candidate',
  effectEligible: false,
  sourceRefs: [
    'book:sanming-tonghui:year-month-day-time-materials',
    'research:yuracore-time-system-comparison'
  ]
});

export function groupAllowedByScopeProfile(group, scopeProfile) {
  const scopes = new Set(group.participants.map((participant) => participant.scope));
  if ([...scopes].some((scope) => !scopeProfile.permittedScopes.includes(scope))) {
    fail(`group contains a scope outside ${scopeProfile.profileId}`);
  }
  return scopeProfile.requiredScopes.every((scope) => scopes.has(scope));
}
