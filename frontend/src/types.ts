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
export interface Operator {
  ref: string;
  name: string;
}
export interface Access {
  operator: Operator;
  since: number;
  expires: number;
  remaining: number;
}
export interface CommandResult {
  action: "MOTOR_ON" | "MOTOR_OFF";
  accepted: boolean;
  delivered?: boolean;
  reason: string;
  operator: Operator | null;
  at: number;
}
export interface AttendanceRow {
  id: number;
  at: number;
  source: Source;
  operator_ref: string;
  operator_name: string;
  result: "ACCEPTED" | "DENIED";
}
export interface Telemetry {
  at: number;
  guard_fitted?: boolean | null;
  lock_fitted?: boolean | null;
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
  rx_bytes: number;
  last_parse_error: string;
  missing: number;
  unknown: number;
  last_warning: string;
  mismatch: boolean;
  sequence: { state: string; at: number }[];
  revision: number;
  storage_error: string;
  samples: Sample[];
  access: Access | null;
  last_unauthorised: string;
  last_command: CommandResult | null;
  tx_commands: number;
  guard_fitted: boolean | null;
  lock_fitted: boolean | null;
  operator: {
    configured: boolean;
    count: number;
    error: string;
    operators: Operator[];
  };
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
