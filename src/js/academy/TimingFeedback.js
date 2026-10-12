/*
* TimingFeedback - turns raw Charged Move throw records (Battle.getThrowLog) into grades,
* plain-English feedback and summaries. Shared by the Train coach and the Battle timing audit.
*
* No DOM dependencies. Requires TurnMath.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('./TurnMath.js'));
	} else {
		root.TimingFeedback = factory(root.TurnMath);
	}
}(typeof self !== 'undefined' ? self : this, function (TurnMath) {

	var GRADES = {
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
			advice: null
		};

		// For a leaky throw, work out what would have been better. A throw on the same turn as the
		// opponent's is decided by Charged Move priority, not timing.
		if (!g.good && !entry.simultaneous) {
			result.advice = TurnMath.adviseThrow({
				a: entry.myFastTurns,
				b: entry.oppFastTurns,
				myCd: 0,
				oppCd: TurnMath.cdBefore(entry.oppCooldown, entry.oppFastTurns),
				energy: entry.energyBefore,
				gain: entry.myFastGain,
				cost: entry.cost,
				maxWait: 2,
				danger: { hp: entry.hp, oppFastDamage: entry.oppFastDamage, oppDuration: entry.oppFastTurns }
			});
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

	// What to do differently next time, for the player's own leaky throws
	function betterNext(t) {
		if (!t.advice || t.actor !== 0) {
			return "";
		}

		if (t.advice.action === "wait") {
			return "Next time: tap " + pluralize(t.advice.waitFor.j, "more Fast Move") + " first, then throw.";
		}

		return "No better window was coming up. " + t.advice.reason;
	}

	function tally(list) {
		var counts = { perfect: 0, good: 0, minor: 0, bad: 0, sneak: 0 };
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
			clean: counts.perfect + counts.good,
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
