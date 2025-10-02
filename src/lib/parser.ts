import { renderPokemonIcon, DEFAULT_ICON_ID } from './pokemonIcons';
import { formatHPStatus, parseHPStatus, prettifyMove, simplifyBracketText, toId, toIconId } from './utils';

type DualFormat = { html: string; text: string };

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

type DetailEntry = DualFormat;

interface LeadEntry extends DualFormat {
  side: 'p1' | 'p2';
}

interface ActionSummary {
  type: ActionType;
  actorRef?: string;
  actorName?: string;
  actorSpecies?: string;
  actorIconId?: string;
  side?: "p1" | "p2";
  verb: string;
  targetRefs?: string[];
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
  faintedThisTurn: Set<string>;
  currentWeather?: string;
  sideConditions: { p1: Set<string>; p2: Set<string> };
  pendingAbilityBoost?: { ref: string; ability: string; boosts: Array<{ ref: string; stat: string; amount: number; direction: string }> };
  recentMoves: Array<{ ref: string; move: string }>;
  pendingSwitchAbility?: { ref: string; ability: string; effect: string };
  activePositions: { p1a?: string; p1b?: string; p2a?: string; p2b?: string };
  pendingFieldEnds: Array<{ effect: string }>;
  pendingProtects: Set<string>;
}

function resolveSide(ref: string): 'p1' | 'p2' {
  return ref.startsWith('p2') ? 'p2' : 'p1';
}

function parseExtras(parts: string[], startIndex: number): string[] {
  return parts
    .slice(startIndex)
    .map(simplifyBracketText)
    .filter(Boolean);
}

function formatExtras(extras: string[]): string {
  const filtered = extras.filter(Boolean);
  return filtered.length ? ` (${filtered.join('; ')})` : '';
}

function normalizeWeatherName(weather: string): string {
  const normalized = weather.toLowerCase();
  if (normalized.includes('raindance') || normalized === 'raindance') return 'Rain';
  if (normalized.includes('sandstorm')) return 'Sandstorm';
  if (normalized.includes('sunnyday') || normalized === 'sunnyday') return 'Sun';
  if (normalized.includes('hail')) return 'Hail';
  if (normalized.includes('snow')) return 'Snow';
  return weather;
}

function normalizeFieldName(field: string): string {
  // Remove "move: " prefix if present
  const normalized = field.replace(/^move:\s*/i, '');
  // Terrain names
  if (normalized.includes('Psychic Terrain')) return 'Psychic Terrain';
  if (normalized.includes('Electric Terrain')) return 'Electric Terrain';
  if (normalized.includes('Grassy Terrain')) return 'Grassy Terrain';
  if (normalized.includes('Misty Terrain')) return 'Misty Terrain';
  // Room/field effects
  if (normalized.includes('Trick Room')) return 'Trick Room';
  if (normalized.includes('Magic Room')) return 'Magic Room';
  if (normalized.includes('Wonder Room')) return 'Wonder Room';
  if (normalized.includes('Gravity')) return 'Gravity';
  return normalized;
}

function hasSpeciesOnBothSides(ctx: ParseContext, species: string): boolean {
  // Check if species exists in both teams (not just actively battling)
  return ctx.teams.p1.includes(species) && ctx.teams.p2.includes(species);
}

function getPokemonDisplayName(ctx: ParseContext, ref: string): string {
  const mon = ctx.pokemon.get(ref);
  if (!mon) return ref;

  const baseName = mon.nickname || mon.species;
  const side = resolveSide(ref);

  // Check if there's a duplicate species on the opposite side
  if (side === 'p2' && hasSpeciesOnBothSides(ctx, mon.species)) {
    return `${baseName} (opp)`;
  }

  return baseName;
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
    faintedThisTurn: new Set(),
    currentWeather: undefined,
    sideConditions: { p1: new Set(), p2: new Set() },
    recentMoves: [],
    pendingSwitchAbility: undefined,
    activePositions: {},
    pendingFieldEnds: [],
    pendingProtects: new Set(),
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

  // Flush any pending field ends before starting new turn
  flushPendingFieldEnds(ctx);

  const newTurn = createTurn(turnNumber);
  ctx.turns.push(newTurn);
  ctx.currentTurn = newTurn;
  ctx.currentAction = null;
  ctx.faintedThisTurn.clear();
  ctx.recentMoves = [];
  ctx.pendingProtects.clear();
}

function addSpecies(ctx: ParseContext, side: 'p1' | 'p2', species: string) {
  const normalized = species.trim();
  const id = toId(normalized);
  if (!id) return;
  const set = side === 'p1' ? ctx.teams.p1Set : ctx.teams.p2Set;
  if (set.has(normalized)) return;
  set.add(normalized);
  ctx.teams[side].push(normalized);
}

function parsePokemonRef(raw: string): { ref: string; nickname?: string; side: 'p1' | 'p2' } {
  const match = raw.match(/^([a-z0-9]+):\s*(.+)$/i);
  if (!match) {
    const ref = raw.trim();
    const side = resolveSide(ref);
    return { ref, nickname: raw.trim(), side };
  }
  const [, ref, nickname] = match;
  const side = resolveSide(ref);
  return { ref, nickname, side };
}

