export type LocalChoices = Record<'act' | 'hold' | 'effect' | 'respond' | 'check', string>
export type PairSimulation = {
  mode?: 'pair'; version: 1; actor_id: string; partner_id: string; topic: string; available: boolean;
  actor_confidence: number; partner_confidence: number; actor_loss: number; partner_loss: number;
  choices: LocalChoices; engines: ('praxish' | 'sabre' | 'fatima')[]; desirability: number; plan_goal: 'respond' | 'check';
}

export type CastParticipant = {
  actor_id: string; goal?: string; act?: string; hold?: string; effect?: string;
  available?: boolean; confidence?: number; loss?: number; visible_to?: string[] | null;
}
export type CastSimulation = { mode: 'solo' | 'ensemble'; topic?: string; participants: CastParticipant[] }
export type LocalSimulation = PairSimulation | CastSimulation

export type RehearsalDraft = {
  local_simulation?: LocalSimulation;
  text: string; outcome: string; next_question: string; technique_ids: string[];
  technique_applications: { technique_id: string; placement: string; reason: string; effect: string }[];
}

export const rehearsalDraft = (value: any = {}): RehearsalDraft => ({
  ...(value?.local_simulation ? { local_simulation: value.local_simulation } : {}),
  text: typeof value?.text === 'string' ? value.text : '',
  outcome: typeof value?.outcome === 'string' ? value.outcome : '',
  next_question: typeof value?.next_question === 'string' ? value.next_question : '',
  technique_ids: Array.isArray(value?.technique_ids) ? [...value.technique_ids] : [],
  technique_applications: Array.isArray(value?.technique_applications) ? value.technique_applications.map((row: any) => ({ ...row })) : [],
})

export const rehearsalKey = (value: any) => JSON.stringify(rehearsalDraft(value))
export const rehearsalSourcesChanged = (held: Record<string, string> = {}, current: Record<string, string> = {}) => Object.keys(current).some((path) => held[path] !== undefined && held[path] !== current[path])

// Confirm only adds the rehearsal; unrelated in-progress event edits stay local.
export const mergeConfirmedRehearsal = (card: any, uiSceneId: string, sceneId: string, saved: any, updatedAt?: string, revision?: string) => {
  if (!card) return card
  const index = /^index_\d+$/.test(sceneId) ? Number(sceneId.slice(6)) : -1
  return { ...card, ...(revision ? { _revision: revision } : {}), ...(updatedAt ? { updated_at: updatedAt } : {}), payload: { ...card.payload,
    important_scenes: (card.payload?.important_scenes || []).map((row: any, rowIndex: number) => row.id === uiSceneId || row.id === sceneId || !row.id && rowIndex === index ? { ...row, rehearsal: saved } : row),
  } }
}
