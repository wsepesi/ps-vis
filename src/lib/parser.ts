import { formatHPStatus, parseHPStatus, prettifyMove, simplifyBracketText, toId } from "./utils";

interface PlayerMap {
  p1: string;
  p2: string;
}

interface PokemonState {
  ref: string;
  side: "p1" | "p2";
  nickname?: string;
  species: string;
  iconId: string;
  lastDisplayHP?: string;
  status?: string;
  fainted?: boolean;
}

type ActionType = "move" | "switch" | "cant" | "note";

interface DetailEntry {
  html: string;
  text: string;
}

interface LeadEntry {
  side: 'p1' | 'p2';
  html: string;
  text: string;
}

interface ActionSummary {
  type: ActionType;
  actorRef?: string;
  actorName?: string;
  actorSpecies?: string;
  side?: "p1" | "p2";
  verb: string;
  targetNames?: string[];
  targetSpecies?: string[];
  details: DetailEntry[];
  fromIconId?: string;
  fromName?: string;
}

interface TurnSummary {
  turn: number;
  label?: string;
  headerEvents: string[];
  actions: ActionSummary[];
  endEvents: DetailEntry[];
  leadEntries: LeadEntry[];
}

interface ParseContext {
  players: PlayerMap;
  formatName?: string;
  turns: TurnSummary[];
  currentTurn: TurnSummary;
  currentAction: ActionSummary | null;
  pokemon: Map<string, PokemonState>;
  teams: { p1: string[]; p2: string[]; p1Set: Set<string>; p2Set: Set<string> };
  winner?: string;
  loser?: string;
  resultNote?: string;
  leadPhase: boolean;
}

function createInitialContext(): ParseContext {
  const leadTurn = createTurn(0, "Lead");
  return {
    players: { p1: "Player 1", p2: "Player 2" },
    turns: [leadTurn],
    currentTurn: leadTurn,
    currentAction: null,
    pokemon: new Map(),
    teams: { p1: [], p2: [], p1Set: new Set(), p2Set: new Set() },
    winner: undefined,
    loser: undefined,
    resultNote: undefined,
    leadPhase: true,
  };
}

function createTurn(turn: number, label?: string): TurnSummary {
  return {
    turn,
    label,
    headerEvents: [],
    actions: [],
    endEvents: [],
    leadEntries: [],
  };
}

function ensureCurrentTurn(ctx: ParseContext, turnNumber: number) {
  if (ctx.currentTurn.turn === turnNumber) return;
  const newTurn = createTurn(turnNumber);
  ctx.turns.push(newTurn);
  ctx.currentTurn = newTurn;
  ctx.currentAction = null;
}

function startTurn(ctx: ParseContext, turnNumber: number) {
  ensureCurrentTurn(ctx, turnNumber);
}

function addSpecies(ctx: ParseContext, side: "p1" | "p2", species: string) {
  const id = toId(species);
  if (!id) return;
  const teamKey = side === "p1" ? "p1" : "p2";
  const setKey = side === "p1" ? "p1Set" : "p2Set";
  if (!ctx.teams[setKey].has(species)) {
    ctx.teams[setKey].add(species);
    ctx.teams[teamKey].push(species);
  }
}

function parsePokemonRef(raw: string): { ref: string; nickname?: string; side: "p1" | "p2" } {
  const match = raw.match(/^([a-z0-9]+):\s*(.+)$/i);
  if (!match) {
    const ref = raw.trim();
    const side = ref.startsWith("p2") ? "p2" : "p1";
    return { ref, nickname: raw.trim(), side };
  }
  const [, ref, nickname] = match;
  const side = ref.startsWith("p2") ? "p2" : "p1";
  return { ref, nickname, side };
}

function getOrCreatePokemon(ctx: ParseContext, ref: string, side: "p1" | "p2", species = "Unknown"): PokemonState {
  const existing = ctx.pokemon.get(ref);
  if (existing) return existing;
  const iconId = toId(species) || "pokeball";
  const created: PokemonState = { ref, side, species, iconId };
  ctx.pokemon.set(ref, created);
  return created;
}

