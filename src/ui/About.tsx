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
      <h1 class="page-title">About Plot Bhai</h1>
      <p class="page-lead">
        Free, in-browser tools for XRD, UV-Vis, FTIR, particle size and thermal analysis. This page
        lists the equations used, the assumptions behind them and what the tools cannot do.
      </p>

      <section aria-labelledby="about-privacy">
        <h2 id="about-privacy">Privacy</h2>
        <p>
          All processing happens in your browser. Your files are never uploaded, and the site has no
          accounts, analytics or tracking. Two kinds of request leave your browser. The optional
          online COD search sends the elements, formula or COD number you choose. The testing
          counters and the Validate button send a random ID for this browser, the name of the
          analysis section, and your verdict and comment when you validate; your data and results
          are never sent. The service keeps your IP address and browser ID only as salted hashes, to
          enforce daily limits, and comments are published on the home page only after the site
          owner approves them. Your work is kept in this browser (IndexedDB) so a refresh does not
          lose it; clearing site data removes it. Use the session file in each tool to keep a copy
          or move it to another device.
        </p>
      </section>

      <section aria-labelledby="about-limits">
        <h2 id="about-limits">Limitations</h2>
        <ul>
          <li>
            The Rietveld refinement is basic: it refines scale factors, background, zero shift,
            cells, peak widths and shape, preferred orientation and an overall B, but not atom
            positions, occupancies or individual displacement parameters, so it is not a structure
            refinement. Phase comparison is a visual and numerical aid for simple phases, not a
            proof of identity.
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
            Thermal event tables: whether each DSC event is endothermic or exothermic is checked
            against Gaisford, Kett and Haines, Principles of Thermal Analysis and Calorimetry (2nd
            edn, 2016); the typical temperature ranges are still marked for verification. Check them
            against your own references before publishing.
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
          <Eq note="Linear straight-line Scherrer (free line) and Sahadat-Scherrer (line through the origin); D from the slope">
            cos θ = (K λ / D)(1 / β)
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
        <h3>Finding and adding reference phases</h3>
        <p>
          One search box with a periodic table under it searches the whole of COD online: by formula
          (BiVO4), by exactly these elements (Bi-V-O), by elements with any others (Bi V) or by COD
          ID; clicking elements writes them into the box. COD does not accept requests from other
          websites, so a small lookup service run for this site on Cloudflare passes the search on
          and returns the chosen CIF. Only the formula, element symbols and COD numbers are sent;
          your data files never leave your browser. Searches with more than 300 results must be
          narrowed. Polymers that COD does not hold (cellulose II and III, A-type starch, alginate,
          PLA, PHB, PCL, PET, PEO, PVA, PVDF and nylon 6) are in a built-in library, each structure
          transcribed from its original paper, which is cited and linked with the phase.
        </p>
        <p>
          Any other structure can be added as a CIF file, for example one downloaded from COD or the
          Materials Project (which cannot be searched from here); its pattern is calculated in your
          browser in the same way, with notes on partial occupancy, missing displacement parameters
          and hydrogen.
        </p>
        <p>
          The calculated overlay draws each candidate as a pseudo-Voigt profile (with Kα2 when the
          scan has it) at the width you choose and fits only one non-negative scale per phase. The
          difference curve under it shows what the candidates do not explain. It refines nothing
          else; the optional Rietveld step that follows does.
        </p>
        <h3>Basic Rietveld refinement</h3>
        <p>
          The calculated pattern is y = b + Σ S Σ M|F|² · LP · P · exp(−B/2d²) · Ω, summed over the
          phases, their reflections and the Kα1 and Kα2 lines. Here b is a Chebyshev background, S a
          scale factor, M|F|² comes from the reference structure, and LP = (1 + cos²2θ)/(sin²θ
          cosθ). P is the March–Dollase factor (r² cos²α + sin²α/r)<sup>−3/2</sup>, averaged over
          each family. Ω is a pseudo-Voigt peak with FWHM² = U tan²θ + V tanθ + W. Peak positions
          include a zero shift and, if chosen, a sample displacement D·cosθ.
        </p>
        <p>
          The fit minimises Σ w(y<sub>obs</sub> − y<sub>calc</sub>)² with w = 1/y<sub>obs</sub>.
          Parameters are released in stages: scales and background, zero shift, cells, width and
          shape, then orientation and B. R<sub>wp</sub>, R<sub>p</sub>, R<sub>exp</sub>, χ² and R
          <sub>Bragg</sub> follow Young (The Rietveld Method, 1993). Weight fractions use Hill and
          Howard (J. Appl. Cryst. 20 (1987) 467): W = S·ZMV / Σ S·ZMV, among the phases refined,
          with no microabsorption correction. Uncertainties come from the least-squares covariance
          and usually underestimate the real ones.
        </p>
        <p>
          It was checked against GSAS-II. On an anatase and rutile pattern simulated by GSAS-II, it
          recovered the cells within 1 × 10<sup>−4</sup> Å, the zero shift within 0.001° and the
          weight fractions within 0.2 %, as close as GSAS-II's own refinement of the same data.
        </p>
        <h3>Background</h3>
        <p>
          The default background is arPLS (asymmetrically reweighted penalised least squares; S.-J.
          Baek et al., Analyst 140 (2015) 250; checked against the pybaselines implementation), a
          smooth curve that follows the points inside the noise band and ignores points well above
          it. Its stiffness is set as a width in degrees 2θ and converted to the smoothing parameter
          λ = (w / (2π Δ))⁴ for step Δ, so the same width behaves the same on fine and coarse scans;
          that conversion is an approximation. It was chosen because it gave the smallest error on
          synthetic patterns with a known background (12 peaks, counting noise, gentle and strongly
          curved backgrounds): about 7 counts for arPLS (width 4°) against 40 to 80 for SNIP (width
          2°) and 24 to 105 for a degree-4 polynomial. These numbers hold for those shapes, not for
          every pattern. SNIP and polynomial remain available. The site warns when the corrected
          data go clearly below zero, which means the background cuts into peaks.
        </p>
        <h3>Peak finding and fit quality</h3>
        <ul class="about-eqs">
          <Eq note="Noise estimate from second differences, robust to peaks (MAD, median absolute deviation)">
            σ = 1.4826 MAD(Δ²y) / √6
          </Eq>
          <Eq note="Reduced chi-squared of a fit region; N points, p parameters">
            χ²ν = Σ (y − ŷ)² / ((N − p) σ²)
          </Eq>
        </ul>
        <p>
          Peaks must stand at least three times above the local noise and span a few steps, which
          stops noise from being reported as peaks. Uncertainties (±) come from the fit's covariance
          matrix scaled by the residual variance. They are shown as n/a when a parameter sits on its
          limit or the matrix cannot be inverted, and χ²ν well above 1 means the model misses
          structure in the data (an unfitted shoulder, a wrong profile or a background problem), so
          the uncertainties are then too small. Crystallite size is the size of coherently
          diffracting domains, not the particle size seen in a microscope.
        </p>
      </section>

      <section aria-labelledby="about-images">
        <h2 id="about-images">Data from a graph image</h2>
        <p>
          The XRD, FTIR, UV-Vis and TGA/DSC tools can also read a curve from a picture of a graph.
          You mark two labelled ticks on each axis; the pixels of the curve are then mapped to data
          values with an affine transform, so a slightly tilted image is still read correctly, and
          resampled one image pixel apart. The result is only as good as the picture: positions are
          good to about a pixel, while heights and the widths of narrow peaks are rough. Such data
          stay marked as digitized in every table, export and methods text.
        </p>
      </section>

      <section aria-labelledby="about-figures">
        <h2 id="about-figures">Figures and records</h2>
        <p>
          The figure editor changes only how a plot looks: line colours, widths and dashes, fills,
          text, arrows, markers, reference lines, shaded regions, peak labels, legend, axis titles
          and limits, ticks and grid. It never changes the data or results. SVG is the vector
          format; the PDF holds the figure as a 600 dpi image, so its text is not editable.
        </p>
        <p>
          Each tool can download an analysis record: the file details read from the header, a
          SHA-256 fingerprint of the data (to confirm later that the same file was used), every
          processing step with its settings and warnings, the results with uncertainties, the
          methods text and the version of this site that produced it.
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
          <Eq note="Absorbance from transmittance T = %T / 100">A = −log₁₀(T) = 2 − log₁₀(%T)</Eq>
        </ul>
        <p>
          Spectra are kept as loaded. Choosing transmittance or absorbance for the plots and tables
          changes only how the values are shown; peak finding and baselines always work on
          absorbance, and the tables list both. The default baseline is arPLS (see XRD above): on
          synthetic spectra with a known baseline its error was about 0.001 absorbance, against
          0.005 to 0.054 for a cubic polynomial, 0.017 to 0.040 for a rubber band and 0.024 for AsLS
          at one setting (λ = 10⁵, p = 0.01). Atmospheric CO₂ and water vapour bands are flagged
          with positions from the NIST Computational Chemistry Comparison and Benchmark Database.
        </p>
        <p>
          Functional group suggestions come from the tables of S. Pasieczna-Patkowska, M. Cichy and
          J. Flieger, Molecules 30 (2025) 684, doi:10.3390/molecules30030684, licensed CC BY 4.0
          (Tables 2 and 3). A suggestion is a candidate within a chosen distance of a band, not an
          assignment. The table was checked row by row against the article; its ranges are typical
          values from one review, so confirm a band against your own literature.
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
          overlapping steps. The Doyle coefficient 1.052 is 0.4567 · ln 10, from C. D. Doyle, J.
          Appl. Polym. Sci. 6 (1962) 639, eq. (12).
        </p>
      </section>
    </article>
  );
}
