/*
  game.js: the game logic, ported from the Python version.

  This file never touches the page (no document, no DOM). It is the
  JavaScript twin of words.py, graph.py, puzzle.py, and game.py, and
  ui.js is the twin of main.py.

  Everything is attached to a single global object, WordChain, so the
  page works when opened straight from your computer as well as on
  GitHub Pages. (ES modules with import/export don't load from file://.)
*/

(function (global) {
  "use strict";

  // ------------------------------------------------------------------
  // Result codes and messages (game.py)
  // ------------------------------------------------------------------

  const OK = "ok";
  const WRONG_LENGTH = "wrong_length";
  const NOT_A_WORD = "not_a_word";
  const SAME_WORD = "same_word";
  const TOO_MANY_CHANGES = "too_many_changes";
  const GAME_OVER = "game_over";

  const MESSAGES = {
    [OK]: "Nice.",
    [WRONG_LENGTH]: "Words must be 4 letters.",
    [NOT_A_WORD]: "That's not in the word list.",
    [SAME_WORD]: "You need to change a letter.",
    [TOO_MANY_CHANGES]: "Change exactly one letter at a time.",
    [GAME_OVER]: "You've already solved this one!",
  };

  // ------------------------------------------------------------------
  // Graph helpers (graph.py)
  // ------------------------------------------------------------------

  // Python: len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1
  function differsByOne(a, b) {
    if (a.length !== b.length) return false;
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs++;
    }
    return diffs === 1;
  }

  // Which position changed between two neighbors, or -1. Used by the UI
  // to highlight the changed letter on each rung.
  function changedIndex(a, b) {
    if (!a || !b || a.length !== b.length) return -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return i;
    }
    return -1;
  }

  // Python: [word[:i] + "_" + word[i+1:] for i in range(len(word))]
  function wildcardPatterns(word) {
    const out = [];
    for (let i = 0; i < word.length; i++) {
      out.push(word.slice(0, i) + "_" + word.slice(i + 1));
    }
    return out;
  }

  // Returns a Map of word -> Set of neighbor words.
  // Python dict -> JS Map, Python set -> JS Set.
  function buildGraph(words) {
    const buckets = new Map();
    for (const word of words) {
      for (const pattern of wildcardPatterns(word)) {
        if (!buckets.has(pattern)) buckets.set(pattern, []); // no defaultdict in JS
        buckets.get(pattern).push(word);
      }
    }

    const graph = new Map();
    for (const word of words) graph.set(word, new Set());

    for (const bucket of buckets.values()) {
      for (const a of bucket) {
        for (const b of bucket) {
          if (a !== b) graph.get(a).add(b);
        }
      }
    }
    return graph;
  }

  // Breadth-first search. Returns an array of words, or null.
  // The queue is a plain array with a "head" index instead of a deque:
  // reading queue[head++] is fast, while queue.shift() is slow like
  // Python's list.pop(0).
  function shortestPath(graph, start, end) {
    if (!graph.has(start) || !graph.has(end)) return null;

    const parents = new Map([[start, null]]);
    const queue = [start];
    let head = 0;

    while (head < queue.length) {
      let word = queue[head++];

      if (word === end) {
        const path = [];
        while (word !== null) {
          path.push(word);
          word = parents.get(word);
        }
        return path.reverse();
      }

      for (const neighbor of graph.get(word)) {
        if (!parents.has(neighbor)) {
          parents.set(neighbor, word);
          queue.push(neighbor);
        }
      }
    }
    return null;
  }

  // Same loop, but records how many moves away every word is.
  function distancesFrom(graph, start) {
    const distance = new Map();
    if (!graph.has(start)) return distance;

    distance.set(start, 0);
    const queue = [start];
    let head = 0;

    while (head < queue.length) {
      const word = queue[head++];
      for (const neighbor of graph.get(word)) {
        if (!distance.has(neighbor)) {
          distance.set(neighbor, distance.get(word) + 1);
          queue.push(neighbor);
        }
      }
    }
    return distance;
  }

  // ------------------------------------------------------------------
  // Randomness and puzzles (puzzle.py)
  // ------------------------------------------------------------------

  // JavaScript's Math.random can't be seeded, so this is a tiny seeded
  // generator (mulberry32). Same seed, same sequence, just like
  // random.Random(seed) in Python. Handy for a daily puzzle later.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Python: rng.choice(seq)
  function choice(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function makePuzzle(graph, commonWords, minSteps = 4, maxSteps = 7, rng = Math.random, maxTries = 2000) {
    const pool = [...commonWords].filter((w) => graph.has(w)).sort();
    if (pool.length < 2) {
      throw new Error("Need at least 2 common words that are in the graph.");
    }

    for (let i = 0; i < maxTries; i++) {
      const start = choice(rng, pool);
      const dist = distancesFrom(graph, start);

      const candidates = pool.filter((w) => {
        const d = dist.has(w) ? dist.get(w) : -1;
        return d >= minSteps && d <= maxSteps;
      });
      if (candidates.length === 0) continue;

      const end = choice(rng, candidates);
      const solution = shortestPath(graph, start, end);
      return { start, end, par: solution.length - 1, solution };
    }

    throw new Error(
      `Couldn't find a puzzle between ${minSteps} and ${maxSteps} moves after ${maxTries} tries.`
    );
  }

  // ------------------------------------------------------------------
  // Game state (game.py)
  // ------------------------------------------------------------------

  class Game {
    constructor(puzzle, validWords, graph) {
      this.puzzle = puzzle;
      this.start = puzzle.start;
      this.target = puzzle.end;
      this.par = puzzle.par;
      this.validWords = validWords; // a Set
      this.graph = graph;
      this.history = [puzzle.start];
    }

    // "get" is JavaScript's version of @property
    get current() {
      return this.history[this.history.length - 1];
    }

    get moves() {
      return this.history.length - 1;
    }

    isWon() {
      return this.current === this.target;
    }

    checkMove(guess) {
      guess = guess.trim().toLowerCase();

      if (this.isWon()) return GAME_OVER;
      if (guess.length !== this.current.length) return WRONG_LENGTH;
      if (guess === this.current) return SAME_WORD;
      if (!differsByOne(guess, this.current)) return TOO_MANY_CHANGES;
      if (!this.validWords.has(guess)) return NOT_A_WORD;
      return OK;
    }

    makeMove(guess) {
      const result = this.checkMove(guess);
      if (result === OK) this.history.push(guess.trim().toLowerCase());
      return result;
    }

    undo() {
      if (this.history.length <= 1) return false;
      this.history.pop();
      return true;
    }

    hint() {
      if (this.isWon()) return null;
      const path = shortestPath(this.graph, this.current, this.target);
      return path ? path[1] : null;
    }
  }

  global.WordChain = {
    OK, WRONG_LENGTH, NOT_A_WORD, SAME_WORD, TOO_MANY_CHANGES, GAME_OVER, MESSAGES,
    differsByOne, changedIndex, wildcardPatterns, buildGraph, shortestPath,
    distancesFrom, seededRandom, makePuzzle, Game,
  };
})(typeof window !== "undefined" ? window : globalThis);
