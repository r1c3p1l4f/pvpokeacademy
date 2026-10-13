/*
* EngineAdvisor - asks the simulator's own decision logic (ActionLogic.decideAction) what it would do.
*
* One mechanism serves both the live prompts and the review of a throw after it happens, so there is a single source of
* truth for "should this Pokemon throw now?" and why.
*
* decideAction only reads four things off the battle (getTurns, getMode, getQueuedActions, logDecision), so every call
* here uses a small stand-in battle built from plain values. The real battle is never touched: no debug flag is flipped
* and no log is cut. The two Pokemon are the real objects, with the few fields the decision reads patched for the call
* and restored in a finally block. The call is synchronous, so the battle loop can't run in between.
*
* Needs ActionLogic and DamageCalculator at call time (browser), and TurnMath.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('./TurnMath.js'), {});
	} else {
		root.EngineAdvisor = factory(root.TurnMath, root);
	}
}(typeof self !== 'undefined' ? self : this, function (TurnMath, env) {

	var TURN_MS = TurnMath.TURN_MS;

	// ActionLogic and DamageCalculator are declared with `class`, which makes them global lexical bindings rather than
	// properties of window, so they have to be reached by bare name.
	function actionLogic() {
		return typeof ActionLogic !== "undefined" ? ActionLogic : env.ActionLogic;
	}

	function damageCalculator() {
		return typeof DamageCalculator !== "undefined" ? DamageCalculator : env.DamageCalculator;
	}

	function safeDamage(attacker, defender, move) {
		try {
			return damageCalculator().damage(attacker, defender, move);
		} catch (e) {
			return move.damage || 0;
		}
	}

	/*
	* A battle with just enough surface for ActionLogic.decideAction.
	*   ctx.turns      - the battle's turn counter
	*   ctx.mode       - "simulate" or "emulate"
	*   ctx.queuedFast - how many Fast Moves of the deciding Pokemon are still queued (decideAction uses this for the energy cap)
	*/
	function standInBattle(poke, ctx, sink) {
		var queue = [];

		for (var i = 0; i < (ctx.queuedFast || 0); i++) {
			queue.push({ actor: poke.index, type: "fast" });
		}

		return {
			getTurns: function () { return ctx.turns; },
			getMode: function () { return ctx.mode; },
			getQueuedActions: function () { return queue; },
			logDecision: function (pokemon, string) {
				sink.push({ pokemon: pokemon.speciesName, string: string.trim() });
			}
		};
	}

	/*
	* Ask the engine what `poke` would do against `opp`.
	*   state - fields to patch for the call, all optional (ms for cooldowns):
	*           meCooldown, meEnergy, meHp, oppCooldown, oppEnergy, oppHp
	*   ctx   - {turns, mode, queuedFast, coachDefaults}. coachDefaults asks for the engine's best timing: timing
	*           optimization on and energy farming off, whatever the Pokemon's own settings.
	* Returns {action, move, reasons}: action is a Charged Move index or -1 for "tap".
	*/
	function ask(poke, opp, state, ctx) {
		state = state || {};

		var saved = {
			pCooldown: poke.cooldown, pEnergy: poke.energy, pHp: poke.hp, pTiming: poke.optimizeMoveTiming, pFarm: poke.farmEnergy,
			oCooldown: opp.cooldown, oEnergy: opp.energy, oHp: opp.hp
		};
		var sink = [];

		try {
			if (state.meCooldown !== undefined) { poke.cooldown = state.meCooldown; }
			if (state.meEnergy !== undefined) { poke.energy = state.meEnergy; }
			if (state.meHp !== undefined) { poke.hp = Math.max(1, state.meHp); }
			if (state.oppCooldown !== undefined) { opp.cooldown = state.oppCooldown; }
			if (state.oppEnergy !== undefined) { opp.energy = state.oppEnergy; }
			if (state.oppHp !== undefined) { opp.hp = Math.max(1, state.oppHp); }

			if (ctx.coachDefaults) {
				poke.optimizeMoveTiming = true;
				poke.farmEnergy = false;
			}

			var action = actionLogic().decideAction(standInBattle(poke, ctx, sink), poke, opp);
			var index = action && action.type === "charged" ? action.value : -1;

			return { action: index, move: index > -1 ? poke.chargedMoves[index] : null, reasons: sink.map(function (e) { return e.string; }) };
		} finally {
			poke.cooldown = saved.pCooldown;
			poke.energy = saved.pEnergy;
			poke.hp = saved.pHp;
			poke.optimizeMoveTiming = saved.pTiming;
			poke.farmEnergy = saved.pFarm;
			opp.cooldown = saved.oCooldown;
			opp.energy = saved.oEnergy;
			opp.hp = saved.oHp;
		}
	}

	/*
	* Judge a throw as it happens. Called from Battle's throw observer, when the live Pokemon are in the state the
	* decision was made on. Only the two cooldowns need patching, since by now they include this turn's taps; they come
	* from the snapshot Battle took before anyone decided. Nothing else is touched, so buffs, form, shields and the
	* active Charged Moves are exactly what the engine saw. The Pokemon's own settings are left alone unless
	* options.coachDefaults is set, which uses the same timing-on, farm-off assumptions as the live prompt so the two can't
	* disagree on settings. The Pokemon's Bait Shields setting is never overridden.
	* Returns the engine's answer plus whether it matches what was thrown.
	*/
	function review(poke, opp, move, snapshot, options) {
		var coachDefaults = !!(options && options.coachDefaults);
		var answer = ask(poke, opp, {
			meCooldown: snapshot.cooldowns[poke.index],
			oppCooldown: snapshot.cooldowns[opp.index]
		}, {
			turns: snapshot.turn,
			mode: snapshot.mode,
			queuedFast: snapshot.queuedFast[poke.index],
			coachDefaults: coachDefaults
		});

		answer.thrownIndex = poke.chargedMoves.indexOf(move);
		answer.agrees = answer.action > -1 && answer.action === answer.thrownIndex;
		answer.waitTaps = null;

		// If the engine would have held, how many more Fast Moves until it would throw? (at most 2)
		if (answer.action === -1) {
			answer.waitTaps = tapsUntilThrow(poke, opp, snapshot, 2, coachDefaults);
		}

		return answer;
	}

	/*
	* Ask the engine again after one tap, then two, from the state of a throw that it would have held. Only state is
	* advanced (see projectState); the decision is always the engine's. The cooldowns are put into their post-decision
	* form for the hypothetical tap, and everything is restored afterward.
	*/
	function tapsUntilThrow(poke, opp, snapshot, maxTaps, coachDefaults) {
		var saved = { p: poke.cooldown, o: opp.cooldown };
		var theirCooldownBefore = snapshot.cooldowns[opp.index];

		try {
			// After my tap: my own cooldown is a full Fast Move, and they've either tapped this turn (if they could act) or are still counting down
			poke.cooldown = poke.fastMove.turns * TURN_MS;
			opp.cooldown = theirCooldownBefore === 0 ? opp.fastMove.turns * TURN_MS : theirCooldownBefore;

			for (var taps = 1; taps <= maxTaps; taps++) {
				var future = projectState(poke, opp, taps - 1);

				if (future.meHp <= 0) {
					return null;
				}

				var later = ask(poke, opp, future, {
					turns: snapshot.turn,
					mode: snapshot.mode,
					queuedFast: snapshot.queuedFast[poke.index],
					coachDefaults: !!coachDefaults
				});

				if (later.action > -1) {
					return taps;
				}
			}

			return null;
		} finally {
			poke.cooldown = saved.p;
			opp.cooldown = saved.o;
		}
	}

	/*
	* The state the engine would see at the deciding Pokemon's next action turn, after `taps` more of its own Fast Moves.
	* Only state advances here (cooldowns, energy and HP from Fast Moves registering), never the decision itself.
	* Cooldown values on the Pokemon are the post-decision ones from the latest update, in ms.
	*/
	function projectState(me, opp, taps) {
		var a = me.fastMove.turns;
		var b = opp.fastMove.turns;
		var myCd = me.cooldown / TURN_MS;
		var oppCd = opp.cooldown / TURN_MS;
		var turn = Math.max(1, myCd) + taps * a;
		var oppLandings = TurnMath.landingsBefore(oppCd, b, turn);
		var myLandings = (myCd >= 2 ? 1 : 0) + taps; // a Fast Move in flight, plus each tap, registers before then
		var nextTap = Math.max(oppCd, 1);
		var cd;

		if (nextTap < turn) {
			var lastTap = nextTap + Math.floor((turn - 1 - nextTap) / b) * b;

			cd = Math.max(0, b - (turn - lastTap));
		} else {
			cd = Math.max(0, oppCd - turn);
		}

		return {
			meCooldown: 0,
			meEnergy: Math.min(TurnMath.MAX_ENERGY, me.energy + myLandings * me.fastMove.energyGain),
			meHp: me.hp - oppLandings * safeDamage(opp, me, opp.fastMove),
			oppEnergy: Math.min(TurnMath.MAX_ENERGY, opp.energy + oppLandings * opp.fastMove.energyGain),
			oppHp: opp.hp - myLandings * safeDamage(me, opp, me.fastMove),
			oppCooldown: cd * TURN_MS
		};
	}

	return {
		ask: ask,
		review: review,
		projectState: projectState,
		standInBattle: standInBattle
	};
}));
