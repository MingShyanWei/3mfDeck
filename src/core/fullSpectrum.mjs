// Full Spectrum (dithered) detection thresholds — shared by parser and UI.
//
// Full Spectrum files mix colours spatially: neighbouring triangles carry
// different single filaments (paint_color is one filament per triangle, see
// paintColor.mjs), so most vertices touch faces of several colours. Measured
// "vertex-mixed" share on real files: FullSpectrum Lizard 82.3 %;
// region-painted files 0-18 % (Meshy 16-colour Kiki 18.0 %, katie 11.1 %,
// Panic Button 8.1 %, others < 3 %).
export const FULL_SPECTRUM = { minVertexMixedPct: 50, minColors: 3, minFaces: 10000 };
