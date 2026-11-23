import { useEffect, useState } from "react";
import type { Record, Status } from "./types";
export const label = (s: string) => s.replaceAll("_", " ");
export const clock = (t?: number | null) =>
  t == null ? "—" : new Date(t * 1000).toLocaleTimeString("en-GB");
export const dateTime = (t: number) => new Date(t * 1000).toLocaleString();
export const age = (n?: number | null) =>
  n == null ? "—" : n < 1 ? "<1 s" : `${Math.floor(n)} s`;
export async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `Request failed (${response.status})`,
    );
  }
  return response.json();
}
export function useMonitor() {
  const [state, setState] = useState<Status>();
  const [link, setLink] = useState<"loading" | "online" | "offline">("loading");
  const [forced, setForced] = useState(0);
  const refresh = () => setForced((n) => n + 1);
  useEffect(() => {
    let socket: WebSocket,
      retry = 0,
      watchdog = 0,
      disposed = false;
    let streamHealthy = false;
    let inFlight: AbortController | undefined;
    const poll = async () => {
      if (disposed || streamHealthy || inFlight) return;
      const request = new AbortController();
      inFlight = request;
      const timeout = window.setTimeout(() => request.abort(), 2200);
      try {
        const response = await fetch("/api/device/status", {
          signal: request.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Status unavailable");
        const snapshot: Status = await response.json();
        if (!disposed && !streamHealthy && !request.signal.aborted) {
          setState(snapshot);
          setLink("online");
        }
      } catch {
        if (!disposed && !streamHealthy) setLink("offline");
      } finally {
        clearTimeout(timeout);
        inFlight = undefined;
      }
    };
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/live`,
      );
      watchdog = window.setTimeout(() => socket.close(), 4000);
      socket.onmessage = (e) => {
        if (disposed) return;
        streamHealthy = true;
        setState(JSON.parse(e.data));
        setLink("online");
        clearTimeout(watchdog);
        watchdog = window.setTimeout(() => socket.close(), 4000);
      };
      socket.onclose = () => {
        clearTimeout(watchdog);
        if (!disposed) {
          streamHealthy = false;
          void poll();
          retry = window.setTimeout(connect, 1500);
        }
      };
    };
    connect();
    void poll();
    const interval = window.setInterval(poll, 1000);
    return () => {
      disposed = true;
      clearInterval(interval);
      inFlight?.abort();
      clearTimeout(retry);
      clearTimeout(watchdog);
      socket.close();
    };
  }, [forced]);
  return { state, link, refresh };
}
export function useEvents(query: string, revision?: number) {
  const [result, setResult] = useState<{
    query: string;
    rows: Record[];
    more: boolean;
    error: string;
  }>();
  useEffect(() => {
    if (revision === undefined) return;
    const controller = new AbortController();
    fetch(`/api/events?${query}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("History unavailable");
        return r.json();
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ ...data, query, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setResult({ query, rows: [], more: false, error: e.message });
      });
    return () => controller.abort();
  }, [query, revision]);
  return result?.query === query ? result : undefined;
}
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
export function usePreference<T>(name: string, fallback: T) {
  const [value, set] = useState<T>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(`prooflock.${name}`) ?? "null") ??
        fallback
      );
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`prooflock.${name}`, JSON.stringify(value));
    } catch {
      /* unavailable */
    }
  }, [value, name]);
  return [value, set] as const;
}
