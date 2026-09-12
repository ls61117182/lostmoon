import type { TurnEndExtraDicePhase } from './TurnEndEventApply';

type Translate = (key: string, params?: Record<string, string | number>) => string;
export interface TurnEndRowPresentation {
  label: string;
  condition: string;
  result: string;
  tone: 'info' | 'safe' | 'danger';
}

/** Presentation only: consumes already rolled values, never rolls or applies effects. */
export function turnEndRowPresentation(
  phase: TurnEndExtraDicePhase | null,
  bodyKey: string,
  params: Record<string, string | number>,
  effectKey: string,
  t: Translate,
): TurnEndRowPresentation {
  if (!phase) return {
    label: t('turnEnd.panel.event'), condition: '',
    result: t(bodyKey.endsWith('.protected') ? 'turnEnd.panel.immune' : effectKey),
    tone: bodyKey.endsWith('.protected') ? 'safe' : 'info',
  };
  const key = phase.captionKey.split('.').pop()!;
  const sum = phase.dice.reduce((a, b) => a + b, 0);
  const thresholds: Record<string, number> = { stukaAa: 6, stukaBomb: 8, stukaPen: 3, minePen: 4, mortarPen: 8 };
  if (key in thresholds) {
    const passed = sum >= thresholds[key];
    const aa = key === 'stukaAa';
    const hit = key === 'stukaBomb';
    return {
      label: t(aa ? 'turnEnd.panel.aa' : hit ? 'turnEnd.panel.hit' : 'turnEnd.panel.pen'),
      condition: t(aa ? 'turnEnd.panel.aaNeed' : hit ? 'dice.panel.hitNeed' : 'dice.panel.penetrateNeed', { n: thresholds[key] }),
      result: t(aa ? passed ? 'turnEnd.panel.shotDown' : 'turnEnd.panel.notShotDown'
        : hit ? passed ? 'dice.panel.hitYes' : 'dice.panel.hitNo'
        : passed ? 'dice.panel.penYes' : 'turnEnd.panel.notPenetrated'),
      tone: (aa ? passed : !passed) ? 'safe' : 'danger',
    };
  }
  if (key === 'mineDmg' || key === 'stukaDamage' || key === 'stukaCrew') {
    const crew = key === 'stukaCrew';
    const resultKey = String(params.resultKey ?? 'turnEnd.result.noEffect');
    const needsCrew = resultKey.startsWith('crew.');
    return {
      label: t(crew ? 'turnEnd.panel.crew' : 'turnEnd.panel.damage'),
      condition: t(crew ? 'turnEnd.panel.crewTable' : 'turnEnd.panel.damageTable'),
      result: !crew && needsCrew ? t('dmg.outcome.crewCheck')
        : t(resultKey, { role: typeof params.roleKey === 'string' ? t(params.roleKey) : '' }),
      tone: resultKey.includes('falseAlarm') && crew ? 'safe' : 'danger',
    };
  }
  return { label: t('turnEnd.panel.reinforce'), condition: '',
    result: t('turnEnd.panel.tile', { n: sum }), tone: 'info' };
}

export function turnEndSummaryKey(bodyKey: string): string {
  if (['turnEnd.stuka.hit', 'turnEnd.mine.hit', 'turnEnd.clearMine.hit', 'turnEnd.heavyMortar.hit'].includes(bodyKey)) return 'turnEnd.panel.finalResult';
  if (bodyKey === 'turnEnd.stuka.shotDown') return 'turnEnd.panel.shotDownSummary';
  if (bodyKey === 'turnEnd.stuka.bombMiss') return 'turnEnd.panel.missSummary';
  if (['turnEnd.stuka.ric', 'turnEnd.mine.ric', 'turnEnd.heavyMortar.ric'].includes(bodyKey)) return 'turnEnd.panel.ricSummary';
  return bodyKey;
}
