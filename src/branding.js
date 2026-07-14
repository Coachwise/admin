// Coachwise branding for AdminJS.
//
// Colours are the same brand tokens the product uses (app/src/styles/globals.css
// --brand-*): navy #0E0E55, yellow #eab308, ice #EEF2F7. Kept as literals here
// because this is a separate app with no access to the Tailwind theme — if the
// brand palette moves, it moves in both places.
//
// The logo is app/brand/icon.svg (yellow mark on the navy tile) rather than
// mark.svg: the mark takes `currentColor` so the surface can decide its colour,
// and an <img> gives it no colour to inherit — it would render black.

const NAVY = '#0E0E55';
const NAVY_LIGHT = '#1A1A6E';
const YELLOW = '#eab308';
const ICE = '#EEF2F7';

export const branding = {
  companyName: 'Coachwise',
  logo: '/admin/assets/logo.svg',
  favicon: '/admin/assets/favicon.svg',
  withMadeWithLove: false,

  theme: {
    colors: {
      // Navy carries the chrome: sidebar, top bar, buttons.
      primary100: NAVY,
      primary80: NAVY_LIGHT,
      primary60: '#3A3A8C',
      primary40: '#7A7ABA',
      primary20: '#C3C3DE',

      // Yellow is the accent only — it marks the thing you're meant to act on,
      // which in this panel is nearly always a payout waiting in the queue.
      accent: YELLOW,
      love: YELLOW,

      bg: ICE,
      container: '#FFFFFF',
      sidebar: '#FFFFFF',

      grey100: '#111827',
      grey80: '#374151',
      grey60: '#6B7280',
      grey40: '#9CA3AF',
      grey20: '#E5E7EB',

      filterBg: NAVY,
      hoverBg: ICE,
      inputBorder: '#D1D5DB',
      separator: '#E5E7EB',

      // Money actions are irreversible; keep the danger colour unmistakable.
      error: '#DC2626',
      errorDark: '#991B1B',
      success: '#059669',
      successDark: '#047857',
      info: NAVY,
      infoDark: NAVY_LIGHT,
    },
  },
};
