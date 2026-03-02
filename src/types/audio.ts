export interface AudioAnalyserHandle {
  getFrequencyData(): Float32Array;
  destroy(): void;
}

export interface AudioAnalyserConfig {
  fftSize: number;
  smoothingTimeConstant: number;
}

export const DEFAULT_ANALYSER_CONFIG: AudioAnalyserConfig = {
  fftSize: 64,
  smoothingTimeConstant: 0.7,
};
