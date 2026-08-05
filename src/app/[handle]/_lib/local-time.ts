/**
 * `datetime-local` reads and writes wall-clock time with no zone attached, so
 * the value has to be built from the buyer's own local parts. Anything derived
 * from an ISO string would show them a UTC time and book the wrong slot.
 */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
