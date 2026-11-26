import { describe, expect, it } from 'vitest';
import { serviceToolName } from '../src/ui/feedback/client';

/** The section-name rule of the feedback service (worker-feedback/feedback.js, TOOL). */
const TOOL = /^[\p{L}\p{N} ,.'’()–-]{1,80}$/u;

describe('serviceToolName', () => {
  it('turns the digitizer titles into names the service accepts', () => {
    for (const tool of ['XRD analysis', 'FTIR analysis', 'UV-Vis analysis', 'Thermal analysis']) {
      const name = serviceToolName(`${tool}: data from a graph image`);
      expect(name).toBe(`${tool} – data from a graph image`);
      expect(TOOL.test(name)).toBe(true);
    }
  });

  it('leaves accepted names unchanged', () => {
    expect(serviceToolName('XRD analysis')).toBe('XRD analysis');
    expect(serviceToolName('Particle size (SEM/TEM)')).toBe('Particle size (SEM TEM)');
  });
});
