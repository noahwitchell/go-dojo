# Go Dojo — notes for Claude

- Owner: Noah. Phone Go practice tool: Play (MCTS computer, 9/13/19, handicap, coach), Drills, Capture Go, Learn.
- Look = Coffea Arabica house style (~/Claude/Coffea): flat paper + ink, DM Serif Display, 1.5px ink outlines, pill buttons, no gradients/shadows/blur, light-only. Stones flat: solid top + offset solid side face.
- Edit `index.src.html`, `engine.js`, `problems.js`; then `python3 build.py` (writes `index.html` for Pages and `artifact.html` for the claude.ai artifact https://claude.ai/artifact/NpURz6NPeAyMdJ5vQhc8zx — republish with that `url`).
- Drills: you always play Black; `node verify.js` must show the intended answers before shipping a new drill.
- Public repo github.com/noahwitchell/go-dojo, GitHub Pages from main (push = deploy). Bump CACHE in sw.js when shipping.
