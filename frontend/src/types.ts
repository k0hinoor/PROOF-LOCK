export type Source = "live" | "simulator";
export type Motor = "RUNNING" | "STOPPING" | "STOPPED" | "FAULT" | "UNKNOWN";
export type Guard = "OPEN" | "CLOSED" | "FAULT" | "UNKNOWN";
export type Lock = "LOCKED" | "RELEASED" | "FAULT" | "UNKNOWN";
export type Standstill =
  | "NOT_VERIFIED"
  | "VERIFYING"
  | "VERIFIED"
  | "SENSOR_FAULT"
  | "UNKNOWN";
export interface Telemetry {
  at: number;
  seq: number;
  motor: Motor;
  guard_a: Guard;
  guard_b: Guard;
  lock: Lock;
  standstill: Standstill;
  back_emf_adc: number | null;
}
export interface Sample {
  at: number;
  adc: number | null;
}
export interface Status {
  source: Source;
  preview: boolean;
  connected: boolean;
  fresh: boolean;
  port: string | null;
  baud: number | null;
  since: number | null;
  error: string;
  packet_age: number | null;
  telemetry_age: number | null;
  latest: Telemetry | null;
  meta: { device?: string; firmware?: string; v?: number; uptime_ms?: number };
  valid: number;
  invalid: number;
  missing: number;
  unknown: number;
  last_warning: string;
  mismatch: boolean;
  sequence: { state: string; at: number }[];
  revision: number;
  storage_error: string;
  samples: Sample[];
}
export interface Record {
  id: number;
  at: number;
  source: Source;
  origin: string;
  category: string;
  code: string;
  severity: string;
  details: string;
  seq: number | null;
  snapshot: Telemetry | null;
}
