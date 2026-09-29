import { aiAccuracy, percent, secondsToMinutes, slaCompliance } from './metrics.calc';

describe('cálculos das métricas', () => {
  it('percent arredonda para 1 casa', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(5, 5)).toBe(100);
  });

  it('percent sem base devolve null, não 0', () => {
    expect(percent(0, 0)).toBeNull();
  });

  it('secondsToMinutes', () => {
    expect(secondsToMinutes(90)).toBe(2);
    expect(secondsToMinutes(null)).toBeNull();
  });

  it('SLA: 8 avaliados com 2 estourados = 75%', () => {
    expect(slaCompliance(8, 2)).toBe(75);
    expect(slaCompliance(0, 0)).toBeNull();
  });

  it('acerto da IA: 7 aceitas e 3 corrigidas = 70%', () => {
    expect(aiAccuracy(7, 3)).toBe(70);
    expect(aiAccuracy(0, 0)).toBeNull();
  });
});
