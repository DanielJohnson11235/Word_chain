/*
  ui.js: the interface, the web version of main.py.

  This is the only file that touches the page. It reads what the
  player does, asks the Game what happened, and redraws the ladder.
  All the rules stay in game.js.
*/

(function () {
  "use strict";

  const WC = window.WordChain;

  const DIFFICULTY = {
    easy: [3, 4],
    medium: [5, 6],
    hard: [7, 9],
  };

  // ---- page elements ------------------------------------------------

  const el = {
    goal: document.getElementById("goal"),
    ladder: document.getElementById("ladder"),
    message: document.getElementById("message"),
    controls: document.getElementById("controls"),
    hintBtn: document.getElementById("hint-btn"),
    parBtn: document.getElementById("par-btn"),
    undoBtn: document.getElementById("undo-btn"),
    answerBtn: document.getElementById("answer-btn"),
    newBtn: document.getElementById("new-btn"),
    againBtn: document.getElementById("again-btn"),
    difficulty: document.getElementById("difficulty"),
    result: document.getElementById("result"),
    resultTitle: document.getElementById("result-title"),
    resultDetail: document.getElementById("result-detail"),
    resultSolution: document.getElementById("result-solution"),
  };

  // ---- setup (main.py: setup) ---------------------------------------

  const data = window.WORD_DATA;
  if (!data) {
    el.goal.textContent = "Couldn't find words.js. Run export_words.py, then reload.";
    return;
  }

  const allowed = new Set(data.allowed);
  const common = data.common;
  const graph = WC.buildGraph(data.allowed);

  let game = null;
  let gaveUp = false;
  let parShown = false; // par stays hidden until the player asks for it
  let freshIndex = -1; // which rung just appeared, for the drop-in animation

  // Remember the chosen difficulty between visits. Wrapped in try/catch
  // because some browsers block storage (private windows, etc).
  try {
    const saved = localStorage.getItem("wordchain-difficulty");
    if (saved && DIFFICULTY[saved]) el.difficulty.value = saved;
  } catch (e) { /* fine, just use the default */ }

  // ---- helpers ------------------------------------------------------

  function isOver() {
    return game.isWon() || gaveUp;
  }

  function upper(words) {
    return words.map((w) => w.toUpperCase()).join(" → ");
  }

  function setMessage(text, kind) {
    el.message.textContent = text || "";
    el.message.className = "message" + (kind ? " " + kind : "");
  }

  function makeTile(letter, classes) {
    const t = document.createElement("span");
    t.className = "tile" + (classes ? " " + classes : "");
    t.textContent = letter || "";
    return t;
  }

  function makeRung(classes) {
    const li = document.createElement("li");
    li.className = "rung" + (classes ? " " + classes : "");
    return li;
  }

  // ---- drawing (main.py: show_state) --------------------------------

  function render() {
    const { target, par, moves } = game;
    const current = game.current;
    // After "Show answer", the ladder shows the solution instead of your moves
    const history = gaveUp ? game.puzzle.solution : game.history;
    const reached = game.isWon() || gaveUp;
    el.ladder.innerHTML = "";

    // 1. every word played so far. Letters already in the right spot for
    //    the target light up gold; the letter changed on that step gets a
    //    blue outline.
    history.forEach((word, i) => {
      if (reached && i === history.length - 1) return; // drawn as the target below
      const classes = [];
      if (i === history.length - 1) classes.push("current");
      if (i === freshIndex) classes.push("fresh");
      const rung = makeRung(classes.join(" "));
      rung.setAttribute("aria-label", word);
      const changed = i > 0 ? WC.changedIndex(history[i - 1], word) : -1;
      for (let j = 0; j < word.length; j++) {
        const tileClasses = [];
        if (word[j] === target[j]) tileClasses.push("matched");
        if (j === changed) tileClasses.push("changed");
        rung.appendChild(makeTile(word[j], tileClasses.join(" ")));
      }
      el.ladder.appendChild(rung);
    });

    if (!isOver()) {
      // 2. the rung you type into
      const entry = makeRung("entry");
      for (let j = 0; j < 4; j++) entry.appendChild(makeTile("", j === 0 ? "cursor" : ""));
      const input = document.createElement("input");
      input.className = "entry-input";
      input.type = "text";
      input.maxLength = 4;
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("autocorrect", "off");
      input.setAttribute("enterkeyhint", "go");
      input.setAttribute("aria-label", `Next word after ${current}`);
      input.addEventListener("input", onType);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          // Stop this Enter from also "clicking" the Play again button,
          // which gets focus the moment you win.
          e.preventDefault();
          submit(input);
        }
      });
      entry.appendChild(input);
      el.ladder.appendChild(entry);

      // 3. dashed rungs: moves left before going over par (only once par is shown)
      const slots = parShown ? Math.max(0, par - moves - 1) : 0;
      for (let s = 0; s < slots; s++) {
        const rung = makeRung("slot");
        rung.setAttribute("aria-hidden", "true");
        for (let j = 0; j < 4; j++) rung.appendChild(makeTile(""));
        el.ladder.appendChild(rung);
      }
    }

    // 4. the target at the bottom
    const targetRung = makeRung("target" + (reached ? " reached" : ""));
    targetRung.setAttribute("aria-label", `Target: ${target}`);
    const lastChanged = reached ? WC.changedIndex(history[history.length - 2], target) : -1;
    for (let j = 0; j < target.length; j++) {
      targetRung.appendChild(makeTile(target[j], j === lastChanged ? "changed" : ""));
    }
    el.ladder.appendChild(targetRung);

    // goal line, buttons, and result panel
    el.goal.innerHTML =
      `Get from <strong>${game.start.toUpperCase()}</strong> to ` +
      `<strong>${target.toUpperCase()}</strong>.` +
      (parShown ? ` Par is ${par}.` : "");

    el.controls.hidden = isOver();
    el.undoBtn.disabled = moves === 0;
    el.parBtn.hidden = parShown;
    el.result.hidden = !isOver();
    if (isOver()) showResult();

    freshIndex = -1;
    focusEntry();
  }

  function focusEntry() {
    const input = el.ladder.querySelector(".entry-input");
    if (input) input.focus({ preventScroll: true });
  }

  // mirror what's typed into the four entry tiles
  function onType(e) {
    const input = e.target;
    const clean = input.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 4);
    if (clean !== input.value) input.value = clean;

    const tiles = input.parentElement.querySelectorAll(".tile");
    tiles.forEach((t, j) => {
      t.textContent = clean[j] || "";
      t.classList.toggle("filled", Boolean(clean[j]));
      t.classList.toggle("cursor", j === clean.length);
    });
    setMessage("");
  }

  // ---- actions (main.py: play_round) --------------------------------

  function submit(input) {
    const guess = input.value;
    const result = game.makeMove(guess);

    if (result === WC.OK) {
      freshIndex = game.history.length - 1;
      setMessage("");
      render();
      return;
    }

    setMessage(WC.MESSAGES[result], "error");
    const rung = input.parentElement;
    rung.classList.remove("shake");
    void rung.offsetWidth; // restart the animation
    rung.classList.add("shake");
    input.select();
  }

  function showResult() {
    const { moves, par, puzzle } = game;
    if (gaveUp) {
      el.resultTitle.textContent = "Here's a shortest route";
      el.resultDetail.textContent = `${par} moves from ${puzzle.start.toUpperCase()} to ${puzzle.end.toUpperCase()}.`;
      el.resultSolution.textContent = "";
    } else if (moves <= par) {
      el.resultTitle.textContent = `Solved in ${moves} moves`;
      el.resultDetail.textContent = "You matched par.";
      el.resultSolution.textContent = "";
    } else {
      el.resultTitle.textContent = `Solved in ${moves} moves`;
      el.resultDetail.textContent = `Par was ${par}. A shortest route:`;
      el.resultSolution.textContent = upper(puzzle.solution);
    }
    el.againBtn.focus({ preventScroll: true });
  }

  function newPuzzle() {
    const [lo, hi] = DIFFICULTY[el.difficulty.value] || DIFFICULTY.medium;
    const puzzle = WC.makePuzzle(graph, common, lo, hi);
    game = new WC.Game(puzzle, allowed, graph);
    gaveUp = false;
    parShown = false;
    setMessage("");
    render();
  }

  // ---- buttons --------------------------------------------------------

  el.hintBtn.addEventListener("click", () => {
    const h = game.hint();
    setMessage(h ? `Try ${h.toUpperCase()}.` : "No hint available.", "hint");
    focusEntry();
  });

  el.parBtn.addEventListener("click", () => {
    parShown = true;
    setMessage("");
    render();
  });

  el.undoBtn.addEventListener("click", () => {
    if (!game.undo()) setMessage("Nothing to undo.", "error");
    else setMessage("");
    render();
  });

  el.answerBtn.addEventListener("click", () => {
    gaveUp = true;
    setMessage("");
    render();
  });

  el.newBtn.addEventListener("click", newPuzzle);
  el.againBtn.addEventListener("click", newPuzzle);

  el.difficulty.addEventListener("change", () => {
    try { localStorage.setItem("wordchain-difficulty", el.difficulty.value); } catch (e) {}
    newPuzzle();
  });

  // clicking anywhere on the ladder puts the cursor back in the entry rung
  el.ladder.addEventListener("click", focusEntry);

  newPuzzle();
})();
