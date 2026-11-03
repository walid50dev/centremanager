import type { LucideIcon } from 'lucide-react';
import {
  Droplets,
  Home,
  MoreHorizontal,
  Package,
  Tag,
  UserRound,
  Wifi,
  Zap,
} from 'lucide-react';
import { formatCurrency } from './format';

/**
 * Presentation helpers for the monthly expenses (Phase 11).
 *
 * Categories are **free text** stored in `settings`: the seven defaults ship
 * with the app, but the director can add anything ("Sécurité", "Taxes"). So
 * nothing here may assume a fixed set — a custom category still gets an icon
 * and a colour, picked from a stable palette.
 */

export interface CategoryStyle {
  icon: LucideIcon;
  /** Tailwind classes of the badge (background + text + ring). */
  badge: string;
  /** Bubble behind the icon in the summary cards. */
  bubble: string;
  /** i18n key when the category is one of the seven defaults. */
  labelKey?: string;
}

/**
 * The seven shipped categories, in the order of `expenses.rs`.
 *
 * Colours follow the specification: rent blue, WiFi purple, electricity
 * yellow, water cyan, assistant green, supplies orange, other grey.
 */
const DEFAULT_STYLES: Record<string, CategoryStyle> = {
  loyer: {
    icon: Home,
    badge: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
    bubble: 'bg-blue-100 text-blue-600',
    labelKey: 'expenses.categories.loyer',
  },
  wifi: {
    icon: Wifi,
    badge: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
    bubble: 'bg-violet-100 text-violet-600',
    labelKey: 'expenses.categories.wifi',
  },
  electricite: {
    icon: Zap,
    badge: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    bubble: 'bg-amber-100 text-amber-600',
    labelKey: 'expenses.categories.electricite',
  },
  eau: {
    icon: Droplets,
    badge: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200',
    bubble: 'bg-cyan-100 text-cyan-600',
    labelKey: 'expenses.categories.eau',
  },
  assistance: {
    icon: UserRound,
    badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    bubble: 'bg-emerald-100 text-emerald-600',
    labelKey: 'expenses.categories.assistance',
  },
  fournitures: {
    icon: Package,
    badge: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
    bubble: 'bg-orange-100 text-orange-600',
    labelKey: 'expenses.categories.fournitures',
  },
  autre: {
    icon: MoreHorizontal,
    badge: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
    bubble: 'bg-slate-200 text-slate-600',
    labelKey: 'expenses.categories.autre',
  },
};

/** Palette used by categories the director invented, chosen by a stable hash. */
const CUSTOM_PALETTE: Array<Pick<CategoryStyle, 'badge' | 'bubble'>> = [
  { badge: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', bubble: 'bg-rose-100 text-rose-600' },
  { badge: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200', bubble: 'bg-teal-100 text-teal-600' },
  { badge: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200', bubble: 'bg-indigo-100 text-indigo-600' },
  { badge: 'bg-lime-50 text-lime-700 ring-1 ring-inset ring-lime-200', bubble: 'bg-lime-100 text-lime-600' },
  { badge: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200', bubble: 'bg-fuchsia-100 text-fuchsia-600' },
  { badge: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200', bubble: 'bg-sky-100 text-sky-600' },
];

/**
 * Accent-insensitive, case-insensitive key of a category name.
 *
 * `Électricité` → `electricite`, so a stored label matches its style whichever
 * way it was typed.
 */
export function categoryKey(category: string): string {
  return category
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Icon + colours of a category, stable for custom values too. */
export function categoryStyle(category: string): CategoryStyle {
  const key = categoryKey(category);
  const known = DEFAULT_STYLES[key];
  if (known) return known;

  // Stable hash so "Sécurité" keeps its colour between renders and sessions.
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 9973;
  }
  const palette = CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length];
  return { icon: Tag, ...palette };
}

/** Translated label of a category (falls back to the stored text). */
export function categoryLabel(
  translate: (key: string, options?: Record<string, unknown>) => string,
  category: string,
): string {
  const key = categoryKey(category);
  const known = DEFAULT_STYLES[key];
  return known?.labelKey ? translate(known.labelKey) : category;
}

/** `42.5` → `43 %` (share of the month's total, 0 when there is nothing). */
export function shareOf(total: number, part: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** `1 200,00 DH` — with the Unicode isolates `formatCurrency` already adds. */
export function expenseAmount(cents: number): string {
  return formatCurrency(cents);
}
