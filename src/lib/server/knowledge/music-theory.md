# Music theory notes for the composer

You are writing a short ambient/downtempo piece that will actually be
synthesized by SuperCollider — not just read. Use this to make deliberate
harmonic and rhythmic choices instead of picking sounds at random.

## Mood → scale

Pick a scale/mode that matches the requested mood, then stay in it. In
Tidal, apply a scale to a numeric pattern with `scale`, e.g.
`n (scale "minor" "0 2 3 5 7") # sound "arpy"`.

| Mood                       | Scale                                | Why                                                             |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| melancholy, rain, longing  | `minor` / `aeolian`                  | flat 3rd/6th/7th read as wistful                                |
| hopeful-but-tired, liminal | `dorian`                             | minor with a raised 6th — less bleak than aeolian               |
| tense, uneasy, night-city  | `phrygian`                           | flat 2nd gives a claustrophobic edge                            |
| warm, nostalgic            | `major` / `ionian`, slowed and quiet | keep it soft (`gain 0.3-0.4`) so major doesn't read as cheerful |
| suspended, dreamlike       | `lydian`                             | raised 4th avoids a firm resolution                             |
| open, spacious             | pentatonic (`majPent` / `minPent`)   | fewer notes = more air between events                           |

Stay in one scale for the whole piece unless the request explicitly asks
for a shift or modulation.

## Tempo and cps

TidalCycles time is in cycles per second (`setcps`), not BPM directly.
Convert: `cps = bpm / 120` for a piece where one cycle = 2 beats (the
common convention here). A requested "slow, 60 BPM" piece is `setcps 0.5`;
a "mid-tempo, 96 BPM" piece is `setcps 0.8`.

Slower cps (0.3-0.5) reads as ambient/downtempo; 0.6-0.9 reads as a
relaxed groove; above 1.0 starts to feel upbeat — only go there if the
mood calls for energy.

## Chords and voicings

Write chords as simultaneous notes with `n` or `note` and stacked
patterns, or use `chord`/`arp` where available. Prefer close, low-register
voicings for pads (root + 3rd + 5th + optional 7th, e.g.
`n "0 4 7 11"` for a maj7 built on the scale degrees) and keep gain low
(`# gain 0.2-0.35`) so pads sit behind percussion instead of masking it.

Avoid dense clusters (seconds stacked against each other) unless the mood
is explicitly dissonant/uneasy — they read as mistakes otherwise.

## Arrangement conventions

- One low, slow-moving pad or drone (`slow 4` or slower) carrying the
  harmony.
- One sparse rhythmic layer (kick/snare/clap pattern) — leave rests (`~`)
  rather than filling every step; space reads as "calm," density reads as
  "busy."
- One texture/ear-candy layer at low gain (hats, glitch, foley) — this is
  where `#` effects like `room`, `size`, `cutoff`, and slow `sine`/`saw`
  LFOs on a control (e.g. `# cutoff (range 400 2000 $ slow 8 sine)`) do the
  most work.
- Reverb (`room`, `size`) pushed up (0.7-0.95) reads as spacious/lonely;
  pulled down (0.1-0.3) reads as close/intimate. Match it to the mood.
- Leave the first ~2-3 cycles sparser than the rest so the piece has a
  sense of arriving rather than starting at full density.

## Translating a mood description into a plan

Before writing code, decide explicitly (this reasoning doesn't need to
appear in the output, just drive it):

1. Scale/mode (from the table above, or your own judgement for moods not
   listed).
2. cps (from the requested tempo, or a sensible default for the mood if
   none was given — ambient/melancholy defaults to 0.4-0.6).
3. Which 2-4 layers (pad, rhythm, texture, occasional lead) the mood
   actually calls for — not every piece needs all four `d1`-`d4` slots
   full.
4. One or two effect choices (`room`/`size`, a slow filter sweep, `crush`
   for grit, etc.) that reinforce the mood rather than decorate it.

Then write the Tidal code (see the accompanying Tidal reference) to match
that plan.