function updatePokemonSpecies(ctx: ParseContext, ref: string, species: string) {
  const side = ref.startsWith("p2") ? "p2" : "p1";
  const mon = getOrCreatePokemon(ctx, ref, side, species);
  mon.species = species;
  mon.iconId = toId(species) || mon.iconId;
  addSpecies(ctx, side, species);
}

function setCurrentAction(ctx: ParseContext, action: ActionSummary) {
  ctx.currentTurn.actions.push(action);
  ctx.currentAction = action;
}


function makeDetail(text: string, html?: string): DetailEntry {
  if (!text && !html) {
    return { text: "", html: "" };
  }
  const safeHtml = html ?? text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return {
    text,
    html: safeHtml,
  };
}

function appendDetail(ctx: ParseContext, detail: string | DetailEntry) {
  if (typeof detail === 'string') {
    if (!detail.trim()) return;
    const entry = makeDetail(detail);
    if (ctx.currentAction) {
      ctx.currentAction.details.push(entry);
    } else {
      ctx.currentTurn.endEvents.push(entry);
    }
    return;
  }
  if (!detail || (!detail.text && !detail.html)) return;
  if (ctx.currentAction) {
    ctx.currentAction.details.push(detail);
  } else {
    ctx.currentTurn.endEvents.push(detail);
  }
}

function pushHeaderEvent(ctx: ParseContext, text: string) {
  if (ctx.currentTurn.actions.length === 0) {
    ctx.currentTurn.headerEvents.push(text);
  } else {
    ctx.currentTurn.endEvents.push(makeDetail(text));
  }
}

