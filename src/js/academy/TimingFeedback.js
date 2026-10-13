/*
* TimingFeedback - turns raw Charged Move throw records (Battle.getThrowLog) into grades,
* plain-English feedback and summaries. Shared by the Train coach and the Battle timing audit.
*
* The leak itself (free turns and what they're worth) is measured by TurnMath, which engine-check.mjs pins to the engine.
* Whether you should have waited is never worked out here: that judgment is the engine's own verdict on the throw
* (entry.engine, filled in by Battle's throw observer), explained by EngineReasons.
*
* No DOM dependencies. Requires TurnMath and EngineReasons.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('./TurnMath.js'), require('./EngineReasons.js'));
	} else {
		root.TimingFeedback = factory(root.TurnMath, root.EngineReasons);
	}
}(typeof self !== 'undefined' ? self : this, function (TurnMath, EngineReasons) {

	var GRADES = {
		idle: { icon: "\u2714", label: "No move in flight", css: "perfect" },
		perfect: { icon: "✔", label: "Perfect", css: "perfect" },
		good: { icon: "✔", label: "Good", css: "good" },
		minor: { icon: "!", label: "Minor leak", css: "minor" },
		bad: { icon: "✖", label: "Bad timing", css: "bad" },
		sneak: { icon: "✖", label: "Sneak", css: "bad" }
	};

	function round1(n) {
		return Math.round(n * 10) / 10;
	}

	function pluralize(n, word) {
		return n + " " + word + (n === 1 ? "" : "s");
	}

	/*
	* Grade one throw log entry. The result carries everything needed to describe it, including,
	* for a leaky throw, advice on what a better throw would have looked like.
	*/
	function grade(entry) {
		var g = TurnMath.gradeThrow(entry.oppCooldown, entry.oppFastTurns);
		var leak = TurnMath.leakValue(g.freeTurns, entry.oppFastGain, entry.oppFastTurns, entry.oppFastDamage);
		var result = {
			turn: entry.turn,
			actor: entry.actor,
			moveName: entry.moveName,
			cost: entry.cost,
			energyBefore: entry.energyBefore,
			pokeName: entry.pokeName,
			oppName: entry.oppName,
			oppFastName: entry.oppFastName,
			rho: entry.oppCooldown,
			grade: g.grade,
			good: g.good,
			freeTurns: g.freeTurns,
			sneak: g.sneak,
			leakEnergy: round1(leak.energy),
			leakDamage: round1(leak.damage),
			simultaneous: !!entry.simultaneous,
			engine: null
		};

		// The engine's verdict on this throw, if one was recorded
		var e = entry.engine;

		if (e) {
			var why = EngineReasons.explain(e.reasons, entry.actor === 0 ? "you" : "they");

			result.engine = {
				holds: e.action === -1,
				agrees: !!e.agrees,
				waitTaps: e.waitTaps,
				otherMove: e.action > -1 && !e.agrees && e.move ? e.move.name : null,
				headline: why.headline,
				notes: why.notes.map(function (n) { return n.text; }),
				kinds: why.kinds
			};
		}

		return result;
	}

	// One sentence about a graded throw, from the player's point of view
	function describe(t) {
		var g = GRADES[t.grade];

		if (t.simultaneous) {
			return (t.actor === 0 ? "You" : "They") + " threw " + t.moveName + " on the same turn as the other side. Charged Move priority decided it.";
		}

		if (t.actor === 0) {
			switch (t.grade) {
				case "idle":
					return t.moveName + ": " + t.oppName + " wasn't in the middle of a Fast Move, so they lost a turn.";
				case "perfect":
					return t.moveName + ": perfect. " + t.oppFastName + " was on its last turn, so " + t.oppName + " lost a turn.";
				case "good":
					return t.moveName + ": good. No free turns for " + t.oppName + ".";
				case "sneak":
					return t.moveName + ": sneak! " + t.oppName + " tapped " + t.oppFastName + " on the same turn and it landed during your throw. That's " +
						pluralize(t.freeTurns, "free turn") + " (about +" + t.leakEnergy + " energy, +" + t.leakDamage + " damage for them).";
				default:
					return t.moveName + ": " + g.label.toLowerCase() + ". " + t.oppName + " had " + pluralize(t.rho, "turn") + " left on " + t.oppFastName +
						", so you gave them " + pluralize(t.freeTurns, "free turn") + " (about +" + t.leakEnergy + " energy, +" + t.leakDamage + " damage).";
			}
		}

		if (t.freeTurns > 0) {
			return t.moveName + ": they threw with " + pluralize(t.freeTurns, "free turn") + " for you.";
		}

		return t.moveName + ": they timed it well (" + g.label.toLowerCase() + ").";
	}

	/*
	* The engine's view of your throw, as a sentence. This is separate from the leak: a throw can leak free turns and still
	* be what the simulator would do (it may be knocking them out, or its plan calls for it), and a clean throw can be
	* one the simulator would have held for another reason. When the two disagree both are shown, never merged.
	*/
	function betterNext(t) {
		var e = t.engine;

		if (t.actor !== 0 || !e || t.simultaneous) {
			return "";
		}

		var leak = t.freeTurns > 0;
		var why = e.headline ? " " + e.headline : "";

		if (e.holds) {
			var taps = e.waitTaps ? " It would have thrown after " + e.waitTaps + " more tap" + (e.waitTaps === 1 ? "" : "s") + "." : "";

			return (leak ? "The simulator would have held here." : "No free turns, but the simulator would still have held.") + why + taps;
		}

		if (e.otherMove) {
			return "The simulator would have thrown " + e.otherMove + " instead." + why;
		}

		return leak ? "The simulator throws here too." + why : "";
	}

	function tally(list) {
		var counts = { idle: 0, perfect: 0, good: 0, minor: 0, bad: 0, sneak: 0 };
		var free = 0;
		var energy = 0;
		var damage = 0;

		list.forEach(function (t) {
			counts[t.grade]++;
			free += t.freeTurns;
			energy += t.leakEnergy;
			damage += t.leakDamage;
		});

		return {
			total: list.length,
			counts: counts,
			clean: counts.idle + counts.perfect + counts.good,
			freeTurns: free,
			energy: round1(energy),
			damage: round1(damage)
		};
	}

	// Summarise graded throws for both sides. Same-turn throws are decided by priority so they're left out.
	function summarize(throws) {
		return {
			you: tally(throws.filter(function (t) { return t.actor === 0 && !t.simultaneous; })),
			opp: tally(throws.filter(function (t) { return t.actor === 1 && !t.simultaneous; }))
		};
	}

	return {
		GRADES: GRADES,
		grade: grade,
		describe: describe,
		betterNext: betterNext,
		summarize: summarize,
		pluralize: pluralize
	};
}));
