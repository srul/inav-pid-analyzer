export interface FftPeak {
  freqHz: number;
  peakRatio: number;
}

export interface LogAnalysis {
  fftPeaks?: Partial<{
    roll: FftPeak;
    pitch: FftPeak;
    yaw: FftPeak;
  }>;
  hasOscillation?: boolean;
}