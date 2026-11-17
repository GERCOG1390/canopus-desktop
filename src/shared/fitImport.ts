// Many fits at once, for moving over from Pyfa or the game: several EFT blocks pasted together, or the EVE XML
// fittings file (what Pyfa's "Export fittings" and the game's fitting window write). XML fits are turned into
// EFT text, so one parser reads both.

/** Splits pasted text into one EFT block per fit: each starts at a "[Ship, Name]" line. */
export function splitEft(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const blocks: string[][] = []
  for (const line of lines) {
    const t = line.trim()
    if (/^\[[^\]]+,[^\]]*\]$/.test(t) && !/^\[empty .+ slot\]$/i.test(t)) blocks.push([t])
    else if (blocks.length) blocks[blocks.length - 1].push(line)
  }
  return blocks.map((b) => b.join('\n').trim())
}

export interface XmlFit {
  name: string
  ship: string
  hardware: { slot: string; type: string; qty: number }[]
}

const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unescape(m[2])
  return out
}

export const isFittingXml = (text: string): boolean => /<fittings[\s>]/i.test(text)

export function parseFittingXml(xml: string): XmlFit[] {
  const fits: XmlFit[] = []
  for (const m of xml.matchAll(/<fitting\b([^>]*)>([\s\S]*?)<\/fitting>/gi)) {
    const ship = /<shipType\b([^>]*)\/?>/i.exec(m[2])
    const hardware = [...m[2].matchAll(/<hardware\b([^>]*)\/?>/gi)].map((h) => {
      const a = attrs(h[1])
      return { slot: (a.slot ?? '').toLowerCase(), type: a.type ?? '', qty: Math.max(1, Number(a.qty) || 1) }
    })
    fits.push({ name: attrs(m[1]).name ?? '', ship: ship ? (attrs(ship[1]).value ?? '') : '', hardware: hardware.filter((h) => h.type) })
  }
  return fits.filter((f) => f.ship)
}

/** The EVE XML slot names in the order EFT lists them: low, mid, high, rigs, subsystems, then drones and cargo. */
const ORDER = ['low slot', 'med slot', 'hi slot', 'rig slot', 'subsystem slot']

export function xmlFitToEft(f: XmlFit): string {
  const index = (slot: string) => Number(/(\d+)\s*$/.exec(slot)?.[1] ?? 0)
  const section = (kind: string) =>
    f.hardware
      .filter((h) => h.slot.startsWith(kind))
      .sort((a, b) => index(a.slot) - index(b.slot))
      .map((h) => h.type)
  const extra = (kind: string) => f.hardware.filter((h) => h.slot === kind).map((h) => `${h.type} x${h.qty}`)
  const parts = [...ORDER.map(section), extra('drone bay'), extra('fighter bay'), extra('cargo')].filter((p) => p.length)
  return [`[${f.ship}, ${f.name || f.ship}]`, ...parts.map((p) => p.join('\n'))].join('\n\n')
}

/** Whatever was pasted or opened, as EFT blocks. */
export function toEftBlocks(text: string): string[] {
  return isFittingXml(text) ? parseFittingXml(text).map(xmlFitToEft) : splitEft(text)
}

/**
 * The EVE XML fittings file lists charges only as cargo: each module that takes charges and has none gets the
 * first cargo item it can load (charges already set are kept).
 */
export function loadFromCargo<M extends { typeId: number; chargeTypeId?: number }>(
  modules: M[],
  cargo: { typeId: number; qty: number }[],
  chargesFor: (moduleTypeId: number) => number[]
): M[] {
  return modules.map((m) => {
    if (m.chargeTypeId) return m
    const allowed = new Set(chargesFor(m.typeId))
    const pick = cargo.find((c) => allowed.has(c.typeId))
    return pick ? { ...m, chargeTypeId: pick.typeId } : m
  })
}

export interface EftMutation {
  ref: number
  /** The module it was made from */
  base: string
  mutaplasmid?: string
  /** Rolled attribute values by dogma attribute name */
  attrs: Record<string, number>
}

/**
 * Pyfa writes a mutated (abyssal) module as "Name [1]" in its slot and, after the fit, a block per mutation:
 * "[1] Base module", the mutaplasmid, then "attribute value, attribute value". Takes the blocks out of the text.
 */
export function splitMutations(text: string): { body: string; mutations: Map<number, EftMutation> } {
  const lines = text.split(/\r?\n/)
  const mutations = new Map<number, EftMutation>()
  const keep: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = /^\s*\[(\d+)\]\s+(.+?)\s*$/.exec(lines[i])
    if (!head) {
      keep.push(lines[i])
      continue
    }
    const m: EftMutation = { ref: Number(head[1]), base: head[2], attrs: {} }
    const next = lines[i + 1]?.trim()
    if (next && !/^\[/.test(next) && !/\d\s*(,|$)/.test(next)) {
      m.mutaplasmid = next
      i++
    }
    const values = lines[i + 1]?.trim()
    if (values && /^[A-Za-z]\w*\s+-?[\d.]+/.test(values)) {
      for (const part of values.split(',')) {
        const kv = /^\s*([A-Za-z]\w*)\s+(-?[\d.]+(?:e-?\d+)?)\s*$/.exec(part)
        if (kv) m.attrs[kv[1]] = Number(kv[2])
      }
      i++
    }
    mutations.set(m.ref, m)
  }
  return { body: keep.join('\n'), mutations }
}

/** "Stasis Webifier II [1]" → the name and the mutation it refers to; null for an ordinary module line. */
export function mutationRef(namePart: string): { name: string; ref: number } | null {
  const m = /^(.+?)\s*\[(\d+)\]\s*$/.exec(namePart.trim())
  return m ? { name: m[1], ref: Number(m[2]) } : null
}
