# TidalCycles reference

Your output is real Haskell, executed by an actual TidalCycles + SuperDirt
engine — not a mockup. It must be syntactically valid and only reference
sounds that exist. Write **only** Tidal pattern code, in the same style as
`BootTidal.hs`: one or more top-level actions using `d1`-`d4`, `setcps`,
etc. No module header, no `import`, no explanation, no markdown fences.

## Mini-notation

- `"bd sn bd sn"` — four evenly-spaced events per cycle.
- `"bd ~ sn ~"` — `~` is a rest.
- `"bd*2 sn"` — `*n` repeats an event n times within its slot.
- `"bd/2"` — plays once every 2 cycles.
- `"<bd sn cp>"` — angle brackets pick a different one each cycle.
- `"[bd sn]"` — square brackets group events into one slot.
- `"bd(3,8)"` — Euclidean rhythm: 3 hits spread over 8 steps.
- `"0 2 5 7"` inside `n` — scale degrees / MIDI-ish note numbers, not sound
  names.

## Core functions

- `sound "bd sn"` (or the shorthand `s "bd sn"`) — trigger samples by name.
- `n "0 2 4"` — pick a sample index within a bank, or (combined with
  `scale`) a pitch.
- `note "0 4 7"` / `up "0 4 7"` — transpose in semitones.
- `scale "minor" (n "0 2 3 5")` — map scale degrees onto a named scale.
- `#` — combine a pattern with a control, e.g. `sound "bd" # room 0.8`.
- `room`, `size` — reverb send / size.
- `gain` — loudness (keep pads/textures well under 0.5 so they sit behind
  percussion).
- `pan` — stereo position, 0-1.
- `cutoff`, `resonance` — filter controls; animate with `range lo hi $ slow n sine`.
- `crush` — bitcrush for grit/texture.
- `slow n` / `fast n` — stretch or compress a pattern in time.
- `every n f` — apply transformation `f` only every n cycles, for variation.
- `jux f` — play the pattern normally on one channel and `f`-transformed
  on the other (e.g. `jux rev`).
- `off t f` — layer a time-shifted, transformed copy on top (e.g.
  `off 0.125 (# crush 4)` for a subtle echo).
- `setcps n` — set the global tempo (cycles per second); see the music
  theory notes for converting a requested BPM.
- `hush` — silence everything (rarely needed in a single rendered piece,
  but valid if you want a deliberate pause).

## Available sound banks

Only the sample banks below are guaranteed loaded. Using anything else
will fail at render time and fall back to a plain synth bounce, so stay
within this list unless the request specifically needs something else.

**Percussion / drums**: `bd`, `sn`, `sd`, `cp`, `hh`, `hc`, `perc`,
`clubkick`, `popkick`, `tabla`, `tabla2`, `industrial`

**Bass**: `bass`, `bass1`, `bass2`, `jvbass`, `bassdm`, `moog`

**Pads / atmosphere / texture**: `feel`, `feelfx`, `glitch`, `glitch2`,
`space`, `bubble`, `wind`, `insect`, `birds3`

**Melodic / tonal**: `arpy`, `notes`, `newnotes`, `sitar`, `casio`, `koy`,
`peri`, `stab`, `diphone2`

**Voice / found sound**: `speech`, `speechless`, `mouth`, `click`, `tink`

## A worked example

Slow, melancholy, ~60 BPM:

```
setcps 0.5

d1 $ slow 4 $ n (scale "minor" "0 2 3 5 7") # sound "feel"
  # room 0.85 # size 0.9 # gain 0.3

d2 $ sound "bd(3,8) ~ sn(2,8)" # gain 0.4 # room 0.3

d3 $ slow 2 $ sound "hh*4" # gain 0.15
  # cutoff (range 600 2200 $ slow 6 sine)
```

Notice: one slow pad carrying the harmony, one sparse Euclidean rhythm
layer, one quiet textural layer with a moving filter — not every slot
(`d1`-`d4`) needs to be used, and gain stays low on anything that isn't
the rhythmic anchor.
