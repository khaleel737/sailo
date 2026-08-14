import type { SFSymbol } from "expo-symbols";
import {
  Banknote,
  Bell,
  Calendar,
  Camera,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  House,
  Image,
  Info,
  Landmark,
  LayoutGrid,
  Link,
  ListFilter,
  OctagonX,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Share,
  ShoppingBag,
  Tag,
  Ticket,
  TriangleAlert,
  Trash2,
  User,
  X,
  type LucideIcon,
} from "lucide-react-native";
import type { IconName } from "../types";

/**
 * One name, two platforms, in the only file that knows either of their
 * vocabularies.
 *
 * A screen says `icon="orders"`. It does not say `"bag"`, and it does not say
 * `ShoppingBag` — because a screen that names an SF Symbol is a screen that has
 * to be edited again for Android, and edited a third time the year Apple
 * renames the symbol. `IconName` in `../types` is the closed union a screen may
 * spell; this is where each of those becomes a glyph.
 *
 * WHY LUCIDE ON ANDROID
 *
 * Because the admin is already drawn in it — 148 files under `apps/web/src`
 * import from `lucide-react`, and `lucide-react-native` is the same icon set at
 * the same version. A seller who does half their day in the browser and half on
 * a phone sees one product. Hand-copying path data out of the web package would
 * have got the same pixels today and drifted at the first upgrade; this way
 * there is one version number to bump.
 *
 * WHY THE CHEVRONS ARE `forward` AND `backward`
 *
 * SF Symbols with a directional suffix mirror themselves when the interface
 * direction flips, so `chevron.forward` points left in Arabic without anything
 * being asked to notice. Lucide has no such notion, so `mirrors` marks the two
 * that have to be flipped by hand on Android — see `icon.tsx`. Getting this
 * wrong is not subtle: a disclosure chevron pointing back the way you came is
 * the single most obvious sign an app was translated rather than localised.
 */
export type IconGlyph = {
  /** iOS. Verified against `sf-symbols-typescript`, so a typo is a type error. */
  readonly sf: SFSymbol;
  /** Android, and anywhere `SymbolView` cannot draw. */
  readonly lucide: LucideIcon;
  /**
   * Whether this glyph points along the writing direction.
   *
   * True only for the two that do. A mirrored clock or a mirrored magnifying
   * glass is worse than an unmirrored chevron — the rule is "mirror what points
   * at something", not "mirror everything in a right-to-left locale".
   */
  readonly mirrors?: true;
};

/*
 * Annotated rather than `as const satisfies`, so that every entry has the same
 * type. Under `as const` an icon without `mirrors` does not have the property
 * at all, and `icon.tsx` would have to narrow thirty-five times to ask a
 * question the type is supposed to answer once.
 */
export const icons: Record<IconName, IconGlyph> = {
  // Navigation and structure
  home: { sf: "house", lucide: House },
  orders: { sf: "bag", lucide: ShoppingBag },
  store: { sf: "square.grid.2x2", lucide: LayoutGrid },
  insights: { sf: "chart.bar", lucide: ChartColumn },
  settings: { sf: "gearshape", lucide: Settings },
  chevronEnd: { sf: "chevron.forward", lucide: ChevronRight, mirrors: true },
  chevronDown: { sf: "chevron.down", lucide: ChevronDown },
  close: { sf: "xmark", lucide: X },
  back: { sf: "chevron.backward", lucide: ChevronLeft, mirrors: true },
  external: { sf: "arrow.up.right.square", lucide: ExternalLink },

  // Actions
  add: { sf: "plus", lucide: Plus },
  edit: { sf: "pencil", lucide: Pencil },
  delete: { sf: "trash", lucide: Trash2 },
  search: { sf: "magnifyingglass", lucide: Search },
  filter: { sf: "line.3.horizontal.decrease", lucide: ListFilter },
  share: { sf: "square.and.arrow.up", lucide: Share },
  copy: { sf: "doc.on.doc", lucide: Copy },
  refresh: { sf: "arrow.clockwise", lucide: RefreshCw },
  scan: { sf: "qrcode.viewfinder", lucide: ScanLine },

  // Objects
  camera: { sf: "camera", lucide: Camera },
  photo: { sf: "photo", lucide: Image },
  link: { sf: "link", lucide: Link },
  card: { sf: "creditcard", lucide: CreditCard },
  bank: { sf: "building.columns", lucide: Landmark },
  cash: { sf: "banknote", lucide: Banknote },
  calendar: { sf: "calendar", lucide: Calendar },
  clock: { sf: "clock", lucide: Clock },
  person: { sf: "person", lucide: User },
  bell: { sf: "bell", lucide: Bell },
  ticket: { sf: "ticket", lucide: Ticket },
  tag: { sf: "tag", lucide: Tag },

  // Feedback
  check: { sf: "checkmark", lucide: Check },
  warning: { sf: "exclamationmark.triangle", lucide: TriangleAlert },
  info: { sf: "info.circle", lucide: Info },
  error: { sf: "xmark.octagon", lucide: OctagonX },
};
