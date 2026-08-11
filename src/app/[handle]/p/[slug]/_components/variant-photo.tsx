"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * The photo of the combination currently being chosen.
 *
 * The gallery and the buy box are siblings — the title, the badges and the
 * rating sit between them — so the choice has to travel through the page
 * rather than down it. A seller who photographs the charcoal apron separately
 * expects picking "Charcoal" to show it; before this, the variant's own photo
 * appeared only in the checkout sheet, which is after the buyer has decided.
 *
 * Deliberately just a URL. The gallery has no business knowing what a variant
 * is, and the buy box has none knowing how photos are laid out.
 */

type VariantPhoto = {
  /** The chosen combination's own photo, or null when it has none. */
  url: string | null;
  show: (url: string | null) => void;
};

const Context = createContext<VariantPhoto | null>(null);

export function VariantPhotoProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  // `setUrl` is stable, so the value only changes when the photo does — which
  // is what keeps the buy box's publishing effect from firing every render.
  const value = useMemo(() => ({ url, show: setUrl }), [url]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Null outside a provider, which is not an error: the card's quick-add mounts
 * the same picker with no gallery to drive.
 */
export function useVariantPhoto() {
  return useContext(Context);
}
