// TEMPORARY local stand-in until the real import parsers land. Not committed.
import type { SignalKind, SignalSource, TasteSignal } from "./taste";
export interface CalendarEventLike { id?: string; summary?: string; location?: string; description?: string; start?: string; end?: string }
export const guessKind = (_name: string, _hints?: string[]): SignalKind => "food";
export const dedupeSignals = (s: TasteSignal[]) => [...new Map(s.map((x) => [`${x.source}|${x.ref}`, x])).values()];
export const calendarSignals = (_e: CalendarEventLike[], _s: "google_calendar" | "ics"): TasteSignal[] => [];
export const parseImportFile = (_f: string, _t: string): { format: "takeout" | "meta" | "swarm" | "ics" | "unknown"; signals: TasteSignal[]; error?: string; source?: SignalSource } => ({ format: "unknown", signals: [] });