function iconHTML(iconId: string, alt: string): string {
  const safeAlt = alt.replace(/"/g, "&quot;");
  const src = `https://play.pokemonshowdown.com/sprites/gen5/${iconId || "pokeball"}.png`;
  return `<img src="${src}" alt="${safeAlt}" width="24" height="24" style="display:inline-block;vertical-align:middle;margin-right:4px" />`;
}

function detailWithIcon(ctx: ParseContext, ref: string, body: string, htmlBody?: string): DetailEntry {
  const side = ref.startsWith("p2") ? "p2" : "p1";
  const mon = getOrCreatePokemon(ctx, ref, side);
  const label = mon.nickname || mon.species || ref;
  const icon = iconHTML(mon.iconId, label);
  const html = `${icon}${htmlBody ?? body}`;
  const text = `${label} ${body}`.trim();
  return makeDetail(text, html.trim());
}

function actionHeadline(action: ActionSummary, ctx: ParseContext): { html: string; text: string } {
  if (action.type === "switch") {
    const previousIcon = action.fromIconId ? iconHTML(action.fromIconId, action.fromName || "Previous") : "";
    const currentMon = action.actorRef ? ctx.pokemon.get(action.actorRef) : undefined;
    const currentIcon = currentMon ? iconHTML(currentMon.iconId, action.actorName || currentMon.species) : "";
    const htmlParts: string[] = [];
    if (previousIcon) htmlParts.push(previousIcon);
    if (currentIcon) {
      if (htmlParts.length) htmlParts.push(`→ ${currentIcon}`);
      else htmlParts.push(currentIcon);
    }
    const html = htmlParts.join(" ").trim() || currentIcon || previousIcon || "Switch";
    const fromText = action.fromName || (action.fromIconId ? "Prev" : "");
    const toText = action.actorName || currentMon?.species || "";
    const text = fromText && toText ? `${fromText} → ${toText}` : toText || fromText || "Switch";
    return { html, text };
  }

  const actor = action.actorRef ? ctx.pokemon.get(action.actorRef) : undefined;
  const actorName = action.actorName || actor?.nickname || actor?.species || "?";
  const actorIcon = actor ? iconHTML(actor.iconId, actorName) : "";
  const targetText = action.targetNames && action.targetNames.length
    ? action.targetNames.join(", ")
    : "";
  const targetIconHtml = action.targetSpecies && action.targetSpecies.length
    ? action.targetSpecies
        .map((species, idx) => iconHTML(toId(species) || "pokeball", action.targetNames?.[idx] || species))
        .join(" ")
    : "";
  const htmlSegments: string[] = [];
  if (actorIcon) {
    htmlSegments.push(actorIcon);
  } else if (actorName) {
    htmlSegments.push(actorName);
  }
  htmlSegments.push(action.verb);
  if (targetIconHtml) {
    htmlSegments.push(`→ ${targetIconHtml}`);
  } else if (targetText) {
    htmlSegments.push(`→ ${targetText}`);
  }
  const textSegments: string[] = [];
  textSegments.push(`${actorName} ${action.verb}`.trim());
  if (targetText) {
    textSegments.push(`→ ${targetText}`);
  }
  return {
    html: htmlSegments.join(" ").replace(/\s+/g, " "),
    text: textSegments.join(" ").replace(/\s+/g, " "),
  };
}

function combineDetails(details: DetailEntry[]): { html: string; text: string } | null {
  if (!details.length) return null;
  const text = details.map((detail) => detail.text).filter(Boolean).join("; ");
  const html = details.map((detail) => detail.html || detail.text).filter(Boolean).join("; ");
  if (!text && !html) return null;
  return {
    text: text || html,
    html: html || text,
  };
}

function formatTurn(turn: TurnSummary, ctx: ParseContext): { html: string[]; text: string[] } {
  const htmlLines: string[] = [];
  const textLines: string[] = [];
  const isLead = turn.turn === 0;
  const turnLabel = isLead ? (turn.label || "Lead") : `T${turn.turn}`;
  const headerSuffix = turn.headerEvents.length ? ` ${turn.headerEvents.join("; ")}` : "";

  if (isLead) {
    const p1Entries = turn.leadEntries.filter((entry) => entry.side === "p1");
    const p2Entries = turn.leadEntries.filter((entry) => entry.side === "p2");
    const p1Html = p1Entries.map((entry) => entry.html).join("");
    const p2Html = p2Entries.map((entry) => entry.html).join("");
    const p1Text = p1Entries.map((entry) => entry.text).join(", ");
    const p2Text = p2Entries.map((entry) => entry.text).join(", ");
    let vsHtml = "";
    if (p1Html || p2Html) {
      vsHtml = ` ${p1Html}`;
      if (p2Html) {
        vsHtml += `&nbsp;vs&nbsp;${p2Html}`;
      }
    }
    const textParts: string[] = [];
    if (p1Text) textParts.push(p1Text);
    if (p2Text) textParts.push(p2Text);
    const vsText = textParts.length ? ` ${textParts.join(" vs ")}` : "";
    htmlLines.push(`<div><strong>${turnLabel}</strong>${vsHtml}${headerSuffix}</div>`);
    textLines.push(`${turnLabel}${vsText}${headerSuffix}`.trim());
  } else {
    htmlLines.push(`<div><strong>${turnLabel}</strong>${headerSuffix}</div>`);
    textLines.push(`${turnLabel}${headerSuffix}`.trim());
  }

  for (const action of turn.actions) {
    const headline = actionHeadline(action, ctx);
    const combined = combineDetails(action.details);
    const htmlLine = combined ? `${headline.html} — ${combined.html}` : headline.html;
    const textLine = combined ? `${headline.text} — ${combined.text}` : headline.text;
    htmlLines.push(`<div>&nbsp;&nbsp;${htmlLine}</div>`);
    textLines.push(`  ${textLine}`);
  }

  if (turn.endEvents.length) {
    const combined = combineDetails(turn.endEvents);
    if (combined) {
      htmlLines.push(`<div>&nbsp;&nbsp;&nbsp;&nbsp;${combined.html}</div>`);
      textLines.push(`    ${combined.text}`);
    }
  }

  return { html: htmlLines, text: textLines };
}

function addNoteAction(ctx: ParseContext, ref: string | undefined, note: string) {
  const side = ref?.startsWith("p2") ? "p2" : "p1";
  const actor = ref ? ctx.pokemon.get(ref) : undefined;
  const action: ActionSummary = {
    type: "note",
    actorRef: ref,
    actorName: actor?.nickname || actor?.species,
    actorSpecies: actor?.species,
    side,
    verb: note,
    details: [],
  };
  setCurrentAction(ctx, action);
}

export interface SummarizedReplay {
  html: string;
  text: string;
  meta: {
    id?: string;
    format?: string;
    players: PlayerMap;
    winner?: string;
    loser?: string;
    resultNote?: string;
  };
}

interface ReplayJSON {
  id?: string;
  format?: string;
  log: string;
  players?: string[];
  rating?: number;
}

function parseLog(ctx: ParseContext, log: string) {
  const lines = log.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.startsWith("|") ? rawLine.slice(1) : rawLine;
    if (!line) continue;
    const parts = line.split("|");
    const tag = parts[0];
    switch (tag) {
      case "player": {
        const side = parts[1] as "p1" | "p2";
        const name = parts[2];
        ctx.players[side] = name;
        break;
      }
      case "gen":
      case "tier":
      case "format": {
        if (!ctx.formatName) ctx.formatName = parts[1];
        break;
      }
      case "win": {
        ctx.winner = parts[1];
        break;
      }
      case "l": {
        const loserToken = parts[1] || "";
        ctx.loser = loserToken.replace(/^[^A-Za-z0-9]+/, "");
        break;
      }
      case "turn": {
        const turnNumber = Number(parts[1]);
        ctx.leadPhase = false;
        startTurn(ctx, turnNumber);
        break;
      }
      case "poke": {
        const side = parts[1] as "p1" | "p2";
        const detail = parts[2];
        const species = detail.split(",")[0];
        addSpecies(ctx, side, species);
        break;
      }
      case "switch":
      case "drag":
      case "replace": {
        const { ref, nickname, side } = parsePokemonRef(parts[1]);
        const details = parts[2] || "";
        const species = details.split(",")[0];
        const previousMon = ctx.pokemon.get(ref);
        const previousIconId = previousMon?.iconId;
        const previousName = previousMon?.nickname || previousMon?.species;
        updatePokemonSpecies(ctx, ref, species);
        const mon = ctx.pokemon.get(ref)!;
        if (nickname) mon.nickname = nickname;
        const hpRaw = parts[3] || "";
        const hpStatus = parseHPStatus(hpRaw);
        mon.lastDisplayHP = formatHPStatus(hpStatus);
        mon.status = hpStatus.status;
        mon.fainted = hpStatus.fainted;
        if (ctx.leadPhase) {
          const label = mon.nickname || mon.species || ref;
          ctx.currentTurn.leadEntries.push({
            side,
            html: iconHTML(mon.iconId, label),
            text: label,
          });
          ctx.currentAction = null;
          break;
        }
        const switchDetails: DetailEntry[] = [];
        if (hpStatus.fainted) {
          switchDetails.push(makeDetail('fainted on entry'));
        }
        const action: ActionSummary = {
          type: "switch",
          actorRef: ref,
          actorName: mon.nickname || mon.species,
          actorSpecies: mon.species,
          side,
          verb: "switches",
          details: switchDetails,
          fromIconId: previousIconId,
          fromName: previousName,
        };
        setCurrentAction(ctx, action);
        break;
      }
      case "move": {
        const { ref, nickname, side } = parsePokemonRef(parts[1]);
        const move = prettifyMove(parts[2]);
        const targetRaw = parts[3];
        let targetNames: string[] | undefined;
        let targetSpecies: string[] | undefined;
        if (targetRaw) {
          const targetInfo = parsePokemonRef(targetRaw);
          const targetMon = ctx.pokemon.get(targetInfo.ref);
          targetNames = [targetMon?.nickname || targetMon?.species || targetInfo.nickname || targetInfo.ref];
          targetSpecies = [targetMon?.species || targetInfo.nickname || targetInfo.ref];
        }
        const actor = getOrCreatePokemon(ctx, ref, side);
        if (nickname) actor.nickname = nickname;
        const action: ActionSummary = {
          type: "move",
          actorRef: ref,
          actorName: actor.nickname || actor.species,
          actorSpecies: actor.species,
          side,
          verb: move,
          targetNames,
          targetSpecies,
          details: [],
        };
        const extras = parts.slice(4).map(simplifyBracketText).filter(Boolean);
        if (extras.length) {
          action.details.push(makeDetail(extras.join('; ')));
        }
        setCurrentAction(ctx, action);
        break;
      }
      case "cant": {
        const { ref } = parsePokemonRef(parts[1]);
        const reason = parts[2];
        const move = parts[3] ? ` while using ${prettifyMove(parts[3])}` : "";
        addNoteAction(ctx, ref, `can't move (${reason}${move})`);
        break;
      }
      case "-damage":
      case "-heal": {
        const { ref } = parsePokemonRef(parts[1]);
        const mon = ctx.pokemon.get(ref) || getOrCreatePokemon(ctx, ref, ref.startsWith("p2") ? "p2" : "p1");
        const hpRaw = parts[2];
        const hpStatus = parseHPStatus(hpRaw);
        const previous = mon.lastDisplayHP;
        const formatted = formatHPStatus(hpStatus);
        mon.lastDisplayHP = formatted;
        mon.status = hpStatus.status;
        mon.fainted = hpStatus.fainted;
        const extras = parts.slice(3).map(simplifyBracketText).filter(Boolean);
        const change = previous && previous !== formatted ? `${previous} → ${formatted}` : formatted;
        const segments = [change];
        if (extras.length) segments.push(extras.join('; '));
        const body = segments.join('; ');
        appendDetail(ctx, detailWithIcon(ctx, ref, body));
        break;
      }
      case "-boost":
      case "-unboost": {
        const { ref } = parsePokemonRef(parts[1]);
        const stat = parts[2].toUpperCase();
        const amount = Number(parts[3]);
        const direction = tag === "-boost" ? "+" : "-";
        const extras = parts.slice(4).map(simplifyBracketText).filter(Boolean);
        const detail = `${direction}${amount} ${stat}${extras.length ? ` (${extras.join("; ")})` : ""}`;
        appendDetail(ctx, detailWithIcon(ctx, ref, detail));
        break;
      }
      case "-status": {
        const { ref } = parsePokemonRef(parts[1]);
        const status = parts[2].toUpperCase();
        const extras = parts.slice(3).map(simplifyBracketText).filter(Boolean);
        const detail = extras.length ? `${status} (${extras.join("; ")})` : status;
        const mon = ctx.pokemon.get(ref);
        if (mon) mon.status = status;
        appendDetail(ctx, detailWithIcon(ctx, ref, detail));
        break;
      }
      case "-curestatus": {
        const { ref } = parsePokemonRef(parts[1]);
        const status = parts[2].toUpperCase();
        appendDetail(ctx, detailWithIcon(ctx, ref, `Cured ${status}`));
        const mon = ctx.pokemon.get(ref);
        if (mon) mon.status = undefined;
        break;
      }
      case "-ability": {
        const { ref } = parsePokemonRef(parts[1]);
        const ability = parts[2];
        const extras = parts.slice(3).map(simplifyBracketText).filter(Boolean);
        const detail = extras.length ? `${ability} (${extras.join("; ")})` : ability;
        appendDetail(ctx, detailWithIcon(ctx, ref, `Ability: ${detail}`));
        break;
      }
      case "-item": {
        const { ref } = parsePokemonRef(parts[1]);
        const item = parts[2];
        const extras = parts.slice(3).map(simplifyBracketText).filter(Boolean);
        appendDetail(ctx, detailWithIcon(ctx, ref, `Item gained: ${item}${extras.length ? ` (${extras.join("; ")})` : ""}`));
        break;
      }
      case "-enditem": {
        const { ref } = parsePokemonRef(parts[1]);
        const item = parts[2];
        const extras = parts.slice(3).map(simplifyBracketText).filter(Boolean);
        appendDetail(ctx, detailWithIcon(ctx, ref, `Item lost: ${item}${extras.length ? ` (${extras.join("; ")})` : ""}`));
        break;
      }
      case "-fieldstart": {
        const source = parts[1];
        const extras = parts.slice(2).map(simplifyBracketText).filter(Boolean);
        pushHeaderEvent(ctx, `Field start: ${source}${extras.length ? ` (${extras.join("; ")})` : ""}`);
        break;
      }
      case "-fieldend": {
        const source = parts[1];
        const extras = parts.slice(2).map(simplifyBracketText).filter(Boolean);
        pushHeaderEvent(ctx, `Field end: ${source}${extras.length ? ` (${extras.join("; ")})` : ""}`);
        break;
      }
      case "-weather": {
        const weather = parts[1];
        const extras = parts.slice(2).map(simplifyBracketText).filter(Boolean);
        pushHeaderEvent(ctx, `Weather: ${weather}${extras.length ? ` (${extras.join("; ")})` : ""}`);
        break;
      }
      case "-sidestart": {
        const side = parts[1];
        const condition = parts[2];
        pushHeaderEvent(ctx, `Side condition: ${side} → ${condition}`);
        break;
      }
      case "-sideend": {
        const side = parts[1];
        const condition = parts[2];
        pushHeaderEvent(ctx, `Side condition ended: ${side} → ${condition}`);
        break;
      }
      case "-terrain": {
        const terrain = parts[1];
        pushHeaderEvent(ctx, `Terrain: ${terrain}`);
        break;
      }
      case "-message": {
        const message = parts.slice(1).join(" ");
        if (/forfeited\.$/i.test(message)) {
          ctx.resultNote = "Forfeit";
          const forfeiter = message.replace(/\s*forfeited\.$/i, "");
          if (!ctx.loser) ctx.loser = forfeiter;
        } else if (message && !/battle timer is on/i.test(message)) {
          appendDetail(ctx, message);
        }
        break;
      }
      case "-singleturn": {
        const { ref } = parsePokemonRef(parts[1]);
        const effect = parts[2];
        appendDetail(ctx, detailWithIcon(ctx, ref, effect));
        break;
      }
      case "-activate": {
        const { ref } = parsePokemonRef(parts[1]);
        const effect = parts[2];
        const extras = parts.slice(3).map(simplifyBracketText).filter(Boolean);
        const body = `Activates ${effect}${extras.length ? ` (${extras.join("; ")})` : ""}`;
        appendDetail(ctx, detailWithIcon(ctx, ref, body));
        break;
      }
      case "-fail": {
        const { ref } = parsePokemonRef(parts[1]);
        const reason = parts.slice(2).map(simplifyBracketText).filter(Boolean).join("; ");
        const body = `Fails${reason ? ` (${reason})` : ""}`;
        appendDetail(ctx, detailWithIcon(ctx, ref, body));
        break;
      }
      case "-miss": {
        const { ref } = parsePokemonRef(parts[1]);
        const targetInfo = parts[2] ? parsePokemonRef(parts[2]) : null;
        const targetName = targetInfo?.nickname || targetInfo?.ref || parts[2] || "";
        const body = `Misses${targetName ? ` ${targetName}` : ""}`;
        appendDetail(ctx, detailWithIcon(ctx, ref, body));
        break;
      }
      case "faint": {
        const { ref } = parsePokemonRef(parts[1]);
        const mon = ctx.pokemon.get(ref);
        if (mon) mon.fainted = true;
        appendDetail(ctx, detailWithIcon(ctx, ref, 'faints'));
        break;
      }
      case "-terastallize": {
        const { ref } = parsePokemonRef(parts[1]);
        const type = parts[2];
        const mon = ctx.pokemon.get(ref);
        const name = mon?.nickname || mon?.species || parts[1];
        pushHeaderEvent(ctx, `Terastallize ${name} → ${type}`);
        break;
      }
      case "detailschange":
      case "formechange": {
        const { ref } = parsePokemonRef(parts[1]);
        const species = parts[2];
        updatePokemonSpecies(ctx, ref, species);
        break;
      }
      default:
        break;
    }
    if (tag === "turn") {
      ctx.currentAction = null;
    }
  }
}

