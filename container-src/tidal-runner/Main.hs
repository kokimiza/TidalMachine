-- Build-time placeholder. `docker build` compiles this once so the `tidal`
-- package and its dependency tree are already in the cabal store; every
-- real render overwrites this file (see src/lib/server/tidal-agent.ts,
-- which assembles the real Main.hs around the AI-generated pattern) and
-- rebuilds just this one small module.
{-# LANGUAGE OverloadedStrings #-}
module Main where

import Sound.Tidal.Context ()

main :: IO ()
main = putStrLn "tidal-runner placeholder"