function getOrCreatePokemon(
  ctx: ParseContext,
  ref: string,
  side: 'p1' | 'p2',
  species = 'Unknown',
): PokemonState {
  const existing = ctx.pokemon.get(ref);
  if (existing) return existing;
  const iconId = toIconId(species) || DEFAULT_ICON_ID;
  const created: PokemonState = { ref, side, species, iconId };
  ctx.pokemon.set(ref, created);
  return created;
}

function updatePokemonSpecies(ctx: ParseContext, ref: string, species: string) {
  const side = resolveSide(ref);
  const mon = getOrCreatePokemon(ctx, ref, side, species);
  mon.species = species;
  mon.iconId = toIconId(species) || mon.iconId;
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

function isEndOfTurnSource(source: string): boolean {
  const lowerSource = source.toLowerCase();
  return (
    lowerSource.includes('leftovers') ||
    lowerSource.includes('black sludge') ||
    lowerSource.includes('psn') ||
    lowerSource.includes('poison') ||
    lowerSource.includes('brn') ||
    lowerSource.includes('burn') ||
    lowerSource.includes('sandstorm') ||
    lowerSource.includes('hail') ||
    lowerSource.includes('grassy terrain') ||
    lowerSource.includes('aqua ring') ||
    lowerSource.includes('ingrain') ||
    lowerSource.includes('leech seed')
  );
}

function appendDetail(ctx: ParseContext, detail: string | DetailEntry, forceEndEvent = false) {
  if (typeof detail === 'string') {
    if (!detail.trim()) return;
    const entry = makeDetail(detail);
    if (forceEndEvent || !ctx.currentAction) {
      ctx.currentTurn.endEvents.push(entry);
    } else {
      ctx.currentAction.details.push(entry);
    }
    return;
  }
  if (!detail || (!detail.text && !detail.html)) return;
  if (forceEndEvent || !ctx.currentAction) {
    ctx.currentTurn.endEvents.push(detail);
  } else {
    ctx.currentAction.details.push(detail);
  }
}

function pushHeaderEvent(ctx: ParseContext, text: string) {
  if (ctx.currentTurn.actions.length === 0) {
    ctx.currentTurn.headerEvents.push(text);
  } else {
    ctx.currentTurn.endEvents.push(makeDetail(text));
  }
}

function flushPendingFieldEnds(ctx: ParseContext) {
  if (ctx.pendingFieldEnds.length === 0) return;

  const fieldEndTexts = ctx.pendingFieldEnds.map(e => `${e.effect} ends`);
  const combined = fieldEndTexts.join('; ');
  ctx.currentTurn.endEvents.push(makeDetail(combined));
  ctx.pendingFieldEnds = [];
}

function iconHTML(iconId: string | undefined, alt: string): string {
  return renderPokemonIcon(iconId || DEFAULT_ICON_ID, alt);
}

function detailWithIcon(ctx: ParseContext, ref: string, body: string, htmlBody?: string): DetailEntry {
  const side = resolveSide(ref);
  const mon = getOrCreatePokemon(ctx, ref, side);
  const label = getPokemonDisplayName(ctx, ref);
  const icon = iconHTML(mon.iconId, label);
  const html = `${icon}${htmlBody ?? body}`;
  const text = `${label} ${body}`.trim();
  return makeDetail(text, html.trim());
}

function actionHeadline(ctx: ParseContext, action: ActionSummary): DualFormat {
  if (action.type === "switch") {
    // Use the actorName that was set at action creation time (includes (opp) if needed)
    const toText = action.actorName || "";
    const currentIcon = action.actorIconId ? iconHTML(action.actorIconId, toText) : "";

    // Check if this is a replacement entry
    if (action.verb.startsWith("enters")) {
      const html = `${currentIcon}${action.verb}`.trim();
      const text = `${toText} ${action.verb}`.trim();
      return { html, text };
    }

    // Voluntary switch with arrows
    const previousIcon = action.fromIconId ? iconHTML(action.fromIconId, action.fromName || "Previous") : "";
    const htmlParts: string[] = [];
    if (previousIcon) htmlParts.push(previousIcon);
    if (currentIcon) {
      if (htmlParts.length) htmlParts.push(`-> ${currentIcon}`);
      else htmlParts.push(currentIcon);
    }

    // Check if verb has additional info (ability activation, etc.)
    let extraInfo = "";
    if (action.verb && action.verb !== "switches") {
      const parts = action.verb.split(";");
      if (parts.length > 1 && parts[0].trim() === "switches") {
        // Extract everything after "switches"
        extraInfo = "; " + parts.slice(1).map(p => p.trim()).join("; ");
      }
    }

    const html = (htmlParts.join(" ").trim() || currentIcon || previousIcon || "Switch") + extraInfo;
    const fromText = action.fromName || (action.fromIconId ? "Prev" : "");
    const text = (fromText && toText ? `${fromText} -> ${toText}` : toText || fromText || "Switch") + extraInfo;
    return { html, text };
  }

  // Use the actorName that was set at action creation time (includes (opp) if needed)
  const actorName = action.actorName || "?";
  const actorIcon = action.actorIconId ? iconHTML(action.actorIconId, actorName) : "";

  // Check if self-targeting (no target or actor is target)
  const isSelfTarget = !action.targetRefs?.length ||
    (action.targetRefs.length === 1 && action.actorRef === action.targetRefs[0]);

  // Use targetNames that were set at action creation time (includes (opp) and (Protect) if needed)
  const targetDisplayNames = action.targetNames && !isSelfTarget
    ? action.targetNames
    : [];

  const targetText = targetDisplayNames.length > 0
    ? targetDisplayNames.join(", ")
    : "";
  const targetIconHtml = action.targetSpecies && action.targetSpecies.length && !isSelfTarget
    ? action.targetSpecies
        .map((species, idx) => {
          const displayName = targetDisplayNames[idx] || action.targetNames?.[idx] || species;
          return iconHTML(toIconId(species) || DEFAULT_ICON_ID, displayName);
        })
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
    htmlSegments.push(`-> ${targetIconHtml}`);
  } else if (targetText) {
    htmlSegments.push(`-> ${targetText}`);
  }
  const textSegments: string[] = [];
  textSegments.push(`${actorName} ${action.verb}`.trim());
  if (targetText) {
    textSegments.push(`-> ${targetText}`);
  }
  return {
    html: htmlSegments.join(" ").replace(/\s+/g, " "),
    text: textSegments.join(" ").replace(/\s+/g, " "),
  };
}

