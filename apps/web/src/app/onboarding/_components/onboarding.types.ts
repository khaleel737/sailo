import type { ChangeEvent } from "react";

/** What the seller has entered so far, carried across every step. */
export type Values = {
  handle: string;
  name: string;
  description: string;
  location: string;
  currency: string;
  accentColor: string;
};

/**
 * A change handler bound to one field. Built once in the form so a step never
 * has to know how the values are stored.
 */
export type SetField = (
  key: keyof Values,
) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
