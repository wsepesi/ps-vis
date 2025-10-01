export function toId(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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
  const fainted = extra.includes("fnt") || (hpToken === "0" && !extra.length);
  const statusTokens = extra.filter((token) => token !== "fnt");
  const hp = hpToken.includes("/") ? hpToken : hpToken === "0" && fainted ? "0/100" : undefined;
  return {
    raw,
    hp,
    status: statusTokens.length ? statusTokens.join(" ") : undefined,
    fainted,
  };
}

export function formatHPStatus(value: HPStatus): string {
  if (value.fainted) return "KO";
  const parts: string[] = [];
  if (value.hp) parts.push(value.hp);
  if (value.status) parts.push(value.status.toUpperCase());
  return parts.join(" ") || value.raw;
}

export function prettifyMove(move: string): string {
  return move
    .split(" ")
    .map((chunk) => (chunk.length ? chunk[0].toUpperCase() + chunk.slice(1) : ""))
    .join(" ");
}

export function simplifyBracketText(segment: string): string {
  if (!segment) return "";
  const bracketMatch = segment.match(/^\[(.+?)\]\s*(.*)$/);
  if (!bracketMatch) return segment.trim();
  const [, tag, rest] = bracketMatch;
  const cleanRest = rest.trim();
  switch (tag) {
    case "from":
      if (!cleanRest) return "";
      return `from ${cleanRest.replace(/^(ability|item|move):\s*/i, "")}`.trim();
    case "of":
      return "";
    case "msg":
      return cleanRest;
    case "sid":
      return cleanRest ? `side ${cleanRest}` : "";
    case "wisher":
      return cleanRest ? `Wish from ${cleanRest}` : "Wish";
    case "spread":
      return "spread";
    case "move":
      return cleanRest;
    default:
      return cleanRest || tag;
  }
}
