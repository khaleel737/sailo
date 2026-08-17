/** Trims a buyer-supplied string and caps it, or gives back nothing. */

export function clean(value: string | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
