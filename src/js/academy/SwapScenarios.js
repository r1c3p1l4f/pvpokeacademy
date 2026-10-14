/*
* SwapScenarios - "stay in or swap?" questions backed by the real battle simulator.
*
* A scenario is your three Pokemon, the opposing lead, the shields, and optionally damage and energy.
* The answer comes from simulating your current Pokemon and each possible swap against that lead, then applying
* a short set of written rules (see decide). The rules are a coaching heuristic, not a solved game: they don't know
* the opponent's back line, so they only judge the lead matchup and what you'd give up by swapping.
*
* Team shape: Pokemon share a letter when they share most of their weaknesses (they lose to the same things).
*   ABC - three different answers, nothing redundant
*   ABB - your back two lose to the same things
*   ABA - your lead and closer lose to the same things
*
* The pure functions (similarity, shape, decide) have no dependencies. The scenario builder needs Battle, Pokemon
* and the GameMaster globals, and QuizEngine.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(null);
	} else {
		root.SwapScenarios = factory(root);
	}
}(typeof self !== 'undefined' ? self : this, function (env) {

	var SIMILAR = 0.5; // Weakness overlap needed to count as the same shape letter
	var CLEAR_WIN = 580;
	var WIN = 540;
	var CLOSE_LOSS = 460;
	var CLEAR_LOSS = 420;

	// ---------- Team shape ----------

	// Jaccard overlap of two weakness lists
	function similarity(a, b) {
		var union = {};
		var shared = 0;

		a.forEach(function (t) { union[t] = 1; });
		b.forEach(function (t) {
			if (union[t]) {
				shared++;
			}

			union[t] = 1;
		});

		var size = Object.keys(union).length;

		return size === 0 ? 1 : shared / size;
	}

	// Letters for a team in slot order, e.g. "ABA". weakSets is one weakness list per Pokemon.
	function shape(weakSets) {
		var groups = []; // The first member's weaknesses stand for each letter
		var letters = "";

		weakSets.forEach(function (set) {
			var index = -1;

			for (var i = 0; i < groups.length; i++) {
				if (similarity(set, groups[i]) >= SIMILAR) {
					index = i;
					break;
				}
			}

			if (index === -1) {
				groups.push(set);
				index = groups.length - 1;
			}

			letters += String.fromCharCode(65 + index);
		});

		return letters;
	}

	// ---------- Decision rules ----------

	/*
	* Decide stay or swap from battle ratings (0-1000, 500 is even, as shown on the Battle page).
	*   current: rating of your Pokemon now
	*   bench:   [{id, rating, score}] for each Pokemon you could swap in (score = overall ranking score, the "closer" quality)
	*
	* Rules, in order:
	*  1. Winning (above 500): stay. A swap hands them a free Charged Move and starts your 60 second swap timer.
	*  2. Losing and a bench Pokemon wins clearly: swap to it. With two answers, send the one with the lower overall score
	*     and keep the stronger closer, unless the stronger one wins by a lot.
	*  3. Losing and nothing wins: stay and trade. Swapping into another loss just wastes a Pokemon.
	*
	* confidence is "clear" when the ratings aren't near a rule boundary, so quizzes can avoid coin-flips.
	*/
	function decide(current, bench) {
		var sorted = bench.slice().sort(function (x, y) { return y.rating - x.rating; });
		var answers = sorted.filter(function (b) { return b.rating >= WIN; });
		var result = { action: "stay", targets: [], rule: "", confidence: "clear" };

		if (current >= CLEAR_WIN) {
			result.rule = "win";
			return result;
		}

		if (current > 500) {
			result.rule = "narrow-win";
			result.confidence = "contested";
			return result;
		}

		if (answers.length > 0) {
			result.action = "swap";

			if (answers.length === 1) {
				result.targets = [answers[0].id];
				result.rule = "one-answer";
			} else {
				var top = answers[0];
				var next = answers[1];

				if (top.rating - next.rating < 80) {
					// Near-equal: spend the weaker closer first, but either is defensible
					var spend = top.score <= next.score ? top : next;
					var keep = spend === top ? next : top;

					result.targets = [spend.id, keep.id];
					result.rule = "two-answers";
				} else {
					result.targets = [top.id];
					result.rule = "one-answer";
				}
			}

			if (current > CLEAR_LOSS || answers[0].rating < CLEAR_WIN) {
				result.confidence = "contested";
			}

			return result;
		}

		result.rule = "sacrifice";

		if (current > CLEAR_LOSS || (sorted[0] && sorted[0].rating > CLOSE_LOSS)) {
			result.confidence = "contested";
		}

		return result;
	}

	// ---------- Simulation ----------

	var ctx = null; // {pool, cp, cup, weak: {id: [types]}}

	function init(opts) {
		ctx = {
			pool: opts.pool,
			cp: opts.cp || 1500,
			cup: opts.cup || "all",
			weak: {},
			cache: {}
		};

		// Weaknesses come from the same type chart the simulator uses
		var battle = newBattle();

		opts.pool.forEach(function (entry) {
			var poke = createPokemon(entry, 0, battle);

			ctx.weak[entry.id] = Object.keys(poke.typeEffectiveness).filter(function (t) { return poke.typeEffectiveness[t] > 1.1; });
		});

		return ctx;
	}

	function newBattle() {
		var battle = new Battle();

		battle.setCP(ctx.cp);
		battle.setCup(ctx.cup);

		return battle;
	}

	function createPokemon(entry, index, battle) {
		var poke = new Pokemon(entry.id, index, battle);

		poke.initialize(ctx.cp);
		poke.selectMove("fast", entry.fast.id);
		poke.selectMove("charged", entry.charged[0].id, 0);

		if (entry.charged[1]) {
			poke.selectMove("charged", entry.charged[1].id, 1);
		} else {
			poke.selectMove("charged", "none", 1);
		}

		// Mega Pokemon that carry a third Charged Move (selectMove routes index 2 to the extra move pool)
		if (entry.charged[2]) {
			poke.selectMove("charged", entry.charged[2].id, 2);
		}

		return poke;
	}

	/*
	* Rating (0-1000) of `me` against `opp`. State values are fractions of max HP and raw energy.
	*   me/opp: {entry, hpPct, energy, shields}
	*/
	function rate(me, opp) {
		var key = JSON.stringify([me.entry.id, me.hpPct, me.energy, me.shields, opp.entry.id, opp.hpPct, opp.energy, opp.shields]);

		if (ctx.cache[key] !== undefined) {
			return ctx.cache[key];
		}

		var battle = newBattle();
		var a = createPokemon(me.entry, 0, battle);
		var b = createPokemon(opp.entry, 1, battle);
		var aStart;
		var bStart;

		a.setShields(me.shields);
		b.setShields(opp.shields);
		aStart = Math.max(1, Math.round(a.stats.hp * me.hpPct));
		bStart = Math.max(1, Math.round(b.stats.hp * opp.hpPct));
		a.setStartHp(aStart);
		b.setStartHp(bStart);
		a.setStartEnergy(me.energy);
		b.setStartEnergy(opp.energy);

		battle.setNewPokemon(a, 0, false);
		battle.setNewPokemon(b, 1, false);
		battle.simulate();

		// Like the rankings: how much of your HP you kept plus how much of theirs you removed.
		// Both are measured against the HP each side started this matchup with.
		var rating = Math.floor(((a.hp / aStart) + ((bStart - b.hp) / bStart)) * 500);

		ctx.cache[key] = rating;

		return rating;
	}

	// ---------- Scenario generation ----------

	function weakSetsFor(ids) {
		return ids.map(function (id) { return ctx.weak[id]; });
	}

	/*
	* The Pokemon a team may not repeat. A team can't have two of the same Pokemon whatever the form: Shadow and regular,
	* Kanto and Alolan Ninetales, a Mega and its base, and so on. Pokedex number identifies all of them. (An entry with no
	* number falls back to its own id, which is the old, weaker rule.)
	*/
	function speciesKey(p) {
		return p.dex !== undefined && p.dex !== null ? "dex" + p.dex : p.id;
	}

	function pickTeam(rng, pool, wanted) {
		for (var attempt = 0; attempt < 80; attempt++) {
			var first = rng.pick(pool);
			var different = function (x) { return function (p) { return speciesKey(p) !== speciesKey(x); }; };
			var others = pool.filter(different(first));
			var similar = function (x, y) { return similarity(ctx.weak[x.id], ctx.weak[y.id]) >= SIMILAR; };
			var team = null;
			var second;
			var third;

			if (wanted === "ABA") {
				second = rng.pick(others.filter(function (p) { return !similar(p, first); }));
				third = second ? rng.pick(others.filter(different(second)).filter(function (p) { return similar(p, first) && !similar(p, second); })) : null;
				team = second && third ? [first, second, third] : null;
			} else if (wanted === "ABB") {
				second = rng.pick(others.filter(function (p) { return !similar(p, first); }));

				if (second) {
					third = rng.pick(others.filter(different(second)).filter(function (p) { return similar(p, second) && !similar(p, first); }));
				}

				team = second && third ? [first, second, third] : null;
			} else {
				second = rng.pick(others.filter(function (p) { return !similar(p, first); }));

				if (second) {
					third = rng.pick(others.filter(different(second)).filter(function (p) { return !similar(p, first) && !similar(p, second); }));
				}

				team = second && third ? [first, second, third] : null;
			}

			if (team && shape(weakSetsFor(team.map(function (p) { return p.id; }))) === wanted && new Set(team.map(speciesKey)).size === 3) {
				return team;
			}
		}

		return null;
	}

	function makeParams(rng, pool, level) {
		var shapes = ["ABC", "ABB", "ABA"];

		for (var attempt = 0; attempt < 120; attempt++) {
			var wanted = rng.pick(shapes);
			var team = pickTeam(rng, pool, wanted);

			if (!team) {
				continue;
			}

			// The opponent is also a different Pokemon from everyone on your team, in any form, so the question never reads like a mirror match
			var opp = rng.pick(pool.filter(function (p) { return team.every(function (t) { return speciesKey(t) !== speciesKey(p); }); }));
			var shields = [2, 2];

			if (level >= 2 && rng.chance(0.5)) {
				var s = rng.pick([[1, 1], [0, 0], [1, 0], [0, 1], [2, 1]]);

				shields = s;
			}

			var state = { me: { hp: 1, energy: 0 }, opp: { hp: 1, energy: 0 } };

			if (level >= 3) {
				state = {
					me: { hp: rng.pick([1, 0.85, 0.7, 0.5]), energy: rng.pick([0, 15, 30, 45]) },
					opp: { hp: rng.pick([1, 0.8, 0.6]), energy: rng.pick([0, 20, 40, 55]) }
				};
			}

			var params = { team: team.map(function (p) { return p.id; }), opp: opp.id, shields: shields, state: state };
			var evaluated = evaluate(params, pool);

			if (level <= 2 && evaluated.decision.confidence !== "clear") {
				continue;
			}

			if (level === 1 && evaluated.decision.rule !== "win" && evaluated.decision.rule !== "one-answer") {
				continue;
			}

			// Keep the answer mix balanced: the first call decides what's wanted, so skip about half of the easy stays
			if (evaluated.decision.rule === "win" && rng.chance(0.4)) {
				continue;
			}

			return params;
		}

		throw new Error("Could not generate a swap scenario");
	}

	function evaluate(params, pool) {
		var team = params.team.map(function (id) { return pool.byId[id]; });
		var opp = pool.byId[params.opp];
		var oppState = { entry: opp, hpPct: params.state.opp.hp, energy: params.state.opp.energy, shields: params.shields[1] };
		var current = rate({ entry: team[0], hpPct: params.state.me.hp, energy: params.state.me.energy, shields: params.shields[0] }, oppState);
		var bench = [1, 2].map(function (i) {
			return { id: team[i].id, rating: rate({ entry: team[i], hpPct: 1, energy: 0, shields: params.shields[0] }, oppState), score: team[i].score };
		});

		return {
			current: current,
			bench: bench,
			decision: decide(current, bench),
			shape: shape(weakSetsFor(params.team))
		};
	}

	// ---------- Question text ----------

	function verdict(rating) {
		if (rating >= CLEAR_WIN) {
			return "wins";
		}

		if (rating > 500) {
			return "narrowly wins";
		}

		if (rating >= CLOSE_LOSS) {
			return "narrowly loses";
		}

		return "loses";
	}

	function movesetText(entry) {
		return entry.fast.name + " / " + entry.charged.map(function (m) { return m.name; }).join(", ");
	}

	// Team shape commentary that reacts to what actually happened in the sims
	function shapeNote(shapeStr, team, ev, oppName) {
		var d = ev.decision;
		var names = team.map(function (p) { return p.name; });
		var rating = {};

		ev.bench.forEach(function (b) { rating[b.id] = b.rating; });

		var r1 = rating[team[1].id];
		var r2 = rating[team[2].id];
		var target = d.targets.length ? team.map(function (p) { return p.id; }).indexOf(d.targets[0]) : -1;
		var label = "Team shape " + shapeStr + ": ";

		function beats(r) {
			return r >= WIN;
		}

		if (shapeStr === "ABC") {
			if (d.action === "stay") {
				return label + "your three Pokemon cover different weaknesses, so each bench slot answers something different. Keep your lead in and save them for what actually beats it.";
			}

			if (d.action === "swap") {
				return label + "your three Pokemon cover different weaknesses, so using " + names[target] + " here costs you no redundancy. The other two still answer different threats.";
			}

			return label + "your three Pokemon cover different weaknesses, but none of them beats " + oppName + ", so there's nothing to gain from burning a second one.";
		}

		if (shapeStr === "ABB") {
			var shared = names[1] + " and " + names[2] + " share weaknesses";

			if (d.action === "stay" && d.rule !== "sacrifice") {
				return label + shared + ", so they lose to the same things. Your lead is winning, so keep both fresh.";
			}

			if (d.action === "swap") {
				var other = target === 1 ? 2 : 1;
				var otherRating = target === 1 ? r2 : r1;

				return label + shared + ". Sending " + names[target] + " leaves " + names[other] + ", which " + (beats(otherRating) ? "also beats " + oppName + " (" + otherRating + "), so you have a backup answer" : "loses to " + oppName + " (" + otherRating + ") and to anything else that hits those shared weaknesses") + ".";
			}

			return label + shared + ", and neither beats " + oppName + " (" + r1 + " and " + r2 + "). Swapping into either just feeds the same weakness, so stay and trade.";
		}

		// ABA: lead and closer share weaknesses
		var same = names[0] + " and " + names[2] + " share weaknesses";

		if (d.action === "stay" && d.rule !== "sacrifice") {
			return label + same + ". While your lead is winning, keep " + names[1] + " in reserve: it's the one Pokemon on your team with different weaknesses.";
		}

		if (d.action === "swap" && target === 1) {
			return label + same + ", so your closer " + (beats(r2) ? "also beats " + oppName + " (" + r2 + ")" : "loses to " + oppName + " too (" + r2 + ")") + ". " + names[1] + " is your different answer, so swap now instead of hoping the closer cleans up later.";
		}

		if (d.action === "swap") {
			return label + same + ", but " + names[2] + " still beats " + oppName + " (" + r2 + ") on its moves and stats, so it's a valid swap. Afterward " + names[1] + " is your only different answer to whatever beats the A's.";
		}

		return label + same + ", and " + names[2] + " loses to " + oppName + " too (" + r2 + "), as does " + names[1] + " (" + r1 + "). Stay and trade rather than spend a second Pokemon on it.";
	}

	function explain(params, ev, pool) {
		var team = params.team.map(function (id) { return pool.byId[id]; });
		var opp = pool.byId[params.opp];
		var lines = [];
		var d = ev.decision;

		lines.push("Matchups against " + opp.name + " (" + params.shields[0] + " shield" + (params.shields[0] === 1 ? "" : "s") + " for you, " + params.shields[1] + " for them): " +
			team[0].name + " " + ev.current + " (" + verdict(ev.current) + "), " +
			ev.bench.map(function (b) { return pool.byId[b.id].name + " " + b.rating + " (" + verdict(b.rating) + ")"; }).join(", ") + ". 500 is an even matchup.");

		switch (d.rule) {
			case "win":
				lines.push("Stay in. " + team[0].name + " wins this matchup. Swapping gives " + opp.name + " a free Charged Move on the way in and starts your 60 second swap timer, so don't leave a winning matchup.");
				break;

			case "narrow-win":
				lines.push("Stay in. It's close, but " + team[0].name + " is ahead, and a swap costs a free Charged Move. Shields and energy will decide it.");
				break;

			case "one-answer":
				lines.push("Swap to " + pool.byId[d.targets[0]].name + ". " + team[0].name + " loses, and " + pool.byId[d.targets[0]].name + " is the only Pokemon on your team that beats " + opp.name + " convincingly.");
				break;

			case "two-answers":
				lines.push("Swap. Both " + pool.byId[d.targets[0]].name + " and " + pool.byId[d.targets[1]].name + " beat " + opp.name + " by a similar margin. The usual choice is to spend the weaker overall Pokemon (" + pool.byId[d.targets[0]].name + ") and keep the stronger one as your closer.");
				break;

			default:
				lines.push("Stay in and trade. " + team[0].name + " loses, but so does everything you could swap in. Swapping just burns a second Pokemon into the same matchup, so make " + opp.name + " pay: get your energy and bait out shields.");
				break;
		}

		lines.push(shapeNote(ev.shape, team, ev, opp.name));

		if (params.state.opp.energy >= 35 && d.action === "swap") {
			lines.push("They already have " + params.state.opp.energy + " energy, so expect to take a free Charged Move on the swap. Use a shield if it hurts.");
		}

		return lines.join(" ");
	}

	function describeState(state, team, opp) {
		var parts = [];

		if (state.me.hp < 1 || state.me.energy > 0) {
			parts.push(team[0].name + " is at " + Math.round(state.me.hp * 100) + "% HP with " + state.me.energy + " energy");
		}

		if (state.opp.hp < 1 || state.opp.energy > 0) {
			parts.push(opp.name + " is at " + Math.round(state.opp.hp * 100) + "% HP with " + state.opp.energy + " energy");
		}

		return parts.length ? " " + parts.join(", and ") + "." : "";
	}

	// Register the question type with the engine
	function register(QuizEngine) {
		QuizEngine.register("swap.stayOrSwap", {
			category: "swap",
			minLevel: 1,
			makeParams: function (rng, pool, level) {
				return makeParams(rng, pool, level);
			},
			build: function (params, pool) {
				var team = params.team.map(function (id) { return pool.byId[id]; });
				var opp = pool.byId[params.opp];
				var ev = evaluate(params, pool);
				var d = ev.decision;
				var options = [{ id: "stay", label: "Stay in with " + team[0].name }, { id: "swap:" + team[1].id, label: "Swap to " + team[1].name }, { id: "swap:" + team[2].id, label: "Swap to " + team[2].name }];
				var answerId = d.action === "stay" ? "stay" : "swap:" + d.targets[0];
				var accept = d.action === "swap" ? d.targets.map(function (id) { return "swap:" + id; }) : [];

				return {
					prompt: "Your team, in order: " + team.map(function (p) { return p.name; }).join(", ") + " (shape " + ev.shape + "). You lead " + team[0].name + " and the opponent leads " + opp.name +
						". Shields are " + params.shields[0] + " (yours) and " + params.shields[1] + " (theirs)." + describeState(params.state, team, opp) + " You don't know their back line. Stay in, or swap?",
					facts: team.map(function (p, i) { return [(i === 0 ? "Lead: " : "Back: ") + p.name, movesetText(p)]; }).concat([["Opponent: " + opp.name, movesetText(opp)]]),
					input: { kind: "choice", options: options },
					answer: answerId,
					accept: accept,
					explain: explain(params, ev, pool),
					visual: null,
					meta: { shape: ev.shape, rule: d.rule, ratings: { current: ev.current, bench: ev.bench } }
				};
			}
		});
	}

	return {
		SIMILAR: SIMILAR,
		similarity: similarity,
		shape: shape,
		decide: decide,
		init: init,
		register: register,
		evaluate: evaluate,
		rate: rate,
		makeParams: makeParams,
		getWeaknesses: function (id) { return ctx && ctx.weak[id]; },
		// The simulator Pokemon for a pool entry, as the sims use it (exposed so tests can check its loadout)
		createPokemon: function (entry) { return createPokemon(entry, 0, newBattle()); }
	};
}));