function renderSummary(ctx: ParseContext): { html: string; text: string } {
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const { p1, p2 } = ctx.players;
  const p1Id = toId(p1);
  const p2Id = toId(p2);
  const winnerId = ctx.winner ? toId(ctx.winner) : undefined;
  let loserId = ctx.loser ? toId(ctx.loser) : undefined;
  if (!loserId && winnerId) {
    loserId = winnerId === p1Id ? p2Id : p1Id;
  }
  const p1Tag = winnerId === p1Id ? "[W] " : loserId === p1Id ? "[L] " : "";
  const p2Tag = winnerId === p2Id ? "[W] " : loserId === p2Id ? "[L] " : "";
  const note = ctx.resultNote ? ` (${ctx.resultNote})` : "";
  const header = `<div><strong>${p1Tag}${p1}</strong> vs <strong>${p2Tag}${p2}</strong>${ctx.formatName ? ` — ${ctx.formatName}` : ""}${note}</div>`;
  htmlParts.push(header);
  textParts.push(`${p1Tag}${p1} vs ${p2Tag}${p2}${ctx.formatName ? ` — ${ctx.formatName}` : ""}${note}`);

  const teamLine = (side: "p1" | "p2") => {
    const names = ctx.teams[side];
    if (!names.length) return { html: "", text: "" };
    const html = names
      .map((species) => {
        const iconId = toId(species) || "pokeball";
        return iconHTML(iconId, species);
      })
      .join("");
    const text = names.join(" · ");
    return { html, text };
  };

  const p1Team = teamLine("p1");
  const p2Team = teamLine("p2");
  if (p1Team.html || p2Team.html) {
    htmlParts.push(`<div><strong>Team Preview:</strong> ${p1Team.html}&nbsp;&nbsp;vs&nbsp;&nbsp;${p2Team.html}</div>`);
    textParts.push(`Team Preview: ${p1} ${p1Team.text} vs ${p2} ${p2Team.text}`);
  }

  for (const turn of ctx.turns) {
    if (turn.turn === 0 && turn.actions.length === 0 && turn.headerEvents.length === 0 && turn.leadEntries.length === 0) {
      continue;
    }
    const formatted = formatTurn(turn, ctx);
    htmlParts.push(...formatted.html);
    textParts.push(...formatted.text);
  }

  return {
    html: htmlParts.join("\n"),
    text: textParts.join("\n"),
  };
}