function combineDetails(details: DetailEntry[]): DualFormat | null {
  if (!details.length) return null;
  const text = details.map((detail) => detail.text).filter(Boolean).join("; ");
  const html = details.map((detail) => detail.html || detail.text).filter(Boolean).join("; ");
  if (!text && !html) return null;
  return {
    text: text || html,
    html: html || text,
  };
}

function formatTurn(ctx: ParseContext, turn: TurnSummary): { html: string[]; text: string[] } {
  const htmlLines: string[] = [];
  const textLines: string[] = [];
  const isLead = turn.turn === 0;
  const turnLabel = isLead ? (turn.label || "Lead") : `T${turn.turn}`;

  // Separate terastallize events from other header events
  const teraEvents = turn.headerEvents.filter(e => e.startsWith('Terastallize'));
  const otherEvents = turn.headerEvents.filter(e => !e.startsWith('Terastallize'));
  const headerSuffix = otherEvents.length ? ` ${otherEvents.join("; ")}` : "";

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

  // Add terastallize events as separate lines after turn header
  for (const teraEvent of teraEvents) {
    htmlLines.push(`<div>&nbsp;&nbsp;${teraEvent}</div>`);
    textLines.push(`  ${teraEvent}`);
  }

  for (const action of turn.actions) {
    const headline = actionHeadline(ctx, action);

    // Use comma for single-target moves with details, dash for others
    const isSingleTarget = action.type === "move" &&
      action.targetNames?.length === 1 &&
      !action.verb.includes("spread");
    const separator = action.details.length > 0 && isSingleTarget ? ", " : " — ";

    // For single-target moves with stat boosts, combine with commas instead of semicolons
    let combined: DualFormat | null = null;
    if (isSingleTarget && action.details.length > 0) {
      // Check if all details are stat boosts (match pattern like "Pokemon +1 ATK", "-2 DEF", etc.)
      const allBoosts = action.details.every(d => /[+-]\d+\s+\w+/.test(d.text.trim()));
      if (allBoosts) {
        // Combine boosts with commas
        const text = action.details.map(d => d.text).filter(Boolean).join(", ");
        const html = action.details.map(d => d.html || d.text).filter(Boolean).join(", ");
        combined = { text, html };
      } else {
        combined = combineDetails(action.details);
      }
    } else {
      combined = combineDetails(action.details);
    }

    // For single-target moves, strip the target name/icon from all details
    if (combined && isSingleTarget && action.details.length > 0) {
      const targetIconId = action.targetSpecies?.[0] ? toIconId(action.targetSpecies[0]) : undefined;
      const targetName = action.targetNames?.[0] || "";

      // Remove all occurrences of the target icon and name from the combined details
      if (targetIconId) {
        const iconPattern = `<img src="https://play.pokemonshowdown.com/sprites/gen5/${targetIconId}.png"[^>]*>`;
        combined.html = combined.html.replace(new RegExp(iconPattern, 'g'), "").trim();
      }
      if (targetName) {
        // Remove all instances of target name (at start of segments, after commas/semicolons)
        const namePattern = `(^|[,;]\\s*)${targetName}\\s+`;
        combined.text = combined.text.replace(new RegExp(namePattern, 'g'), '$1').trim();
      }
    }

    const htmlLine = combined ? `${headline.html}${separator}${combined.html}` : headline.html;
    const textLine = combined ? `${headline.text}${separator}${combined.text}` : headline.text;
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
  const side = ref ? resolveSide(ref) : 'p1';
  const actor = ref ? ctx.pokemon.get(ref) : undefined;
  const action: ActionSummary = {
    type: "note",
    actorRef: ref,
    actorName: actor?.nickname || actor?.species,
    actorSpecies: actor?.species,
    actorIconId: actor?.iconId,
    side,
    verb: note,
    details: [],
  };
  setCurrentAction(ctx, action);
}

function finalizePendingAbilityBoost(ctx: ParseContext) {
  if (!ctx.pendingAbilityBoost) return;

  const { ref, ability, boosts } = ctx.pendingAbilityBoost;
  const mon = ctx.pokemon.get(ref);
  const pokemonName = mon?.nickname || mon?.species || ref;
  const possessive = pokemonName.endsWith('s') ? `'` : `'s`;

  // Build the ability announcement with all boosts
  const parts: DetailEntry[] = [];
  // Manually construct the ability announcement with sprite
  const abilityText = `${pokemonName}${possessive} ${ability}`;
  const abilityHtml = `${iconHTML(mon?.iconId, pokemonName)}${pokemonName}${possessive} ${ability}`;
  parts.push(makeDetail(abilityText, abilityHtml));

  // Group boosts by target ref to consolidate multiple boosts to same target
  const boostsByTarget = new Map<string, Array<{ direction: string; amount: number; stat: string }>>();
  for (const boost of boosts) {
    if (!boostsByTarget.has(boost.ref)) {
      boostsByTarget.set(boost.ref, []);
    }
    boostsByTarget.get(boost.ref)!.push(boost);
  }

  // Create one detail entry per target with all boosts combined
  for (const [targetRef, targetBoosts] of boostsByTarget) {
    const boostTexts = targetBoosts.map(b => `${b.direction}${b.amount} ${b.stat}`);
    const combinedBoostText = boostTexts.join(', ');
    parts.push(detailWithIcon(ctx, targetRef, combinedBoostText));
  }

  const combined = combineDetails(parts);
  if (combined) {
    if (ctx.leadPhase || ctx.currentTurn.turn === 1 && ctx.currentTurn.actions.length === 0) {
      pushHeaderEvent(ctx, combined.text);
    } else {
      appendDetail(ctx, combined);
    }
  }

  ctx.pendingAbilityBoost = undefined;
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
        if (name) ctx.players[side] = name;
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
        finalizePendingAbilityBoost(ctx); // Finalize any pending ability boost
        const turnNumber = Number(parts[1]);
        ctx.leadPhase = false;
        ensureCurrentTurn(ctx, turnNumber);
        ctx.currentAction = null;
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
        finalizePendingAbilityBoost(ctx); // Finalize any pending ability boost
        const { ref, nickname, side } = parsePokemonRef(parts[1]);
        const details = parts[2] || "";
        const species = details.split(",")[0];
        const previousMon = ctx.pokemon.get(ref);
        const previousIconId = previousMon?.iconId;
        const previousName = previousMon?.nickname || previousMon?.species;
        updatePokemonSpecies(ctx, ref, species);
        const mon = ctx.pokemon.get(ref);
        if (!mon) break;
        if (nickname) mon.nickname = nickname;
        const hpRaw = parts[3] || "";
        const hpStatus = parseHPStatus(hpRaw);
        mon.lastDisplayHP = formatHPStatus(hpStatus);
        mon.status = hpStatus.status;
        mon.fainted = hpStatus.fainted;

        // Update active positions - extract position from ref (e.g., "p1a" from "p1a: Dragonite")
        const position = ref.match(/^(p[12][ab])/)?.[1];
        if (position) {
          ctx.activePositions[position as keyof typeof ctx.activePositions] = ref;
        }

        // Check if this is a forced switch from a move (e.g., Parting Shot, U-turn, Volt Switch)
        const switchExtras = parseExtras(parts, 4);
        const forcedByMove = switchExtras.find(extra => {
          // Check if this is from a move (not ability or item)
          const lowerExtra = extra.toLowerCase();
          return !lowerExtra.includes('ability') && !lowerExtra.includes('item') && extra.length > 0;
        });

        if (forcedByMove && ctx.currentAction?.type === "move" && ctx.currentAction.actorRef === ref) {
          // This is a forced switch from the current move - merge it into that action

          // First, consolidate any boost details with commas
          const boostDetails = ctx.currentAction.details.filter(d => /[+-]\d+\s+\w+/.test(d.text.trim()));
          const otherDetails = ctx.currentAction.details.filter(d => !/[+-]\d+\s+\w+/.test(d.text.trim()));

          if (boostDetails.length > 0) {
            const boostText = boostDetails.map(d => d.text).join(", ");
            const boostHtml = boostDetails.map(d => d.html || d.text).join(", ");
            ctx.currentAction.details = [makeDetail(boostText, boostHtml), ...otherDetails];
          }

          // Add switch detail with icons
          const displayName = getPokemonDisplayName(ctx, ref);
          const switchText = `${previousName || 'Previous'} -> ${displayName}`;
          const previousIcon = previousIconId ? iconHTML(previousIconId, previousName || "Previous") : "";
          const currentIcon = mon.iconId ? iconHTML(mon.iconId, displayName) : "";
          let switchHtml = switchText;
          if (previousIcon && currentIcon) {
            switchHtml = `${previousIcon} -> ${currentIcon}`;
          } else if (currentIcon) {
            switchHtml = currentIcon;
          }
          ctx.currentAction.details.push(makeDetail(switchText, switchHtml));

          // Active positions already updated above
          break;
        }

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
        // Check if this is a replacement (after a faint) or voluntary switch
        const isReplacement = ctx.faintedThisTurn.size > 0;

        // Determine verb - use display name for enters to include (opp) if needed
        let verb: string;
        if (isReplacement) {
          verb = "enters";
          // If display name includes (opp), we'll handle it in the action rendering
        } else {
          verb = "switches";
        }

        // Get display name with (opp) if needed at action creation time
        const displayName = getPokemonDisplayName(ctx, ref);

        const action: ActionSummary = {
          type: "switch",
          actorRef: ref,
          actorName: displayName,
          actorSpecies: mon.species,
          actorIconId: mon.iconId,
          side,
          verb,
          details: switchDetails,
          fromIconId: isReplacement ? undefined : previousIconId,
          fromName: isReplacement ? undefined : previousName,
        };
        setCurrentAction(ctx, action);
        break;
      }
      case "move": {
        finalizePendingAbilityBoost(ctx); // Finalize any pending ability boost
        const { ref, nickname, side } = parsePokemonRef(parts[1]);
        const move = prettifyMove(parts[2]);
        const targetRaw = parts[3];
        let targetRefs: string[] | undefined;
        let targetSpecies: string[] | undefined;
        if (targetRaw) {
          const targetInfo = parsePokemonRef(targetRaw);
          const targetMon = ctx.pokemon.get(targetInfo.ref);
          targetRefs = [targetInfo.ref];
          targetSpecies = [targetMon?.species || targetInfo.nickname || targetInfo.ref];
        }
        const actor = getOrCreatePokemon(ctx, ref, side);
        if (nickname) actor.nickname = nickname;

        // Track recent moves for field start suppression
        ctx.recentMoves.push({ ref, move });

        // Get display names with (opp) if needed at action creation time
        const actorDisplayName = getPokemonDisplayName(ctx, ref);
        const targetDisplayNames = targetRefs?.map(tRef => getPokemonDisplayName(ctx, tRef));

        const action: ActionSummary = {
          type: "move",
          actorRef: ref,
          actorName: actorDisplayName,
          actorSpecies: actor.species,
          actorIconId: actor.iconId,
          side,
          verb: move,
          targetRefs,
          targetNames: targetDisplayNames,
          targetSpecies,
          details: [],
        };
        const extras = parseExtras(parts, 4);
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
        const mon = ctx.pokemon.get(ref) || getOrCreatePokemon(ctx, ref, resolveSide(ref));
        const hpRaw = parts[2];
        const hpStatus = parseHPStatus(hpRaw);
        const previous = mon.lastDisplayHP;
        const formatted = formatHPStatus(hpStatus);
        mon.lastDisplayHP = formatted;
        mon.status = hpStatus.status;
        mon.fainted = hpStatus.fainted;
        const extras = parseExtras(parts, 3).filter(Boolean);
        const isEOT = extras.some(isEndOfTurnSource);

        // Flush pending field ends before first EOT damage
        if (isEOT && ctx.pendingFieldEnds.length > 0) {
          flushPendingFieldEnds(ctx);
        }

        const change = previous && previous !== formatted ? `${previous} -> ${formatted}` : formatted;
        const segments = [change];
        if (extras.length) {
          segments.push(`(${extras.join('; ')})`);
        }
        const body = segments.join(' ');
        appendDetail(ctx, detailWithIcon(ctx, ref, body), isEOT);
        break;
      }
      case "-boost":
      case "-unboost": {
        const { ref } = parsePokemonRef(parts[1]);
        const stat = parts[2].toUpperCase();
        const amount = Number(parts[3]);
        const direction = tag === "-boost" ? "+" : "-";
        const extras = parseExtras(parts, 4).filter(Boolean);

        // Check if this boost belongs to a pending ability boost
        if (ctx.pendingAbilityBoost && !extras.length) {
          ctx.pendingAbilityBoost.boosts.push({ ref, stat, amount, direction });
          break;
        }

        // Check if this is a self-buff from the current action
        const isSelfBuff = ctx.currentAction?.type === "move" &&
          ctx.currentAction.actorRef === ref &&
          (!ctx.currentAction.targetNames?.length ||
           (ctx.currentAction.targetNames.length === 1 &&
            ctx.currentAction.actorName === ctx.currentAction.targetNames[0])) &&
          !extras.length;

        if (isSelfBuff) {
          // Inline format: "Pokemon Move, +X STAT"
          const currentVerb = ctx.currentAction!.verb;
          ctx.currentAction!.verb = `${currentVerb}, ${direction}${amount} ${stat}`;
        } else {
          // Standard format with icon
          const detail = `${direction}${amount} ${stat}${extras.length ? ` (${extras.join('; ')})` : ''}`;
          appendDetail(ctx, detailWithIcon(ctx, ref, detail));
        }
        break;
      }
      case "-status": {
        const { ref } = parsePokemonRef(parts[1]);
        const status = parts[2].toUpperCase();
        const extras = parseExtras(parts, 3);
        const detail = `${status}${formatExtras(extras)}`;
        const mon = ctx.pokemon.get(ref);
        if (mon) mon.status = status;

        // Check if this is an end-of-turn status (e.g., from Flame Orb)
        const isEOT = extras.some(isEndOfTurnSource);
        appendDetail(ctx, detailWithIcon(ctx, ref, detail), isEOT);
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
        const fourthParam = parts[3];

        // If this is a boost ability, start tracking to collect subsequent boosts
        if (fourthParam === 'boost') {
          finalizePendingAbilityBoost(ctx); // Finalize any previous pending boost
          ctx.pendingAbilityBoost = { ref, ability, boosts: [] };
        } else {
          // Regular ability announcement
          const mon = ctx.pokemon.get(ref);
          const pokemonName = mon?.nickname || mon?.species || ref;
          const extras = parseExtras(parts, 3).filter(Boolean);

          const possessive = pokemonName.endsWith('s') ? `${pokemonName}'` : `${pokemonName}'s`;
          const detail = extras.length ? `${possessive} ${ability} (${extras.join('; ')})` : `${possessive} ${ability}`;

          if (ctx.leadPhase || ctx.currentTurn.turn === 1 && ctx.currentTurn.actions.length === 0) {
            pushHeaderEvent(ctx, detail);
          } else {
            appendDetail(ctx, makeDetail(detail));
          }
        }
        break;
      }
      case "-item": {
        const { ref } = parsePokemonRef(parts[1]);
        const item = parts[2];
        const extras = parseExtras(parts, 3);
        appendDetail(ctx, detailWithIcon(ctx, ref, `Item gained: ${item}${formatExtras(extras)}`));
        break;
      }
      case "-enditem": {
        const { ref } = parsePokemonRef(parts[1]);
        const item = parts[2];
        const extras = parseExtras(parts, 3);
        appendDetail(ctx, detailWithIcon(ctx, ref, `Item lost: ${item}${formatExtras(extras)}`));
        break;
      }
      case "-fieldstart": {
        const source = parts[1];
        const fieldName = normalizeFieldName(source);

        // Check if from an ability
        if (parts[2] && parts[2].includes('[from] ability:')) {
          const abilityMatch = parts[2].match(/ability:\s*(.+)/);
          const ability = abilityMatch ? abilityMatch[1].trim() : '';

          if (ability && parts[3] && parts[3].includes('[of]')) {
            const ofMatch = parts[3].match(/\[of\]\s*(.+)/);
            const refRaw = ofMatch ? ofMatch[1].trim() : '';

            if (refRaw) {
              const { ref } = parsePokemonRef(refRaw);
              const mon = ctx.pokemon.get(ref);
              const pokemonName = mon?.nickname || mon?.species || refRaw;
              const possessive = pokemonName.endsWith('s') ? `${pokemonName}'` : `${pokemonName}'s`;

              // Check if the last action was a switch by this Pokemon
              if (ctx.currentAction?.type === 'switch' && ctx.currentAction.actorRef === ref) {
                // Merge into switch action verb
                ctx.currentAction.verb = `${ctx.currentAction.verb}; ${possessive} ${ability}; ${fieldName} starts`;
              } else {
                pushHeaderEvent(ctx, `${possessive} ${ability}; ${fieldName} starts`);
              }
              break;
            }
          }
        }

        // Check if implied by recent move (e.g., Trick Room move implies Trick Room field)
        const fieldId = toId(fieldName);
        const impliedByMove = ctx.recentMoves.some(m => toId(m.move) === fieldId);
        if (impliedByMove) {
          // Suppress - it's implied by the move
          break;
        }

        // Default format
        pushHeaderEvent(ctx, `${fieldName} starts`);
        break;
      }
      case "-fieldend": {
        const source = parts[1];
        const fieldName = normalizeFieldName(source);
        // Collect field ends to be shown together before end-of-turn damage
        ctx.pendingFieldEnds.push({ effect: fieldName });
        break;
      }
      case "-weather": {
        const weather = parts[1];
        const isUpkeep = parts[2] && parts[2].includes('upkeep');
        const normalizedWeather = normalizeWeatherName(weather);

        // Only announce weather changes, not upkeep
        if (weather === 'none') {
          if (ctx.currentWeather) {
            const currentNormalized = normalizeWeatherName(ctx.currentWeather);
            pushHeaderEvent(ctx, `${currentNormalized} ends`);
          }
          ctx.currentWeather = undefined;
        } else if (!isUpkeep) {
          if (weather !== ctx.currentWeather) {
            // Check if weather is from an ability
            let detail = `${normalizedWeather} starts`;
            let isSwitchAbility = false;

            if (parts[2] && parts[2].includes('[from] ability:')) {
              const abilityMatch = parts[2].match(/ability:\s*(.+)/);
              const ability = abilityMatch ? abilityMatch[1].trim() : '';
              if (ability && parts[3] && parts[3].includes('[of]')) {
                const ofMatch = parts[3].match(/\[of\]\s*(.+)/);
                const refRaw = ofMatch ? ofMatch[1].trim() : '';
                if (refRaw) {
                  const { ref } = parsePokemonRef(refRaw);
                  const mon = ctx.pokemon.get(ref);
                  const pokemonName = mon?.nickname || mon?.species || refRaw;
                  const possessive = pokemonName.endsWith('s') ? `${pokemonName}'` : `${pokemonName}'s`;

                  // Check if the last action was a switch by this Pokemon
                  if (ctx.currentAction?.type === 'switch' && ctx.currentAction.actorRef === ref) {
                    // Merge into switch action verb
                    ctx.currentAction.verb = `${ctx.currentAction.verb}; ${possessive} ${ability}; ${normalizedWeather} starts`;
                    isSwitchAbility = true;
                  } else {
                    detail = `${possessive} ${ability}; ${normalizedWeather} starts`;
                  }
                }
              }
            }

            // Only push as header event if not merged with switch
            if (!isSwitchAbility) {
              pushHeaderEvent(ctx, detail);
            }
            ctx.currentWeather = weather;
          }
        }
        break;
      }
      case "-sidestart": {
        const sideRef = resolveSide(parts[1]);
        const condition = parts[2];
        const conditionId = toId(condition);

        // Track side condition but don't announce it (only announce on expiration)
        ctx.sideConditions[sideRef].add(conditionId);
        break;
      }
      case "-sideend": {
        const sideRef = resolveSide(parts[1]);
        const condition = parts[2];
        const conditionId = toId(condition);

        // Only announce if was active
        if (ctx.sideConditions[sideRef].has(conditionId)) {
          pushHeaderEvent(ctx, `Side condition ended: ${sideRef} -> ${condition}`);
          ctx.sideConditions[sideRef].delete(conditionId);
        }
        break;
      }
      case "-terrain": {
        const terrain = parts[1];
        pushHeaderEvent(ctx, `Terrain: ${terrain}`);
        break;
      }
      case "-message": {
        const message = parts.slice(1).join(' ');
        if (/forfeited\.$/i.test(message)) {
          ctx.resultNote = 'Forfeit';
          const forfeiter = message.replace(/\s*forfeited\.$/i, '');
          if (!ctx.loser) ctx.loser = forfeiter;
        } else if (message && !/battle timer is on/i.test(message)) {
          appendDetail(ctx, message);
        }
        break;
      }
      case "-singleturn": {
        const { ref } = parsePokemonRef(parts[1]);
        const effect = parts[2];

        // Track Protect for display in action targets
        if (toId(effect).includes('protect') || effect.toLowerCase().includes('protect')) {
          ctx.pendingProtects.add(ref);
        }

        // Don't show effect if it's the same as the current move (e.g., Protect, Follow Me)
        // Normalize effect by removing "move: " prefix
        const normalizedEffect = effect.replace(/^move:\s*/i, '');
        const isSameAsCurrentMove = ctx.currentAction?.type === "move" &&
          toId(normalizedEffect) === toId(ctx.currentAction.verb);

        if (!isSameAsCurrentMove) {
          appendDetail(ctx, detailWithIcon(ctx, ref, effect));
        }
        break;
      }
      case "-activate": {
        const { ref } = parsePokemonRef(parts[1]);
        const effect = parts[2];

        // Special handling for Protect - append to target name in current action
        if (toId(effect).includes('protect') || effect.toLowerCase().includes('protect')) {
          if (ctx.currentAction && ctx.currentAction.targetRefs) {
            const targetIdx = ctx.currentAction.targetRefs.indexOf(ref);
            if (targetIdx !== -1 && ctx.currentAction.targetNames) {
              const currentName = ctx.currentAction.targetNames[targetIdx];
              if (currentName && !currentName.includes('(Protect)')) {
                ctx.currentAction.targetNames[targetIdx] = `${currentName} (Protect)`;
              }
            }
          }
          break;
        }

        const extras = parseExtras(parts, 3);
        const body = `Activates ${effect}${formatExtras(extras)}`;
        appendDetail(ctx, detailWithIcon(ctx, ref, body));
        break;
      }
      case "-fail": {
        const { ref } = parsePokemonRef(parts[1]);
        const reason = parseExtras(parts, 2).join('; ');
        const body = `Fails${reason ? ` (${reason})` : ''}`;
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
      case "-immune": {
        const { ref } = parsePokemonRef(parts[1]);

        // Append (immune) to target name in current action
        if (ctx.currentAction && ctx.currentAction.targetRefs) {
          const targetIdx = ctx.currentAction.targetRefs.indexOf(ref);
          if (targetIdx !== -1 && ctx.currentAction.targetNames) {
            const currentName = ctx.currentAction.targetNames[targetIdx];
            if (currentName && !currentName.includes('(immune)')) {
              ctx.currentAction.targetNames[targetIdx] = `${currentName} (immune)`;
            }
          }
        }
        break;
      }
      case "faint": {
        const { ref } = parsePokemonRef(parts[1]);
        const mon = ctx.pokemon.get(ref);
        if (mon) {
          mon.fainted = true;
          ctx.faintedThisTurn.add(ref);
        }
        // Don't append "faints" detail - it's redundant with "KO" in HP display
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
  }
}

function resolveLoser(ctx: ParseContext): string | undefined {
  if (!ctx.loser && !ctx.winner) return undefined;
  const p1Id = toId(ctx.players.p1);
  const p2Id = toId(ctx.players.p2);
  const loserId = ctx.loser ? toId(ctx.loser) : undefined;
  if (!loserId && ctx.winner) {
    const winnerId = toId(ctx.winner);
    return winnerId === p1Id ? ctx.players.p2 : ctx.players.p1;
  }
  return loserId === p1Id ? ctx.players.p1 : loserId === p2Id ? ctx.players.p2 : ctx.loser;
}

function renderSummary(ctx: ParseContext): DualFormat {
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const { p1, p2 } = ctx.players;
  const p1Id = toId(p1);
  const p2Id = toId(p2);
  const winnerId = ctx.winner ? toId(ctx.winner) : undefined;
  const loserId = ctx.loser ? toId(ctx.loser) : undefined;
  const inferredLoserId = !loserId && winnerId ? (winnerId === p1Id ? p2Id : p1Id) : loserId;
  const p1Tag = winnerId === p1Id ? "[W] " : inferredLoserId === p1Id ? "[L] " : "";
  const p2Tag = winnerId === p2Id ? "[W] " : inferredLoserId === p2Id ? "[L] " : "";
  const note = ctx.resultNote ? ` (${ctx.resultNote})` : "";
  const header = `<div><strong>${p1Tag}${p1}</strong> vs <strong>${p2Tag}${p2}</strong>${ctx.formatName ? ` — ${ctx.formatName}` : ""}${note}</div>`;
  htmlParts.push(header);
  textParts.push(`${p1Tag}${p1} vs ${p2Tag}${p2}${ctx.formatName ? ` — ${ctx.formatName}` : ""}${note}`);

  const teamLine = (side: "p1" | "p2"): DualFormat => {
    const names = ctx.teams[side];
    if (!names.length) return { html: "", text: "" };
    const html = names
      .map((species) => {
        const iconId = toIconId(species) || DEFAULT_ICON_ID;
        return iconHTML(iconId, species);
      })
      .join("");
    const text = names.join(" · ");
    return { html, text };
  };

  const p1Team = teamLine("p1");
  const p2Team = teamLine("p2");
  if (p1Team.html || p2Team.html) {
    htmlParts.push(`<div>${p1Team.html}&nbsp;&nbsp;vs&nbsp;&nbsp;${p2Team.html}</div>`);
    textParts.push(`${p1Team.text} vs ${p2Team.text}`);
  }

  // Extract lead entries from turn 0
  const leadTurn = ctx.turns.find(t => t.turn === 0);
  if (leadTurn && leadTurn.leadEntries.length > 0) {
    const p1Leads = leadTurn.leadEntries.filter(e => e.side === 'p1');
    const p2Leads = leadTurn.leadEntries.filter(e => e.side === 'p2');
    const p1LeadsHtml = p1Leads.map(e => e.html).join("");
    const p2LeadsHtml = p2Leads.map(e => e.html).join("");
    const p1LeadsText = p1Leads.map(e => e.text).join(", ");
    const p2LeadsText = p2Leads.map(e => e.text).join(", ");

    if (p1LeadsHtml || p2LeadsHtml) {
      htmlParts.push(`<div>${p1LeadsHtml}&nbsp;&nbsp;vs&nbsp;&nbsp;${p2LeadsHtml}</div>`);
      textParts.push(`${p1LeadsText} vs ${p2LeadsText}`);
    }

    // Extract initial field effects (headerEvents from turn 0)
    if (leadTurn.headerEvents.length > 0) {
      for (const event of leadTurn.headerEvents) {
        htmlParts.push(`<div>${event}</div>`);
        textParts.push(event);
      }
    }
  }

  // Render all turns (skip turn 0 as we've already handled it)
  for (const turn of ctx.turns) {
    if (turn.turn === 0) continue;
    if (turn.actions.length === 0 && turn.headerEvents.length === 0 && turn.leadEntries.length === 0) {
      continue;
    }
    const formatted = formatTurn(ctx, turn);
    htmlParts.push(...formatted.html);
    textParts.push(...formatted.text);
  }

  // Add winner declaration as final line
  if (ctx.winner) {
    textParts.push(`${ctx.winner} Wins`);
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
  return {
    html: rendered.html,
    text: rendered.text,
    meta: {
      id: data.id,
      format: ctx.formatName,
      players: ctx.players,
      winner: ctx.winner,
      loser: resolveLoser(ctx),
      resultNote: ctx.resultNote,
    },
  };
}

export async function summarizeReplay(url: string): Promise<SummarizedReplay> {
  if (!url) throw new Error("Replay URL is required.");
  const trimmedUrl = url.trim();
  const jsonUrl = trimmedUrl.endsWith(".json") ? trimmedUrl : `${trimmedUrl}.json`;
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
