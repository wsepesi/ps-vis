const ICON_BASE_URL = 'https://play.pokemonshowdown.com/sprites/gen5';

export const DEFAULT_ICON_ID = 'pokeball';

const IMAGE_RULES = [
  'display:inline-block',
  'vertical-align:middle',
  'width:24px',
  'height:24px',
  'margin-right:4px',
  'image-rendering:pixelated',
];

export function getPokemonIconUrl(rawId?: string | null): string {
  const iconId = rawId && rawId.trim() ? rawId.trim() : DEFAULT_ICON_ID;
  return `${ICON_BASE_URL}/${iconId}.png`;
}

function escapeAltText(text: string): string {
  return text.replace(/"/g, '&quot;');
}

export function renderPokemonIcon(rawId: string | undefined, alt: string): string {
  const safeAlt = escapeAltText(alt);
  const src = getPokemonIconUrl(rawId);
  return `<img src="${src}" alt="${safeAlt}" width="24" height="24" style="${IMAGE_RULES.join(';')}" />`;
}