export function parseReplayData(data: ReplayJSON): SummarizedReplay {
  if (!data.log) {
    throw new Error("Replay JSON did not include a log field.");
  }
  const ctx = createInitialContext();
  ctx.players = {
    p1: data.players?.[0] || "Player 1",
    p2: data.players?.[1] || "Player 2",
  };
  ctx.formatName = data.format;
  parseLog(ctx, data.log);

  const rendered = renderSummary(ctx);
  const loserId = ctx.loser ? toId(ctx.loser) : undefined;
  const p1Id = toId(ctx.players.p1);
  const p2Id = toId(ctx.players.p2);
  const resolvedLoser = loserId === p1Id ? ctx.players.p1 : loserId === p2Id ? ctx.players.p2 : ctx.loser;
  return {
    html: rendered.html,
    text: rendered.text,
    meta: {
      id: data.id,
      format: ctx.formatName,
      players: ctx.players,
      winner: ctx.winner,
      loser: resolvedLoser,
      resultNote: ctx.resultNote,
    },
  };
}

export async function summarizeReplay(url: string): Promise<SummarizedReplay> {
  if (!url) throw new Error("Replay URL is required.");
  const jsonUrl = url.trim().endsWith(".json") ? url.trim() : `${url.trim()}.json`;
  const response = await fetch(jsonUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch replay: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as ReplayJSON;
  return parseReplayData(data);
}
