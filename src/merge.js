// Two saves made one: the server's and another app's (Herdr's shared.json), each earned on its
// own agents. Counts add up, sets join, and for a choice both made (a partner) `theirs` wins.
import { GAME, CAUGHT, PARTNERS, PROJECTS } from "./game.js";

const sumBy = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};
const union = (a = [], b = []) => [...new Set([...a, ...b])];

// Days add up field by field; recent turn lengths are joined.
function mergeStats(a, b) {
  if (!a && !b) return undefined;
  const days = { ...(a?.days ?? {}) };
  for (const [k, d] of Object.entries(b?.days ?? {})) days[k] = sumBy(days[k], d);
  return { days, lengths: [...(a?.lengths ?? []), ...(b?.lengths ?? [])].slice(-200) };
}

function mergeGame(a, b) {
  a ??= {}; b ??= {}; // Local fix: an app may send null for a key it never had.
  const sa = a.streak ?? { last: null, days: 0, best: 0 }, sb = b.streak ?? { last: null, days: 0, best: 0 };
  const later = (sb.last ?? "") > (sa.last ?? "") ? sb : sa;
  // The earlier of two entries for the same Pokemon is when it was really first caught.
  const dex = { ...(b.dex ?? {}) };
  for (const [id, e] of Object.entries(a.dex ?? {})) if (!dex[id] || e.at < dex[id].at) dex[id] = e;
  const recentLen = Math.max(a.recent?.length ?? 0, b.recent?.length ?? 0);
  return {
    ...b, ...a,
    xp: sumBy(a.xp, b.xp),
    // One party: ours if we have one; each Pokemon's XP and the trainer's lifetime XP add up.
    pokemon: sumBy(a.pokemon, b.pokemon),
    party: a.party?.length ? a.party : b.party ?? [],
    lifetime: (a.lifetime ?? 0) + (b.lifetime ?? 0),
    bank: (a.bank ?? 0) + (b.bank ?? 0),
    gifts: { got: union(a.gifts?.got, b.gifts?.got), pending: union(a.gifts?.pending, b.gifts?.pending) },
    results: {},
    seen: union(a.seen, b.seen),
    tasks: (a.tasks ?? 0) + (b.tasks ?? 0),
    subtasks: (a.subtasks ?? 0) + (b.subtasks ?? 0),
    evolutions: (a.evolutions ?? 0) + (b.evolutions ?? 0),
    streak: { ...later, best: Math.max(sa.best ?? 0, sb.best ?? 0) },
    badges: union(a.badges, b.badges),
    shiny: union(a.shiny, b.shiny),
    encounter: null,
    wild: [],
    happy: {},
    encounters: sumBy(a.encounters, b.encounters),
    recent: [...(a.recent ?? []), ...(b.recent ?? [])].sort((x, y) => y.at - x.at).slice(0, recentLen),
    dex,
    bag: sumBy(a.bag, b.bag),
    fainted: { ...(b.fainted ?? {}), ...(a.fainted ?? {}) },
    quests: a.quests ?? b.quests ?? null,
    // An unversioned save is version 1; the server upgrades the result after the merge.
    version: Math.max(a.version ?? 1, b.version ?? 1),
    stats: mergeStats(a.stats, b.stats),
  };
}

// `mine` and `theirs` hold the save keys (GAME, CAUGHT, PARTNERS, PROJECTS); returns the merged ones.
export function mergeSaves(mine, theirs) {
  return {
    [GAME]: mergeGame(mine[GAME], theirs[GAME]),
    [CAUGHT]: union(mine[CAUGHT], theirs[CAUGHT]).sort((x, y) => x - y),
    [PARTNERS]: { ...(mine[PARTNERS] ?? {}), ...(theirs[PARTNERS] ?? {}) },
    [PROJECTS]: { ...(mine[PROJECTS] ?? {}), ...(theirs[PROJECTS] ?? {}) },
  };
}
