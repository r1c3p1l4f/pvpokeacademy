/*
* TurnMath - pure turn, energy and move timing math for Trainer Battles.
*
* No DOM or GameMaster dependencies, so the same code powers the Train coach,
* the battle timeline audit, the Academy quizzes and the Node unit tests.
*
* Model (mirrors js/battle/Battle.js):
*  - A turn lasts 0.5s. A Fast Move with duration N is tapped on turn t, its damage and
*    energy register on turn t+N-1, and the Pokemon can act again on turn t+N.
*  - A Charged Move is thrown on a turn the Pokemon can act. The Charged sequence resets both
*    cooldowns and takes up the next turn too, so both Pokemon tap again on turn T+2. Any Fast Move
*    still in flight registers right away.
*  - So if the opponent has `rho` turns of cooldown left when you throw (rho = 1 means their Fast
*    Move registers this turn), their next tap comes rho - 2 turns earlier than it otherwise would.
*    When that's positive those are "free turns" you granted them. rho = b (their full move length)
*    means they tapped on the very turn you threw: a "sneak".
*  - This was measured against Battle.js, see tests/academy/engine-check.mjs.
*
* Cooldown values ("cd") are in turns, measured after a turn's actions have been decided.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
	} else {
		root.TurnMath = factory();
	}
}(typeof self !== 'undefined' ? self : this, function () {

	var MAX_ENERGY = 100;
	var TURN_MS = 500;

	// ---------- Energy and counting ----------

	// Fast Moves needed to afford a Charged Move
	function fastMovesToReach(energy, cost, gain) {
		if (energy >= cost) {
			return 0;
		}

		if (gain <= 0) {
			return Infinity;
		}

		return Math.ceil((cost - energy) / gain);
	}

	// Energy after n Fast Moves, capped at 100
	function energyAfterFast(energy, gain, n) {
		return Math.min(MAX_ENERGY, energy + gain * n);
	}

	/*
	* Replay a history of events and return the resulting energy.
	* events: [{type: "fast", count: 10}, {type: "charged", cost: 55}, ...]
	* Fast Moves are capped one at a time, so energy past 100 is lost before a Charged Move spends it.
	* A Charged Move the history can't afford is reported in `invalid` rather than silently clamped.
	*/
	function replayHistory(events, gain, startEnergy) {
		var energy = startEnergy || 0;
		var wasted = 0;
		var fastMoves = 0;
		var chargedMoves = 0;
		var invalid = [];

		events.forEach(function (event, index) {
			if (event.type === "fast") {
				for (var i = 0; i < event.count; i++) {
					var next = energy + gain;

					if (next > MAX_ENERGY) {
						wasted += next - MAX_ENERGY;
						next = MAX_ENERGY;
					}

					energy = next;
					fastMoves++;
				}
			} else if (event.type === "charged") {
				if (energy < event.cost) {
					invalid.push(index);
				} else {
					energy -= event.cost;
					chargedMoves++;
				}
			}
		});

		return { energy: energy, wasted: wasted, fastMoves: fastMoves, chargedMoves: chargedMoves, invalid: invalid };
	}

	/*
	* The count between repeated throws of the same Charged Move, e.g. [4, 4, 3, 4...].
	* Each entry: fast moves tapped before the throw, and the energy left over afterward.
	*/
	function countSequence(gain, cost, throws, startEnergy) {
		var energy = startEnergy || 0;
		var result = [];

		for (var i = 0; i < throws; i++) {
			var count = fastMovesToReach(energy, cost, gain);
			energy = energy + count * gain - cost;
			result.push({ fastMoves: count, leftover: energy });
		}

		return result;
	}

	// Turns spent tapping n Fast Moves of a given duration
	function turnsForFastMoves(count, duration) {
		return count * duration;
	}

	// The turn on which a Pokemon first has the energy for a Charged Move and can act, counting from its first tap on turn 0
	function firstThrowTurn(gain, duration, cost, startEnergy) {
		return fastMovesToReach(startEnergy || 0, cost, gain) * duration;
	}

	// Who gets their first Charged Move first? Returns the margin in turns (negative if A is first)
	function race(a, b) {
		var turnsA = firstThrowTurn(a.gain, a.duration, a.cost, a.startEnergy);
		var turnsB = firstThrowTurn(b.gain, b.duration, b.cost, b.startEnergy);

		return {
			turnsA: turnsA,
			turnsB: turnsB,
			margin: turnsB - turnsA,
			first: turnsA < turnsB ? "a" : (turnsB < turnsA ? "b" : "tie")
		};
	}

	function energyPerTurn(gain, duration) {
		return gain / duration;
	}

	// ---------- Cooldown projection and move timing ----------

	/*
	* Opponent cooldown (turns) a given number of turns from now, assuming they keep tapping Fast Moves.
	* cd: their cooldown now, in turns. An idle Pokemon (cd 0) acts on the next turn.
	* b: their Fast Move duration.
	* ahead: turns from now (1 = the next turn).
	* Returns rho, the cooldown remaining on that turn after they've acted: 1 means their move registers
	* that turn, and b means they tapped on that turn.
	*/
	function projectRho(cd, b, ahead) {
		var nextAction = Math.max(cd, 1);

		if (ahead < nextAction) {
			return nextAction - ahead;
		}

		return b - ((ahead - nextAction) % b);
	}

	/*
	* The opponent cooldown one turn before a throw that finds them at rho. Use it to turn "they have rho turns
	* left on the throw turn" into the cd that projectRho and throwWindows expect. rho = b means they tapped on the
	* throw turn itself, so they were about to act.
	*/
	function cdBefore(rho, b) {
		return rho >= b ? 1 : rho + 1;
	}

	// How many turns earlier the opponent's next tap comes because you threw. Negative means they lose a turn.
	function tempoShift(rho) {
		// With no Fast Move in flight (rho 0) they would have tapped next turn, so the dead turn costs them 1
		return Math.max(rho, 1) - 2;
	}

	/*
	* How many of the opponent's Fast Moves register strictly before a turn `ahead` turns from now, if they keep tapping.
	* A Fast Move that registers on the throw turn itself isn't counted: the Charged Move resolves first, so even a
	* fatal Fast Move landing that turn doesn't stop it. cd is their cooldown now in turns, b their move length.
	*/
	function landingsBefore(cd, b, ahead) {
		var count = 0;
		var nextTap = Math.max(cd, 1);

		// A move already in flight registers when its cooldown reaches 1
		if (cd >= 2 && cd - 1 < ahead) {
			count++;
		}

		// Moves tapped from nextTap onward register b - 1 turns after the tap
		for (var tap = nextTap; tap + b - 1 < ahead; tap += b) {
			count++;
		}

		return count;
	}

	// Turns of waiting the opponent skips if you throw when they have rho cooldown turns left
	function freeTurns(rho) {
		return Math.max(0, tempoShift(rho));
	}

	/*
	* Grade a throw. rho is the opponent's cooldown on the throw turn, b their Fast Move duration.
	*  idle    - they had no Fast Move in flight (rho 0, e.g. just switched in): they lose a turn
	*  perfect - last turn of their Fast Move (rho 1): it registers and they lose a turn
	*  good    - rho 2: no free turns
	*  minor   - 1 free turn
	*  bad     - 2+ free turns
	*  sneak   - they tapped a fresh Fast Move on your throw turn and it registers during your throw
	*/
	function gradeThrow(rho, b) {
		var free = freeTurns(rho);
		var sneak = (rho >= b) && free > 0;
		var grade = "bad";

		if (rho <= 0) {
			grade = "idle";
		} else if (rho === 1) {
			grade = "perfect";
		} else if (free === 0) {
			grade = "good";
		} else if (sneak) {
			grade = "sneak";
		} else if (free === 1) {
			grade = "minor";
		}

		return { rho: rho, freeTurns: free, tempoShift: tempoShift(rho), grade: grade, sneak: sneak, good: free === 0 };
	}

	/*
	* List your upcoming throw opportunities.
	*  myCd / oppCd - cooldowns now, in turns (a Pokemon that just tapped has cd equal to its move duration)
	*  a / b        - your and their Fast Move durations
	*  count        - how many opportunities to list
	* Each window: j = extra Fast Moves you tap first, turn = turns from now, rho/free/grade for the throw there.
	*/
	function throwWindows(opts) {
		var a = opts.a;
		var b = opts.b;
		var count = opts.count || 6;
		var first = Math.max(opts.myCd, 1);
		var windows = [];

		for (var j = 0; j < count; j++) {
			var turn = first + j * a;
			var rho = projectRho(opts.oppCd, b, turn);
			var grade = gradeThrow(rho, b);

			windows.push({
				j: j,
				turn: turn,
				rho: rho,
				freeTurns: grade.freeTurns,
				tempoShift: grade.tempoShift,
				grade: grade.grade,
				sneak: grade.sneak,
				good: grade.good
			});
		}

		return windows;
	}

	/*
	* Throw windows when both Pokemon start tapping on the same turn (the start of a battle,
	* or the turn after any Charged Move). k is the number of Fast Moves you tap before throwing.
	*/
	function syncWindows(a, b, count) {
		return throwWindows({ a: a, b: b, myCd: a, oppCd: b, count: count }).map(function (w) {
			w.k = w.j + 1;
			return w;
		});
	}

	// The Fast Move counts (k) from a synced start where a throw grants no free turns.
	// strict: only count last-turn (rho 1) throws, the "perfect" ones the Battle page lists.
	function perfectCounts(a, b, count, strict) {
		var found = [];
		var windows = syncWindows(a, b, count * b + b);

		for (var i = 0; i < windows.length && found.length < count; i++) {
			var w = windows[i];

			if (strict ? w.grade === "perfect" : w.good) {
				found.push(w.k);
			}
		}

		return found;
	}

	/*
	* Should you throw now, or tap another Fast Move first?
	* Returns the current window, the first perfect window if one is coming up soon, and a recommendation.
	*  energy / gain - your energy and Fast Move energy
	*  cost          - the Charged Move you plan to throw
	*  maxWait       - most extra Fast Moves worth waiting for
	*  danger        - optional {hp, oppFastDamage, oppDuration, oppBurst}: skip waiting if the opponent's Fast Moves, plus
	*                  oppBurst (damage of a Charged Move they could throw by then), could faint you first
	*/
	function adviseThrow(opts) {
		var windows = throwWindows({
			a: opts.a, b: opts.b, myCd: opts.myCd, oppCd: opts.oppCd, count: (opts.maxWait || 2) + 1
		});
		var now = windows[0];
		var result = {
			now: now,
			windows: windows,
			action: "throw",
			waitFor: null,
			reason: ""
		};

		if (now.good) {
			result.reason = now.grade === "perfect" ? "Last turn of their Fast Move. It registers, and they lose a turn." : "No free turns for them on this throw.";
			return result;
		}

		var target = null;

		for (var i = 1; i < windows.length; i++) {
			if (windows[i].good) {
				target = windows[i];
				break;
			}
		}

		if (!target) {
			result.reason = "No perfect window in the next " + (opts.maxWait || 2) + " Fast Move(s). Throwing grants " + now.freeTurns + " free turn(s).";
			return result;
		}

		var energyThen = energyAfterFast(opts.energy, opts.gain, target.j);
		var overflow = opts.energy + opts.gain * target.j - MAX_ENERGY;

		if (overflow > 0) {
			result.reason = "A perfect window is " + target.j + " Fast Move(s) away, but waiting wastes " + overflow + " energy.";
			return result;
		}

		if (energyThen < opts.cost) {
			result.reason = "Not enough energy for the move at the perfect window.";
			return result;
		}

		if (opts.danger) {
			// Fast Moves that register before the throw turn count, plus any Charged Move they could have ready by then
			var landings = landingsBefore(opts.oppCd, opts.b, target.turn);

			if (landings * opts.danger.oppFastDamage + (opts.danger.oppBurst || 0) >= opts.danger.hp) {
				result.reason = "Waiting " + target.j + " Fast Move(s) could get you knocked out before you throw.";
				return result;
			}
		}

		result.action = "wait";
		result.waitFor = target;
		result.reason = "Tap " + target.j + " more Fast Move" + (target.j > 1 ? "s" : "") + ". Throwing now grants " + now.freeTurns + " free turn" + (now.freeTurns === 1 ? "" : "s") + "; then it grants none.";

		return result;
	}

	// What a leak is worth: the energy and damage the opponent gains from free turns
	function leakValue(free, oppGain, oppDuration, oppDamage) {
		var fastMoves = free / oppDuration;

		return {
			fastMoves: fastMoves,
			energy: fastMoves * oppGain,
			damage: fastMoves * oppDamage
		};
	}

	return {
		MAX_ENERGY: MAX_ENERGY,
		TURN_MS: TURN_MS,
		fastMovesToReach: fastMovesToReach,
		energyAfterFast: energyAfterFast,
		replayHistory: replayHistory,
		countSequence: countSequence,
		turnsForFastMoves: turnsForFastMoves,
		firstThrowTurn: firstThrowTurn,
		race: race,
		energyPerTurn: energyPerTurn,
		projectRho: projectRho,
		landingsBefore: landingsBefore,
		cdBefore: cdBefore,
		tempoShift: tempoShift,
		freeTurns: freeTurns,
		gradeThrow: gradeThrow,
		throwWindows: throwWindows,
		syncWindows: syncWindows,
		perfectCounts: perfectCounts,
		adviseThrow: adviseThrow,
		leakValue: leakValue
	};
}));
