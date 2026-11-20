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
  useEffect(() => {
    let socket: WebSocket,
      retry = 0,
      watchdog = 0,
      disposed = false;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/live`,
      );
      watchdog = window.setTimeout(() => socket.close(), 4000);
      socket.onmessage = (e) => {
        if (disposed) return;
        setState(JSON.parse(e.data));
        setLink("online");
        clearTimeout(watchdog);
        watchdog = window.setTimeout(() => socket.close(), 4000);
      };
      socket.onclose = () => {
        clearTimeout(watchdog);
        if (!disposed) {
          setLink("offline");
          retry = window.setTimeout(connect, 1500);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      socket.close();
    };
  }, []);
  return { state, link };
}
export function useEvents(query: string, revision?: number) {
  const [result, setResult] = useState<{
    query: string;
    rows: Record[];
    more: boolean;
    error: string;
  }>();
  useEffect(() => {
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
