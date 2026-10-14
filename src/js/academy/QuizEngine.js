/*
* QuizEngine - question generators, answer checking and spaced repetition for the Academy.
*
* Pure logic with no DOM, so it runs in the browser and in Node tests. Every question is built in two steps:
*   makeParams(rng, pool, level)  ->  a small JSON object describing the scenario
*   build(params, pool)           ->  the full question (prompt, input, answer, explanation)
* Keeping the params means a missed question can be replayed exactly later (see Progress).
*
* Question shape:
*   { type, category, key, params, level, prompt, facts, input, answer, explain, visual }
*   input: {kind: "number", unit} | {kind: "choice", options: [{id, label}]} | {kind: "multi", options: [...]}
*   answer: number | option id | array of option ids (multi). For choice, `accept` may list extra valid ids.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('./TurnMath.js'));
	} else {
		root.QuizEngine = factory(root.TurnMath);
	}
}(typeof self !== 'undefined' ? self : this, function (TurnMath) {

	var CATEGORIES = {
		count: { label: "Fast Move counting", blurb: "How many Fast Moves to a Charged Move, and how many turns that takes." },
		history: { label: "Opponent energy", blurb: "Track an opponent's energy from what you've watched them do." },
		timing: { label: "Throw timing", blurb: "Find the turns where throwing grants no free turns." },
		swap: { label: "Stay or swap", blurb: "Read a lead matchup and decide, with ABA, ABB and ABC team shapes." }
	};

	// ---------- Randomness ----------

	// Small seedable generator so tests and replays are repeatable
	function createRng(seed) {
		var state = (seed === undefined ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;

		function next() {
			state = (state + 0x6D2B79F5) >>> 0;
			var t = state;

			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		}

		return {
			next: next,
			int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
			pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
			chance: function (p) { return next() < p; },
			shuffle: function (arr) {
				var copy = arr.slice();

				for (var i = copy.length - 1; i > 0; i--) {
					var j = Math.floor(next() * (i + 1));
					var tmp = copy[i];

					copy[i] = copy[j];
					copy[j] = tmp;
				}

				return copy;
			}
		};
	}

	// ---------- Pokemon pool ----------

	/*
	* Build the quiz pool from gamemaster data and ranking data.
	* Each entry: {id, name, fast: {id, name, gain, turns}, charged: [{id, name, energy}], score}
	* Only entries with a Fast Move and at least one Charged Move are kept.
	*
	* The pool is the top `limit` of the ranking, plus up to `megaExtra` Mega Pokemon from further down (within the first
	* `megaScan`). Megas rarely rank in the top of the Great and Ultra Mega cups, so without this they would barely appear.
	* Megas with a third Charged Move keep all three in `charged`.
	*/
	// Does one cup exclusion filter ban this Pokemon? Only the filter kinds the borrowed-ranking cups use are understood.
	function excludedBy(filter, speciesId, info) {
		var id = speciesId.replace("_shadow", "").replace("_xs", "");

		switch (filter.filterType) {
			case "id":
				return filter.values.indexOf(id) > -1 || filter.values.indexOf(speciesId) > -1;
			case "tag":
				return filter.values.some(function (t) { return (info.tags || []).indexOf(t) > -1; });
			case "type":
				return filter.values.some(function (t) { return (info.types || []).indexOf(t) > -1; });
			default:
				throw new Error("buildPool cannot apply a cup filter of type " + filter.filterType);
		}
	}

	function buildPool(gmData, rankings, limit, opts) {
		opts = opts || {};

		var megaExtra = opts.megaExtra === undefined ? 10 : opts.megaExtra;
		var banned = opts.exclude || []; // A cup's own exclusion rules, for cups that borrow another cup's ranking
		var megaScan = opts.megaScan || 250;
		var moves = {};
		var species = {};

		gmData.moves.forEach(function (m) { moves[m.moveId] = m; });
		gmData.pokemon.forEach(function (p) { species[p.speciesId] = p; });

		var pool = [];

		var cutoff = limit || 80;
		var extraLeft = megaExtra;
		var chosen = (rankings || []).slice(0, megaScan).filter(function (r, i) {
			if (i < cutoff) {
				return true;
			}

			var info = species[r.speciesId];

			if (extraLeft > 0 && info && (info.tags || []).indexOf("mega") > -1) {
				extraLeft--;
				return true;
			}

			return false;
		});

		chosen.forEach(function (r) {
			var info = species[r.speciesId];

			if (info && banned.some(function (f) { return excludedBy(f, r.speciesId, info); })) {
				return;
			}

			var set = r.moveset || [];
			var fast = moves[set[0]];

			if (!info || !fast || !(fast.energyGain > 0)) {
				return;
			}

			var charged = set.slice(1).map(function (id) { return moves[id]; }).filter(function (m) { return m && m.energy > 0; });

			if (charged.length === 0) {
				return;
			}

			pool.push({
				id: r.speciesId,
				dex: info.dex,
				name: r.speciesName,
				types: info.types,
				mega: (info.tags || []).indexOf("mega") > -1,
				score: r.score,
				fast: { id: fast.moveId, name: fast.name, gain: fast.energyGain, turns: fast.turns },
				charged: charged.map(function (m) { return { id: m.moveId, name: m.name, energy: m.energy }; })
			});
		});

		pool.byId = {};
		pool.forEach(function (p) { pool.byId[p.id] = p; });

		return pool;
	}

	function chargedById(mon, id) {
		return mon.charged.filter(function (m) { return m.id === id; })[0];
	}

	function plural(n, word) {
		return n + " " + word + (n === 1 ? "" : "s");
	}

	function fastLabel(mon) {
		return mon.fast.name + " (+" + mon.fast.gain + " energy, " + plural(mon.fast.turns, "turn") + ")";
	}

	// For use inside parentheses, where fastLabel's own brackets would nest
	function fastInline(mon) {
		return mon.fast.name + ": +" + mon.fast.gain + " energy, " + plural(mon.fast.turns, "turn");
	}

	function numberInput(unit, max) {
		return { kind: "number", unit: unit, min: 0, max: max || 99 };
	}

	function monFacts(mon) {
		return [[mon.name, mon.fast.name + " +" + mon.fast.gain + ", " + plural(mon.fast.turns, "turn")]]
			.concat(mon.charged.map(function (m) { return [m.name, m.energy + " energy"]; }));
	}

	// ---------- Generators ----------

	var GENERATORS = {};

	function register(type, def) {
		def.type = type;
		GENERATORS[type] = def;
	}

	// --- Counting ---

	register("count.toCharged", {
		category: "count",
		minLevel: 1,
		makeParams: function (rng, pool, level) {
			var mon = rng.pick(pool);
			var move = rng.pick(mon.charged);
			var energy = 0;

			if (level >= 2) {
				energy = rng.int(1, move.energy - 1);
			}

			return { mon: mon.id, move: move.id, energy: energy };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var move = chargedById(mon, p.move);
			var n = TurnMath.fastMovesToReach(p.energy, move.energy, mon.fast.gain);
			var start = p.energy ? " It already has " + p.energy + " energy." : " It starts at 0 energy.";

			return {
				prompt: mon.name + " uses " + fastLabel(mon) + "." + start + " How many Fast Moves until it can throw " + move.name + " (" + move.energy + " energy)?",
				input: numberInput("Fast Moves"),
				answer: n,
				explain: "You need " + (move.energy - p.energy) + " more energy, and each " + mon.fast.name + " gives " + mon.fast.gain + ". " +
					(move.energy - p.energy) + " ÷ " + mon.fast.gain + " = " + ((move.energy - p.energy) / mon.fast.gain).toFixed(2).replace(/\.?0+$/, "") + ", rounded up to " + n + ". After " + n + " it has " + (p.energy + n * mon.fast.gain) + " energy.",
				visual: { type: "pips", gain: mon.fast.gain, cost: move.energy, start: p.energy, count: n }
			};
		}
	});

	register("count.turns", {
		category: "count",
		minLevel: 1,
		makeParams: function (rng, pool, level) {
			var mon = rng.pick(pool);
			var move = rng.pick(mon.charged);

			return { mon: mon.id, move: move.id, energy: level >= 3 ? rng.int(1, move.energy - 1) : 0 };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var move = chargedById(mon, p.move);
			var n = TurnMath.fastMovesToReach(p.energy, move.energy, mon.fast.gain);
			var turns = n * mon.fast.turns;

			return {
				prompt: mon.name + " (" + fastInline(mon) + ")" + (p.energy ? " has " + p.energy + " energy." : " starts at 0 energy.") + " If it taps nonstop, how many turns until it can throw " + move.name + " (" + move.energy + ")? Each turn is 0.5 seconds.",
				input: numberInput("turns", 200),
				answer: turns,
				explain: "It needs " + plural(n, "Fast Move") + " (" + (move.energy - p.energy) + " energy ÷ " + mon.fast.gain + ", rounded up). Each lasts " + plural(mon.fast.turns, "turn") + ", so " + n + " × " + mon.fast.turns + " = " + turns + " turns (" + (turns / 2) + " seconds).",
				visual: null
			};
		}
	});

	register("count.leftover", {
		category: "count",
		minLevel: 2,
		makeParams: function (rng, pool) {
			var mon;
			var move;

			// Skip exact fits, which have nothing left over to count
			for (var i = 0; i < 30; i++) {
				mon = rng.pick(pool);
				move = rng.pick(mon.charged);

				if (move.energy % mon.fast.gain !== 0) {
					break;
				}
			}

			return { mon: mon.id, move: move.id };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var move = chargedById(mon, p.move);
			var n = TurnMath.fastMovesToReach(0, move.energy, mon.fast.gain);
			var left = n * mon.fast.gain - move.energy;

			return {
				prompt: mon.name + " (" + fastInline(mon) + ") starts at 0 energy and throws " + move.name + " (" + move.energy + ") the moment it can. How much energy does it have left after the throw?",
				input: numberInput("energy"),
				answer: left,
				explain: n + " Fast Moves gives " + n + " × " + mon.fast.gain + " = " + (n * mon.fast.gain) + " energy. Throwing " + move.name + " spends " + move.energy + ", leaving " + left + ". That leftover energy shortens the next count.",
				visual: null
			};
		}
	});

	register("count.sequence", {
		category: "count",
		minLevel: 3,
		makeParams: function (rng, pool) {
			// Pick a pairing where the repeating count actually varies, so there's something to learn
			for (var i = 0; i < 40; i++) {
				var mon = rng.pick(pool);
				var move = rng.pick(mon.charged);
				var seq = TurnMath.countSequence(mon.fast.gain, move.energy, 4, 0).map(function (s) { return s.fastMoves; });

				if (Math.min.apply(null, seq) !== Math.max.apply(null, seq)) {
					return { mon: mon.id, move: move.id, nth: rng.int(2, 4) };
				}
			}

			var fallback = pool[0];

			return { mon: fallback.id, move: fallback.charged[0].id, nth: 2 };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var move = chargedById(mon, p.move);
			var seq = TurnMath.countSequence(mon.fast.gain, move.energy, p.nth, 0);
			var ordinal = ["", "first", "second", "third", "fourth"][p.nth];

			return {
				prompt: mon.name + " (" + fastInline(mon) + ") throws only " + move.name + " (" + move.energy + "), as soon as it can, starting from 0 energy. How many Fast Moves does it tap before its " + ordinal + " throw, counting from the end of the previous throw?",
				input: numberInput("Fast Moves"),
				answer: seq[p.nth - 1].fastMoves,
				explain: "Leftover energy carries over, so the count changes: " + seq.map(function (s, i) {
					return "throw " + (i + 1) + " takes " + s.fastMoves + " (leaves " + s.leftover + ")";
				}).join("; ") + ".",
				visual: null
			};
		}
	});

	register("count.race", {
		category: "count",
		minLevel: 2,
		makeParams: function (rng, pool) {
			for (var i = 0; i < 60; i++) {
				var a = rng.pick(pool);
				var b = rng.pick(pool);

				if (a.id === b.id) {
					continue;
				}

				var am = rng.pick(a.charged);
				var bm = rng.pick(b.charged);
				var r = TurnMath.race(
					{ gain: a.fast.gain, duration: a.fast.turns, cost: am.energy, startEnergy: 0 },
					{ gain: b.fast.gain, duration: b.fast.turns, cost: bm.energy, startEnergy: 0 });

				if (r.first !== "tie" && Math.abs(r.margin) >= 1) {
					return { a: a.id, am: am.id, b: b.id, bm: bm.id };
				}
			}

			return { a: pool[0].id, am: pool[0].charged[0].id, b: pool[1].id, bm: pool[1].charged[0].id };
		},
		build: function (p, pool) {
			var a = pool.byId[p.a];
			var b = pool.byId[p.b];
			var am = chargedById(a, p.am);
			var bm = chargedById(b, p.bm);
			var r = TurnMath.race(
				{ gain: a.fast.gain, duration: a.fast.turns, cost: am.energy, startEnergy: 0 },
				{ gain: b.fast.gain, duration: b.fast.turns, cost: bm.energy, startEnergy: 0 });
			var answer = r.first === "a" ? "a" : (r.first === "b" ? "b" : "tie");
			var nA = TurnMath.fastMovesToReach(0, am.energy, a.fast.gain);
			var nB = TurnMath.fastMovesToReach(0, bm.energy, b.fast.gain);

			return {
				prompt: "Both Pokemon tap nonstop from 0 energy. Who can throw a Charged Move first: " + a.name + " going for " + am.name + " (" + am.energy + "), or " + b.name + " going for " + bm.name + " (" + bm.energy + ")?",
				facts: [[a.name, fastLabel(a)], [b.name, fastLabel(b)]],
				input: { kind: "choice", options: [{ id: "a", label: a.name }, { id: "b", label: b.name }, { id: "tie", label: "Same turn" }] },
				answer: answer,
				explain: a.name + " needs " + plural(nA, "Fast Move") + " × " + a.fast.turns + " turn" + (a.fast.turns === 1 ? "" : "s") + " = " + r.turnsA + " turns. " +
					b.name + " needs " + plural(nB, "Fast Move") + " × " + b.fast.turns + " turn" + (b.fast.turns === 1 ? "" : "s") + " = " + r.turnsB + " turns. " +
					(answer === "tie" ? "Dead even." : (answer === "a" ? a.name : b.name) + " is " + plural(Math.abs(r.margin), "turn") + " faster."),
				visual: null
			};
		}
	});

	// --- Opponent energy ("history") ---

	function describeEvents(mon, events) {
		return events.map(function (e) {
			if (e.type === "fast") {
				return "taps " + plural(e.count, mon.fast.name);
			}

			return "throws " + e.name + " (" + e.cost + ")";
		}).join(", then ");
	}

	// Walk a plausible history: tap until a Charged Move is affordable, throw one, repeat
	function makeHistory(rng, mon, level) {
		var throws = level >= 3 ? 2 : 1;
		var events = [];
		var energy = 0;
		var cheapest = mon.charged.reduce(function (lo, m) { return Math.min(lo, m.energy); }, 100);

		for (var t = 0; t < throws; t++) {
			var taps = TurnMath.fastMovesToReach(energy, cheapest, mon.fast.gain) + rng.int(0, level >= 3 ? 3 : 1);
			var available = energy + taps * mon.fast.gain;
			var affordable = mon.charged.filter(function (m) { return m.energy <= Math.min(available, 100); });

			if (affordable.length === 0 || available > 100) {
				return null;
			}

			var move = rng.pick(affordable);

			events.push({ type: "fast", count: taps });
			events.push({ type: "charged", cost: move.energy, name: move.name, id: move.id });
			energy = TurnMath.replayHistory(events, mon.fast.gain, 0).energy;
		}

		var trailing = rng.int(level >= 2 ? 1 : 0, level >= 3 ? 4 : 3);

		if (trailing > 0) {
			events.push({ type: "fast", count: trailing });
		}

		return events;
	}

	register("history.next", {
		category: "history",
		minLevel: 2,
		makeParams: function (rng, pool, level) {
			for (var i = 0; i < 80; i++) {
				var mon = rng.pick(pool);
				var events = makeHistory(rng, mon, level);

				if (!events) {
					continue;
				}

				var energy = TurnMath.replayHistory(events, mon.fast.gain, 0).energy;
				var targets = mon.charged.filter(function (m) { return energy < m.energy; });

				if (targets.length === 0) {
					continue;
				}

				return { mon: mon.id, events: events, target: rng.pick(targets).id, asTurns: level >= 3 && rng.chance(0.4) };
			}

			var fb = pool[0];

			return { mon: fb.id, events: [{ type: "fast", count: 1 }], target: fb.charged[0].id, asTurns: false };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var target = chargedById(mon, p.target);
			var replay = TurnMath.replayHistory(p.events, mon.fast.gain, 0);
			var n = TurnMath.fastMovesToReach(replay.energy, target.energy, mon.fast.gain);
			var steps = [];
			var running = 0;

			p.events.forEach(function (e) {
				if (e.type === "fast") {
					running = TurnMath.energyAfterFast(running, mon.fast.gain, e.count);
					steps.push(e.count + " × " + mon.fast.gain + " → " + running);
				} else {
					running -= e.cost;
					steps.push("−" + e.cost + " → " + running);
				}
			});

			var answer = p.asTurns ? n * mon.fast.turns : n;

			return {
				prompt: "An opposing " + mon.name + " (" + fastInline(mon) + ") starts at 0 energy. You watch it: it " + describeEvents(mon, p.events) + ". " +
					(p.asTurns ? "If it keeps tapping, how many turns until it can throw " : "How many more Fast Moves until it can throw ") + target.name + " (" + target.energy + ")?",
				facts: monFacts(mon),
				input: p.asTurns ? numberInput("turns", 200) : numberInput("Fast Moves"),
				answer: answer,
				explain: "Track its energy: " + steps.join(", ") + ". It has " + replay.energy + " energy now. " + target.name + " costs " + target.energy + ", so it needs " + (target.energy - replay.energy) + " more, which is " + plural(n, "Fast Move") + " (rounded up)" +
					(p.asTurns ? ", or " + n + " × " + mon.fast.turns + " = " + answer + " turns." : "."),
				visual: null
			};
		}
	});

	register("history.energy", {
		category: "history",
		minLevel: 2,
		makeParams: function (rng, pool, level) {
			for (var i = 0; i < 80; i++) {
				var mon = rng.pick(pool);
				var events = makeHistory(rng, mon, level);

				if (events) {
					return { mon: mon.id, events: events };
				}
			}

			return { mon: pool[0].id, events: [{ type: "fast", count: 3 }] };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var replay = TurnMath.replayHistory(p.events, mon.fast.gain, 0);
			var total = TurnMath.replayHistory(p.events.filter(function (e) { return e.type === "fast"; }), mon.fast.gain, 0).energy;

			return {
				prompt: "An opposing " + mon.name + " (" + fastInline(mon) + ") starts at 0 energy. You watch it: it " + describeEvents(mon, p.events) + ". How much energy does it have now?",
				input: numberInput("energy", 100),
				answer: replay.energy,
				explain: "Energy gained from Fast Moves: " + (total) + ". Minus " + (total - replay.energy) + " spent on Charged Moves = " + replay.energy + ".",
				visual: null
			};
		}
	});

	register("history.capped", {
		category: "history",
		minLevel: 3,
		makeParams: function (rng, pool) {
			// A Pokemon that taps past 100 loses the extra energy before it throws
			for (var i = 0; i < 80; i++) {
				var mon = rng.pick(pool);
				var move = rng.pick(mon.charged);
				var over = rng.int(2, 5);
				var taps = Math.ceil(100 / mon.fast.gain) + over;

				if (taps * mon.fast.gain > 100 && taps <= 40) {
					return { mon: mon.id, move: move.id, taps: taps };
				}
			}

			return { mon: pool[0].id, move: pool[0].charged[0].id, taps: Math.ceil(100 / pool[0].fast.gain) + 2 };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var move = chargedById(mon, p.move);
			var events = [{ type: "fast", count: p.taps }, { type: "charged", cost: move.energy }];
			var replay = TurnMath.replayHistory(events, mon.fast.gain, 0);

			return {
				prompt: "An opposing " + mon.name + " (" + fastInline(mon) + ") starts at 0 energy. It taps " + plural(p.taps, mon.fast.name) + " without throwing anything, then throws " + move.name + " (" + move.energy + "). How much energy does it have left?",
				input: numberInput("energy", 100),
				answer: replay.energy,
				explain: p.taps + " × " + mon.fast.gain + " = " + (p.taps * mon.fast.gain) + ", but energy caps at 100, so " + replay.wasted + " was wasted. It throws from 100: 100 − " + move.energy + " = " + replay.energy + ". Energy past 100 is lost, so a Pokemon that sits on a full bar is throwing away free energy.",
				visual: null
			};
		}
	});

	register("history.canThrow", {
		category: "history",
		minLevel: 2,
		makeParams: function (rng, pool, level) {
			for (var i = 0; i < 80; i++) {
				var mon = rng.pick(pool);
				var events = makeHistory(rng, mon, level);

				if (events) {
					return { mon: mon.id, events: events, move: rng.pick(mon.charged).id };
				}
			}

			return { mon: pool[0].id, events: [{ type: "fast", count: 3 }], move: pool[0].charged[0].id };
		},
		build: function (p, pool) {
			var mon = pool.byId[p.mon];
			var move = chargedById(mon, p.move);
			var replay = TurnMath.replayHistory(p.events, mon.fast.gain, 0);
			var can = replay.energy >= move.energy;

			return {
				prompt: "An opposing " + mon.name + " (" + fastInline(mon) + ") starts at 0 energy. You watch it: it " + describeEvents(mon, p.events) + ". Could it throw " + move.name + " (" + move.energy + ") right now?",
				input: { kind: "choice", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
				answer: can ? "yes" : "no",
				explain: "It has " + replay.energy + " energy. " + move.name + " costs " + move.energy + ", so " + (can ? "it can." : "it needs " + (move.energy - replay.energy) + " more (" + plural(TurnMath.fastMovesToReach(replay.energy, move.energy, mon.fast.gain), "Fast Move") + ")."),
				visual: null
			};
		}
	});

	// --- Timing ---

	var DURATION_PAIRS = [
		[2, 3], [3, 2], [2, 4], [4, 2], [1, 3], [3, 1], [2, 5], [5, 2], [5, 3], [3, 5], [4, 3], [3, 4],
		[5, 4], [4, 5], [3, 3], [2, 2], [1, 2], [2, 1], [1, 4], [4, 1], [4, 4], [5, 5]
	];

	function windowRows(a, b, count) {
		return TurnMath.syncWindows(a, b, count);
	}

	function turnWord(n) {
		return plural(n, "turn");
	}

	// "3-turn", for use before a noun
	function turnAdj(n) {
		return n + "-turn";
	}

	register("timing.perfectCount", {
		category: "timing",
		minLevel: 1,
		makeParams: function (rng) {
			for (var i = 0; i < 40; i++) {
				var pair = rng.pick(DURATION_PAIRS);

				if (TurnMath.perfectCounts(pair[0], pair[1], 1, true).length > 0) {
					return { a: pair[0], b: pair[1] };
				}
			}

			return { a: 2, b: 5 };
		},
		build: function (p) {
			var first = TurnMath.perfectCounts(p.a, p.b, 3, true);
			var w = windowRows(p.a, p.b, first[0])[first[0] - 1];

			return {
				prompt: "You use a " + turnAdj(p.a) + " Fast Move. Your opponent uses a " + turnAdj(p.b) + " Fast Move. You both tap on the same turn. After how many of your Fast Moves is your first throw on the last turn of their Fast Move (perfect timing)?",
				input: numberInput("Fast Moves", 40),
				answer: first[0],
				explain: "You tap on turn 1, so you can throw on turns " + [1, 2, 3, 4].map(function (k) { return 1 + k * p.a; }).join(", ") + "... Their Fast Move registers on the last turn of each cycle: turns " + [1, 2, 3, 4].map(function (k) { return k * p.b; }).join(", ") + "... Throwing after " + plural(first[0], "Fast Move") + " puts you on turn " + (1 + w.turn) + ", the turn their move registers. " +
					"Perfect counts: " + first.join(", ") + ".",
				visual: { type: "timing", a: p.a, b: p.b, k: first[0] }
			};
		}
	});

	register("timing.canPerfect", {
		category: "timing",
		minLevel: 2,
		makeParams: function (rng) {
			var aligned = rng.chance(0.5);
			var pool = DURATION_PAIRS.filter(function (pair) {
				return (TurnMath.perfectCounts(pair[0], pair[1], 1, true).length === 0) === aligned;
			});
			var pair = rng.pick(pool);

			return { a: pair[0], b: pair[1] };
		},
		build: function (p) {
			var found = TurnMath.perfectCounts(p.a, p.b, 3, true);
			var can = found.length > 0;
			var k = can ? found[0] : 2;

			return {
				prompt: "You use a " + turnAdj(p.a) + " Fast Move against a " + turnAdj(p.b) + " Fast Move, tapping on the same turn. Can you ever throw on the last turn of their Fast Move?",
				input: { kind: "choice", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No, never" }] },
				answer: can ? "yes" : "no",
				explain: can
					? "Yes. The cycles drift out of step, so a perfect window appears after " + found.join(", ") + " Fast Moves."
					: "No. Fast Moves of " + p.a + " and " + p.b + " turns stay in step, so their move is always either just starting or halfway through when you're able to throw. Matchups like this have no perfect timing, which is why mirror matches and even multiples (2 vs 4, 1 vs anything) can't be improved.",
				visual: { type: "timing", a: p.a, b: p.b, k: k }
			};
		}
	});

	register("timing.goodCounts", {
		category: "timing",
		minLevel: 2,
		makeParams: function (rng) {
			for (var i = 0; i < 40; i++) {
				var pair = rng.pick(DURATION_PAIRS);
				var rows = windowRows(pair[0], pair[1], 8);
				var goods = rows.filter(function (w) { return w.good; }).length;

				if (goods >= 1 && goods <= 6) {
					return { a: pair[0], b: pair[1] };
				}
			}

			return { a: 5, b: 3 };
		},
		build: function (p) {
			var rows = windowRows(p.a, p.b, 8);
			var good = rows.filter(function (w) { return w.good; }).map(function (w) { return String(w.k); });

			return {
				prompt: "You use a " + turnAdj(p.a) + " Fast Move. Your opponent uses a " + turnAdj(p.b) + " Fast Move. You both tap on the same turn. If you throw after k of your Fast Moves, which values of k give them no free turns? Select all that apply. (The Battle page's Optimal Move Timing lists only the perfect, last-turn throws, which are a subset of these.)",
				input: { kind: "multi", options: rows.map(function (w) { return { id: String(w.k), label: "k = " + w.k }; }) },
				answer: good,
				explain: rows.map(function (w) {
					return "k=" + w.k + " (turn " + (1 + w.turn) + "): they have " + w.rho + " turn" + (w.rho === 1 ? "" : "s") + " left, " + (w.freeTurns === 0 ? "no free turns" : turnWord(w.freeTurns) + " free" + (w.sneak ? ", a sneak" : ""));
				}).join(". ") + ". Throwing with 1 or 2 turns left on their move costs nothing; 1 is best because they lose a turn. The perfect ones are k = " + (TurnMath.perfectCounts(p.a, p.b, 4, true).filter(function (k) { return k <= 8; }).join(", ") || "none") + ".",
				visual: { type: "timing", a: p.a, b: p.b, k: good.length ? parseInt(good[0], 10) : 1 }
			};
		}
	});

	register("timing.freeTurns", {
		category: "timing",
		minLevel: 1,
		makeParams: function (rng) {
			for (var i = 0; i < 40; i++) {
				var pair = rng.pick(DURATION_PAIRS);
				var k = rng.int(1, 6);
				var w = windowRows(pair[0], pair[1], k)[k - 1];

				if (w.freeTurns > 0) {
					return { a: pair[0], b: pair[1], k: k };
				}
			}

			return { a: 5, b: 3, k: 3 };
		},
		build: function (p) {
			var w = windowRows(p.a, p.b, p.k)[p.k - 1];

			return {
				prompt: "You use a " + turnAdj(p.a) + " Fast Move against a " + turnAdj(p.b) + " Fast Move. You both tap on turn 1, and you throw a Charged Move after " + plural(p.k, "Fast Move") + ". How many free turns does your opponent get?",
				input: numberInput("free turns", 10),
				answer: w.freeTurns,
				explain: "You throw on turn " + (1 + w.turn) + ". Their " + p.b + "-turn Fast Move has " + w.rho + " turn" + (w.rho === 1 ? "" : "s") + " left (1 means it registers that turn). Free turns = turns left \u2212 2 = " + w.freeTurns + ". " +
					(w.sneak ? "They tapped a brand new Fast Move on your throw turn, which is a sneak." : ""),
				visual: { type: "timing", a: p.a, b: p.b, k: p.k }
			};
		}
	});

	register("timing.grade", {
		category: "timing",
		minLevel: 1,
		makeParams: function (rng) {
			var b = rng.int(2, 5);

			return { b: b, rho: rng.int(1, b) };
		},
		build: function (p) {
			var g = TurnMath.gradeThrow(p.rho, p.b);

			return {
				prompt: "You throw a Charged Move. Your opponent's " + turnAdj(p.b) + " Fast Move has " + turnWord(p.rho) + " left" + (p.rho === 1 ? " (it registers this turn)" : (p.rho === p.b ? " (they tapped it this very turn)" : "")) + ". How was your timing?",
				input: {
					kind: "choice",
					options: [
						{ id: "perfect", label: "Perfect (they lose a turn)" },
						{ id: "good", label: "Good (no free turns)" },
						{ id: "minor", label: "Minor leak (1 free turn)" },
						{ id: "bad", label: "Bad (2+ free turns)" },
						{ id: "sneak", label: "Sneak (fresh tap)" }
					]
				},
				answer: g.grade,
				explain: "Free turns = turns left − 2" + (p.rho < 2 ? ", but it can't go below 0. With 1 turn left their move registers, and the Charged Move's dead turn means they actually lose a turn." : " = " + g.freeTurns + ".") +
					" " + (g.grade === "sneak" ? "A full-length tap on your throw turn is a sneak: it registers during your throw." : ""),
				visual: null
			};
		}
	});

	register("timing.theirThrow", {
		category: "timing",
		minLevel: 2,
		makeParams: function (rng) {
			var a = rng.int(2, 5);

			return { a: a, rho: rng.int(1, a) };
		},
		build: function (p) {
			var free = TurnMath.freeTurns(p.rho);

			return {
				prompt: "Your opponent throws a Charged Move. Your " + turnAdj(p.a) + " Fast Move has " + turnWord(p.rho) + " left. How many free turns do you get?",
				input: numberInput("free turns", 10),
				answer: free,
				explain: "The same rule applies to you. Free turns = your turns left − 2 = " + (p.rho - 2) + (p.rho < 2 ? ", which is below zero so you get none." : ".") + " Longer Fast Moves are hurt most by being interrupted right after they start.",
				visual: null
			};
		}
	});

	register("timing.snapshot", {
		category: "timing",
		minLevel: 3,
		makeParams: function (rng) {
			for (var i = 0; i < 60; i++) {
				var a = rng.int(1, 4);
				var b = rng.int(3, 5);
				var rho = rng.int(1, b);
				var adv = snapshotAdvice(a, b, rho);

				if (adv.action === "wait" || adv.now.good) {
					return { a: a, b: b, rho: rho };
				}
			}

			return { a: 2, b: 5, rho: 5 };
		},
		build: function (p) {
			var adv = snapshotAdvice(p.a, p.b, p.rho);
			var answer = adv.action === "wait" ? "wait" : "throw";

			return {
				prompt: "You have the energy for a Charged Move, your own Fast Move is " + turnWord(p.a) + " long, and you can act this turn. Their " + turnAdj(p.b) + " Fast Move has " + turnWord(p.rho) + " left" + (p.rho === p.b ? " (they just tapped it)" : "") + ". You're healthy and well below 100 energy. Throw now, or tap another Fast Move first?",
				input: { kind: "choice", options: [{ id: "throw", label: "Throw now" }, { id: "wait", label: "Tap another Fast Move first" }] },
				answer: answer,
				explain: adv.reason + (answer === "wait" ? " Tapping once more takes " + turnWord(p.a) + ", landing you in a better window." : ""),
				visual: null
			};
		}
	});

	function snapshotAdvice(a, b, rho) {
		return TurnMath.adviseThrow({
			a: a, b: b, myCd: 0, oppCd: TurnMath.cdBefore(rho, b),
			energy: 50, gain: 4, cost: 35, maxWait: 2,
			danger: { hp: 999, oppFastDamage: 1, oppDuration: b }
		});
	}

	// ---------- Building and checking ----------

	function questionKey(type, params) {
		return type + "|" + JSON.stringify(params);
	}

	function build(type, params, pool, level) {
		var gen = GENERATORS[type];

		if (!gen) {
			throw new Error("Unknown question type " + type);
		}

		var q = gen.build(params, pool);

		q.type = type;
		q.category = gen.category;
		q.params = params;
		q.level = level || gen.minLevel;
		q.key = questionKey(type, params);
		q.facts = q.facts || null;

		return q;
	}

	function typesFor(categories, level) {
		return Object.keys(GENERATORS).filter(function (type) {
			var gen = GENERATORS[type];

			return categories.indexOf(gen.category) > -1 && gen.minLevel <= level;
		});
	}

	function generate(rng, pool, opts) {
		var categories = opts.categories && opts.categories.length ? opts.categories : Object.keys(CATEGORIES);
		var level = opts.level || 2;
		var types = typesFor(categories, level);

		if (types.length === 0) {
			// A category with no questions at this level (e.g. opponent energy on Easy) falls back to its lowest level
			types = Object.keys(GENERATORS).filter(function (t) { return categories.indexOf(GENERATORS[t].category) > -1; });
			level = Math.max(level, Math.min.apply(null, types.map(function (t) { return GENERATORS[t].minLevel; })));
		}

		var type = rng.pick(types);
		var params = GENERATORS[type].makeParams(rng, pool, level);

		return build(type, params, pool, level);
	}

	function sameSet(a, b) {
		if (a.length !== b.length) {
			return false;
		}

		var sortedA = a.slice().sort();
		var sortedB = b.slice().sort();

		return sortedA.every(function (v, i) { return v === sortedB[i]; });
	}

	// response: a number (number input), an option id (choice), or an array of ids (multi)
	function check(q, response) {
		var correct = false;

		switch (q.input.kind) {
			case "number":
				correct = Number(response) === q.answer;
				break;

			case "choice":
				correct = response === q.answer || (q.accept || []).indexOf(response) > -1;
				break;

			case "multi":
				correct = Array.isArray(response) && sameSet(response, q.answer);
				break;
		}

		return { correct: correct, expected: answerText(q) };
	}

	// "1 turn", "2 turns"
	function withUnit(n, unit) {
		if (!unit) {
			return String(n);
		}

		return n + " " + (n === 1 ? unit.replace(/s$/, "") : unit);
	}

	function answerText(q) {
		if (q.input.kind === "number") {
			return withUnit(q.answer, q.input.unit);
		}

		var labels = {};

		q.input.options.forEach(function (o) { labels[o.id] = o.label; });

		if (q.input.kind === "multi") {
			return q.answer.length ? q.answer.map(function (id) { return labels[id]; }).join(", ") : "none of them";
		}

		return labels[q.answer];
	}

	// ---------- Progress and spaced repetition ----------

	var STORAGE_KEY = "academy.progress.v1";
	var MAX_CARDS = 200;
	var BOX_COUNT = 4;

	function memoryStorage() {
		var data = {};

		return {
			getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
			setItem: function (k, v) { data[k] = String(v); },
			removeItem: function (k) { delete data[k]; }
		};
	}

	/*
	* Tracks results per category and per card, and brings missed cards back.
	* A card is a specific scenario (type + params). A miss drops it to box 0; each correct answer moves it up a box.
	* Boxes below the top are "weak" and get replayed.
	*/
	function Progress(storage) {
		var store = storage || memoryStorage();
		var state = { cards: {}, stats: {}, streak: 0, best: 0, total: 0, correct: 0, tick: 0 };
		var scope = ""; // The format being played (league and cup). A card only replays in the format it was missed in.

		function load() {
			try {
				var raw = store.getItem(STORAGE_KEY);

				if (raw) {
					var parsed = JSON.parse(raw);

					if (parsed && parsed.cards) {
						state = parsed;
					}
				}
			} catch (e) {
				// Corrupt or unavailable storage: start fresh
			}
		}

		function save() {
			try {
				store.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch (e) {
				// Storage may be full or blocked. Progress stays in memory for this session.
			}
		}

		function prune() {
			var keys = Object.keys(state.cards);

			if (keys.length <= MAX_CARDS) {
				return;
			}

			// Drop the least recently seen mastered cards first
			keys.sort(function (a, b) {
				var ca = state.cards[a];
				var cb = state.cards[b];

				if ((ca.box === BOX_COUNT) !== (cb.box === BOX_COUNT)) {
					return ca.box === BOX_COUNT ? -1 : 1;
				}

				return ca.last - cb.last;
			});

			keys.slice(0, keys.length - MAX_CARDS).forEach(function (k) { delete state.cards[k]; });
		}

		load();

		return {
			record: function (q, correct) {
				state.tick++;
				state.total++;

				var cat = state.stats[q.category] || (state.stats[q.category] = { seen: 0, right: 0 });

				cat.seen++;

				if (correct) {
					cat.right++;
					state.correct++;
					state.streak++;
					state.best = Math.max(state.best, state.streak);
				} else {
					state.streak = 0;
				}

				var cardKey = scope ? scope + "#" + q.key : q.key;
				var card = state.cards[cardKey] || { type: q.type, category: q.category, params: q.params, level: q.level, box: 0, seen: 0, right: 0, last: 0, scope: scope };

				card.seen++;
				card.last = state.tick;

				if (correct) {
					card.right++;
					card.box = Math.min(BOX_COUNT, card.box + 1);
				} else {
					card.box = 0;
				}

				state.cards[cardKey] = card;
				prune();
				save();
			},

			// Cards saved before formats existed have no scope. Give them one so they stay reachable.
			adoptUnscoped: function (value) {
				var changed = false;

				Object.keys(state.cards).forEach(function (k) {
					var card = state.cards[k];

					if (!card.scope) {
						delete state.cards[k];
						card.scope = value;
						state.cards[value + "#" + k] = card;
						changed = true;
					}
				});

				if (changed) {
					save();
				}
			},

			// Cards are tracked per format; set it whenever the league or cup changes
			setScope: function (value) { scope = value || ""; },

			// Cards worth replaying: ever missed and not yet mastered
			weakCards: function (categories) {
				return Object.keys(state.cards).map(function (k) { return state.cards[k]; }).filter(function (c) {
					return c.box < BOX_COUNT && c.seen > c.right && (!categories || categories.indexOf(c.category) > -1) && (!scope || c.scope === scope);
				});
			},

			// Pick a weak card to replay, favoring the ones missed most recently and in the lowest boxes
			pickWeak: function (rng, categories) {
				var weak = this.weakCards(categories);

				if (weak.length === 0) {
					return null;
				}

				var weighted = [];

				weak.forEach(function (c) {
					var weight = (BOX_COUNT - c.box) + (state.tick - c.last < 10 ? 2 : 0);

					for (var i = 0; i < weight; i++) {
						weighted.push(c);
					}
				});

				return rng.pick(weighted);
			},

			stats: function () {
				var result = { total: state.total, correct: state.correct, streak: state.streak, best: state.best, categories: {}, weak: this.weakCards().length, mastered: 0 };

				Object.keys(CATEGORIES).forEach(function (c) {
					var s = state.stats[c] || { seen: 0, right: 0 };

					result.categories[c] = { seen: s.seen, right: s.right, pct: s.seen ? Math.round(100 * s.right / s.seen) : null };
				});

				Object.keys(state.cards).forEach(function (k) {
					if (state.cards[k].box === BOX_COUNT) {
						result.mastered++;
					}
				});

				return result;
			},

			resetStreak: function () {
				state.streak = 0;
				save();
			},

			reset: function () {
				state = { cards: {}, stats: {}, streak: 0, best: 0, total: 0, correct: 0, tick: 0 };
				save();
			}
		};
	}

	/*
	* Choose the next question: usually fresh, sometimes a replay of something missed.
	* replayChance defaults to 0.3 when weak cards exist.
	*/
	function next(rng, pool, opts, progress) {
		var categories = opts.categories && opts.categories.length ? opts.categories : Object.keys(CATEGORIES);
		var replayChance = opts.replayChance === undefined ? 0.3 : opts.replayChance;

		if (progress && (opts.weakOnly || rng.chance(replayChance))) {
			var card = progress.pickWeak(rng, categories);

			if (card && GENERATORS[card.type]) {
				try {
					var q = build(card.type, card.params, pool, card.level);

					q.replay = true;

					return q;
				} catch (e) {
					// The pool changed and no longer has this Pokemon. Fall through to a fresh question.
				}
			}
		}

		return generate(rng, pool, opts);
	}

	return {
		CATEGORIES: CATEGORIES,
		GENERATORS: GENERATORS,
		createRng: createRng,
		buildPool: buildPool,
		register: register,
		build: build,
		generate: generate,
		next: next,
		check: check,
		answerText: answerText,
		typesFor: typesFor,
		Progress: Progress,
		memoryStorage: memoryStorage,
		plural: plural,
		fastLabel: fastLabel,
		chargedById: chargedById
	};
}));
