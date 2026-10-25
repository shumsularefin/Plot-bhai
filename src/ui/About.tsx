import './about.css';

/** One equation with a plain-language reading. Static text, so no maths renderer is needed. */
function Eq({ children, note }: { children: string; note: string }) {
  return (
    <li>
      <code class="about-eq">{children}</code>
      <span class="about-note">{note}</span>
    </li>
  );
}

export default function About() {
  return (
    <article class="about">
      <h1 class="page-title">About this toolkit</h1>
      <p class="page-lead">
        Free, in-browser tools for XRD, UV-Vis, FTIR, particle size and thermal analysis. This page
        lists the equations used, the assumptions behind them and what the tools cannot do.
      </p>

      <section aria-labelledby="about-privacy">
        <h2 id="about-privacy">Privacy</h2>
        <p>
          All processing happens in your browser. Your files are never uploaded, and the site has no
          accounts, analytics or tracking. Your work is kept in this browser (IndexedDB) so a
          refresh does not lose it; clearing site data removes it. Use the session file in each tool
          to keep a copy or move it to another device.
        </p>
      </section>

      <section aria-labelledby="about-limits">
        <h2 id="about-limits">Limitations</h2>
        <ul>
          <li>
            There is no Rietveld refinement. Phase comparison is a visual and numerical aid for
            simple phases, not a proof of identity.
          </li>
          <li>
            Automatic phase matching, single-crystal or polycrystalline hints, thermal event
            assignments and calcination temperatures are ranked suggestions with a stated reason.
            Confirm them, for example by XRD of samples calcined at a few temperatures.
          </li>
          <li>
            TGA alone cannot identify evolved species. Calculated mass losses count everything that
            leaves the solid.
          </li>
          <li>
            Crystallite sizes from peak width are estimates. When a peak is close to the instrument
            width the size is only a lower limit.
          </li>
          <li>
            Rule and group tables (thermal events, FTIR bands) and X-ray wavelengths are marked for
            verification. Check them against your own references before publishing.
          </li>
          <li>
            JCPDS/ICDD data is not included. A JCPDS number you type is printed as typed and is
            never verified by the site.
          </li>
        </ul>
      </section>

      <section aria-labelledby="about-xrd">
        <h2 id="about-xrd">XRD equations</h2>
        <p>
          θ is the Bragg angle (half of 2θ), λ the wavelength, β the sample peak width (FWHM,
          radians inside the formulas), D the crystallite size and ε the strain.
        </p>
        <ul class="about-eqs">
          <Eq note="Bragg's law, d is the plane spacing">λ = 2 d sin θ</Eq>
          <Eq note="Scherrer, K is the shape factor you choose">D = K λ / (β cos θ)</Eq>
          <Eq note="Monshi-Scherrer, a line through all peaks">
            ln β = ln(K λ / D) + ln(1 / cos θ)
          </Eq>
          <Eq note="Williamson-Hall, uniform deformation model">β cos θ = K λ / D + 4 ε sin θ</Eq>
          <Eq note="Williamson-Hall with stress; E is Young's modulus along hkl">
            β cos θ = K λ / D + 4 σ sin θ / E
          </Eq>
          <Eq note="Williamson-Hall with energy density u">
            β cos θ = K λ / D + 4 sin θ √(2u / E)
          </Eq>
          <Eq note="Size-strain plot, d the plane spacing">
            (d β cos θ)² = (K λ / D)(d² β cos θ) + 4 ε² λ²
          </Eq>
          <Eq note="Halder-Wagner">(β / tan θ)² = (K λ / D) β / (tan θ sin θ) + 16 ε²</Eq>
          <Eq note="Dislocation density, an estimate">δ = 1 / D²</Eq>
          <Eq note="Specific surface of dense spheres, ρ density">S = 6 / (ρ D)</Eq>
          <Eq note="Instrument correction, Gaussian peaks (B observed, b instrument)">
            β = √(B² − b²)
          </Eq>
          <Eq note="Instrument correction, Lorentzian peaks">β = B − b</Eq>
          <Eq note="Texture coefficient, N reflections, I0 from the reference">
            TC = (I / I0) / ((1/N) Σ I / I0)
          </Eq>
          <Eq note="Crystallinity index from crystalline and amorphous areas">
            index = A_cryst / (A_cryst + A_amorph) × 100
          </Eq>
          <Eq note="Reference intensity, Lorentz-polarisation factor">
            I ∝ |F|² (1 + cos² 2θ) / (sin² θ cos θ)
          </Eq>
          <Eq note="Cubic cell, spacing from the cell edge a">1 / d² = (h² + k² + l²) / a²</Eq>
        </ul>
        <p>
          Reference patterns are calculated from structures in the Crystallography Open Database
          (COD, crystallography.net), an open collection of crystal structures. Each reference shows
          its COD ID. Atomic scattering factors use the Cromer-Mann form from International Tables
          Vol. C. The calculation ignores anomalous dispersion.
        </p>
      </section>

      <section aria-labelledby="about-uvvis">
        <h2 id="about-uvvis">UV-Vis equations</h2>
        <ul class="about-eqs">
          <Eq note="Photon energy from wavelength">E (eV) = h c / λ ≈ 1239.84 / λ (nm)</Eq>
          <Eq note="Absorbance from percent transmittance">A = 2 − log₁₀(%T)</Eq>
          <Eq note="Kubelka-Munk, for diffuse reflectance R">F(R) = (1 − R)² / (2 R)</Eq>
          <Eq note="Absorption coefficient when thickness t is given">α = ln(10) A / t</Eq>
          <Eq note="Tauc relation; n = 1/2 direct allowed, 2 indirect allowed, 3/2 direct forbidden">
            (α h ν)^(1/n) = k (h ν − Eg)
          </Eq>
          <Eq note="Band gap where the fitted line meets the energy axis">Eg = −a / b</Eq>
          <Eq note="Urbach tail">α = α₀ exp(E / Eu)</Eq>
        </ul>
        <p>
          The Tauc band gap depends on the chosen transition type and fit window, so treat it as an
          estimate and state both when you report it.
        </p>
      </section>

      <section aria-labelledby="about-ftir">
        <h2 id="about-ftir">FTIR</h2>
        <ul class="about-eqs">
          <Eq note="Absorbance from percent transmittance">A = 2 − log₁₀(%T)</Eq>
        </ul>
        <p>
          Functional group suggestions come from the tables of S. Pasieczna-Patkowska, M. Cichy and
          J. Flieger, Molecules 30 (2025) 684, doi:10.3390/molecules30030684, licensed CC BY 4.0
          (Tables 2 and 3). A suggestion is a candidate within a chosen distance of a band, not an
          assignment. The table is flagged for verification.
        </p>
      </section>

      <section aria-labelledby="about-particles">
        <h2 id="about-particles">Particle size</h2>
        <ul class="about-eqs">
          <Eq note="Histogram bin width, IQR the inter-quartile range, n the count">
            w = 2 IQR / n^(1/3)
          </Eq>
          <Eq note="Normal fit by maximum likelihood">μ = mean(x), σ² = mean((x − μ)²)</Eq>
          <Eq note="Lognormal fit by maximum likelihood">μ = mean(ln x), σ² = mean((ln x − μ)²)</Eq>
        </ul>
        <p>
          Images are analysed on a downscaled working copy and the results are mapped back to the
          original scale. Automatic detection can merge or split touching particles, so check the
          outlines.
        </p>
      </section>

      <section aria-labelledby="about-thermal">
        <h2 id="about-thermal">Thermal analysis</h2>
        <p>
          DSC plots and tables state the heat flow sign convention (exo up or exo down). Enthalpy
          uses the thermodynamic sign: positive means heat absorbed.
        </p>
        <ul class="about-eqs">
          <Eq note="Onset from the DTG peak; s is the DTG at the peak, T_p the peak temperature">
            T_on = T_p − (m_before − m(T_p)) / s
          </Eq>
          <Eq note="Endset from the DTG peak">T_end = T_p + (m(T_p) − m_after) / s</Eq>
          <Eq note="Mass lost in a step">Δm = m_before − m_after</Eq>
          <Eq note="Enthalpy from the baseline-corrected peak area; β is the scan rate">
            ΔH = −∫ d dT / β
          </Eq>
          <Eq note="Heat capacity change at the glass transition">ΔCp = Δe / β</Eq>
          <Eq note="Theoretical mass loss of A → ν B + gas; M molar mass, ν moles">
            loss (%) = (ν_A M_A − ν_B M_B) / (ν_A M_A) × 100
          </Eq>
        </ul>
        <p>
          Event rule tables (typical temperature ranges) are stored with their sources and are
          flagged for verification. A suggested calcination temperature is a starting point, not an
          optimum.
        </p>
        <h3>Activation energy from several heating rates</h3>
        <p>
          Needs three or more runs of the same sample at different heating rates β (K/min); T is in
          kelvin, R is the molar gas constant, and the result is an apparent activation energy Ea.
        </p>
        <ul class="about-eqs">
          <Eq note="Kissinger; Tp is the peak temperature of the event">
            ln(β / Tp²) = const − Ea / (R Tp)
          </Eq>
          <Eq note="Conversion from the mass at the ends of the chosen window">
            α = (m₀ − m) / (m₀ − m_f)
          </Eq>
          <Eq note="Flynn-Wall-Ozawa at fixed α, with the Doyle approximation">
            ln β = const − 1.052 Ea / (R T)
          </Eq>
          <Eq note="Kissinger-Akahira-Sunose at fixed α">ln(β / T²) = const − Ea / (R T)</Eq>
        </ul>
        <p>
          A single Ea is misleading when the value changes strongly with α, which suggests
          overlapping steps. The Doyle coefficient 1.052 is flagged for verification.
        </p>
      </section>
    </article>
  );
}
