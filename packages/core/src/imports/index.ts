/**
 * Places people have been, from the accounts they connect: Google Calendar and the calendars on
 * their phone (flights, stays, restaurant reservations, tours and trips), plus the helpers the
 * Facebook import uses to tell what kind of place something is and to merge duplicates.
 */
export { guessKind } from "./kind";
export { dedupeSignals } from "./dedupe";
export { calendarSignals, type CalendarEventLike } from "./calendar";
