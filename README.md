# Go Dojo

A phone practice tool for the game of Go. Play a coached computer opponent on 9×9, 13×13 or 19×19 (with handicap), solve trapping and life-and-death drills that are checked by actually reading the position out, and play Capture Go (first capture wins).

Play: https://noahwitchell.github.io/go-dojo/ (on iPhone: Share → Add to Home Screen).

- `engine.js`: rules, MCTS computer opponent, tactical and life-and-death solver
- `problems.js`: the drills
- `index.src.html`: the app
- `python3 build.py` builds `index.html` (this site) and `artifact.html`
- `node verify.js` re-checks every drill and lists the moves that work
- Bump `CACHE` in `sw.js` when shipping.
