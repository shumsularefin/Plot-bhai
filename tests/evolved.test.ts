import { describe, expect, it } from 'vitest';
import { evolvedTemperatures, signalPeak } from '../src/core/thermal/evolved';

describe('evolved gas signals', () => {
  const tga = {
    timeMin: Float64Array.from([0, 10, 20]),
    temperatureC: Float64Array.from([30, 130, 230]),
  };

  it('converts kelvin and maps time onto the TGA temperature', () => {
    expect(Array.from(evolvedTemperatures(Float64Array.of(373.15), 'K', tga) ?? [])[0]).toBeCloseTo(
      100,
      10,
    );
    expect(Array.from(evolvedTemperatures(Float64Array.of(5, 15), 'min', tga) ?? [])).toEqual([
      80, 180,
    ]);
    expect(Array.from(evolvedTemperatures(Float64Array.of(600), 's', tga) ?? [])).toEqual([130]);
    expect(evolvedTemperatures(Float64Array.of(5), 'min', { ...tga, timeMin: null })).toBeNull();
  });

  it('finds the peak and the step that contains it', () => {
    const T = Float64Array.from({ length: 101 }, (_, i) => 100 + i);
    const s = T.map((t) => Math.exp(-(((t - 150) / 10) ** 2)));
    const steps = [
      { fromC: 90, toC: 120 },
      { fromC: 130, toC: 170 },
    ];
    expect(signalPeak(T, s, steps)).toEqual({ peakC: 150, step: 1 });
    expect(signalPeak(T, s, [])).toEqual({ peakC: 150, step: null });
    expect(
      signalPeak(
        T,
        T.map(() => NaN),
        steps,
      ),
    ).toBeNull();
  });
});
