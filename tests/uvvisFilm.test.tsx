import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitPlasmon } from '../src/core/uvvis/plasmon';
import { plasmonKey, uploadProblem } from '../src/modules/uvvis/film/analysis';
import { initialFilmData, type FilmData } from '../src/modules/uvvis/film/data';
import { FilmResultsStep } from '../src/modules/uvvis/film/ResultsStep';
import { FilmUploadStep } from '../src/modules/uvvis/film/UploadStep';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function example(label: string): FilmData {
  let data: FilmData = initialFilmData;
  const update = (patch: Partial<FilmData>) => {
    data = { ...data, ...patch };
    view.rerender(<FilmUploadStep data={data} update={update} />);
  };
  const view = render(<FilmUploadStep data={data} update={update} />);
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
  view.unmount();
  return data;
}

describe('plasmon and thin film wizard', () => {
  it('needs a spectrum first', () => {
    expect(uploadProblem(initialFilmData)).toContain('Load a spectrum');
  });

  it('shows the thickness and index of the synthetic film', () => {
    const data = example('Thin film thickness and refractive index (Swanepoel)');
    expect(uploadProblem(data)).toBeNull();
    render(<FilmResultsStep data={data} update={() => {}} />);
    // The example film is 1000 nm thick (see film/example.ts).
    const note = screen.getByRole('note').textContent ?? '';
    const d = Number(/d = (\d+)/.exec(note)?.[1]);
    expect(Math.abs(d - 1000)).toBeLessThan(10);
    const methods = (screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement).value;
    expect(methods).toContain('envelope method of Swanepoel');
    expect(methods).toContain('s = 1.51');
  });

  it('asks for the substrate index', () => {
    const data = example('Thin film thickness and refractive index (Swanepoel)');
    render(
      <FilmResultsStep
        data={{ ...data, swanepoel: { ...data.swanepoel, substrateIndex: null } }}
        update={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('substrate refractive index');
  });

  it('shows a saved plasmon fit with its methods text', () => {
    const data = example('Plasmon band fit (absorbance)');
    const s = data.spectrum;
    if (!s) throw new Error('no example');
    const found = fitPlasmon(s.wavelengthNm, s.values, {
      fromNm: data.plasmon.fromNm as number,
      toNm: data.plasmon.toNm as number,
      centresNm: data.plasmon.centresNm,
      profile: data.plasmon.profile,
    });
    if (!found) throw new Error('no fit');
    const withFit = {
      ...data,
      plasmon: { ...data.plasmon, result: { key: plasmonKey(data), fit: found.fit } },
    };
    render(<FilmResultsStep data={withFit} update={() => {}} />);
    expect(screen.getByRole('note').textContent).toContain('(2.380 ± 0.000 eV), FWHM 0.300 eV');
    const methods = (screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement).value;
    expect(methods).toContain('1 Lorentzian band plus a straight background');
    expect(methods).toContain('synthetic example data');
  });
});
