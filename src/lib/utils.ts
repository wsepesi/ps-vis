export function toId(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function toIconId(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '');
}

export interface HPStatus {
  raw: string;
  hp?: string;
  status?: string;
  fainted: boolean;
}

export function parseHPStatus(raw: string): HPStatus {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { raw, fainted: false };
  }
  const hpToken = tokens[0];
  const extra = tokens.slice(1);
  const fainted = extra.includes('fnt') || (hpToken === '0' && !extra.length);
  const statusTokens = extra.filter((token) => token !== 'fnt');
  const hp = hpToken.includes('/') ? hpToken : hpToken === '0' && fainted ? '0/100' : undefined;
  return {
    raw,
    hp,
    status: statusTokens.length ? statusTokens.join(' ') : undefined,
    fainted,
  };
}

export function formatHPStatus(value: HPStatus): string {
  if (value.fainted) return 'KO';
  const parts: string[] = [];
  if (value.hp) {
    // Convert fraction format (X/100) to percentage (X%)
    const percentMatch = value.hp.match(/^(\d+)\/100$/);
    if (percentMatch) {
      parts.push(`${percentMatch[1]}%`);
    } else {
      parts.push(value.hp);
    }
  }
  if (value.status) parts.push(value.status.toUpperCase());
  return parts.join(' ') || value.raw;
}

export function prettifyMove(move: string): string {
  return move
    .split(' ')
    .map((chunk) => (chunk.length ? chunk[0].toUpperCase() + chunk.slice(1) : ''))
    .join(' ');
}

export function simplifyBracketText(segment: string): string {
  if (!segment) return '';
  const bracketMatch = segment.match(/^\[(.+?)\]\s*(.*)$/);
  if (!bracketMatch) return segment.trim();
  const [, tag, rest] = bracketMatch;
  const cleanRest = rest.trim();
  switch (tag) {
    case 'from':
      if (!cleanRest) return '';
      return cleanRest.replace(/^(ability|item|move):\s*/i, '');
    case 'of':
      return '';
    case 'msg':
      return cleanRest;
    case 'sid':
      return cleanRest ? `side ${cleanRest}` : '';
    case 'wisher':
      return cleanRest ? `Wish from ${cleanRest}` : 'Wish';
    case 'spread':
      return '';
    case 'move':
      return cleanRest;
    default:
      return cleanRest || tag;
  }
}

interface SummaryResponse {
  html: string;
  text: string;
  meta: {
    id?: string;
    format?: string;
    players: { p1: string; p2: string };
    winner?: string;
    loser?: string;
    resultNote?: string;
  };
  error?: string;
}

export async function requestSummary(url: string): Promise<SummaryResponse> {
  const response = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    // Try to parse JSON error response, fall back to plain text
    let errorMessage = 'Failed to summarize replay';
    try {
      const payload = (await response.json()) as SummaryResponse;
      errorMessage = payload.error ?? errorMessage;
    } catch {
      // Response wasn't valid JSON, try to get plain text
      try {
        const text = await response.text();
        errorMessage = text || `Server error (${response.status})`;
      } catch {
        errorMessage = `Server error (${response.status})`;
      }
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as SummaryResponse;
}

export async function copySummaryToClipboard(summary: SummaryResponse): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard API is unavailable in this browser.');
  }

  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    const htmlBlob = new Blob([summary.html], { type: 'text/html' });
    const textBlob = new Blob([summary.text], { type: 'text/plain' });
    const clipboardItem = new ClipboardItem({
      'text/html': htmlBlob,
      'text/plain': textBlob,
    });
    try {
      await navigator.clipboard.write([clipboardItem]);
      return;
    } catch {
      // fall through to writeText below
    }
  }

  if (typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('Clipboard writeText is unavailable in this browser.');
  }

  await navigator.clipboard.writeText(summary.text);
}
