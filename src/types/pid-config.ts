import { PIDValues } from "./pid-values";

export interface PidConfig {
  firmware: "iNav" | "ArduPilot" | "Unknown";
  loop: "rate" | "angle" | "unknown";
  axes: {
    roll: PIDValues;
    pitch: PIDValues;
    yaw: PIDValues;
  };
  axisConfidence?: {
    roll: number;
    pitch: number;
    yaw: number;
  };
}