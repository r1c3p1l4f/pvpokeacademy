/*
* EngineReasons - turns the simulator's own decision log (ActionLogic.logDecision) into plain-language reasons.
*
* The engine explains each decision in a few lines. Some lines are the decision itself ("uses X because it has N turns
* before it is KO'd", "is optimizing move timing") and some are context ("opponent has energy to use X..."). The decisive
* line becomes the headline and the context lines become notes. Where the engine is ambiguous the wording stays
* ambiguous: "KO's or it wants to farm down afterwards" is not resolved into one of the two.
*
* Matching is by phrase, so an upstream rewording would stop a rule matching. Anything unrecognized is simply not
* explained (the caller falls back to a neutral "Hold"), never explained wrongly. tests/academy/enginereasons.test.mjs
* reads every logDecision call in ActionLogic.js and fails if one stops matching a rule, so a change shows up at merge time.
*
* Pure, no dependencies.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
	} else {
		root.EngineReasons = factory();
	}
}(typeof self !== 'undefined' ? self : this, function () {

	// who: "you" for the player's own Pokemon, "they" for the opponent
	function pick(who, you, they) {
		return who === "you" ? you : they;
	}

	function turnsText(n) {
		var count = parseInt(n, 10);

		return isNaN(count) ? n + " turns" : count + " turn" + (count === 1 ? "" : "s");
	}

	/*
	* One rule per kind of line the engine logs.
	*   id       - stable name
	*   test     - phrase to match
	*   role     - "decision" (what it chose), "context" (why it matters), or "internal" (debug, never shown)
	*   hold     - for decisions: true if it means keep tapping
	*   text     - (who, match) -> sentence
	*/
	var RULES = [
		{
			id: "survive-hold", role: "decision", hold: true,
			test: /uses a fast move because it has (.+?) turn\(s\) before it is KO'd but has no energy/,
			text: function (who, m) {
				return pick(who, "You could be knocked out in " + turnsText(m[1]) + " but have no Charged Move ready, so keep tapping.",
					"They could be knocked out in " + turnsText(m[1]) + " but have no Charged Move ready.");
			}
		},
		{
			id: "survive-throw", role: "decision", hold: false,
			test: /uses (?!a fast move)(.+?) because it has (.+?) turn\(s\) before it is KO'd/,
			text: function (who, m) {
				return pick(who, "Throw " + m[1] + " now: you'd be knocked out in " + turnsText(m[2]) + " otherwise.",
					"They threw " + m[1] + " now: they'd be knocked out in " + turnsText(m[2]) + " otherwise.");
			}
		},
		{
			id: "break-ability", role: "decision", hold: false,
			test: /uses (.+?) to break opponent's ability as soon as possible/,
			text: function (who, m) {
				return pick(who, "Throw " + m[1] + " right away to break their ability.", "They threw " + m[1] + " right away to break your ability.");
			}
		},
		{
			id: "timing", role: "decision", hold: true,
			test: /is optimizing move timing/,
			text: function (who) {
				return pick(who, "Waiting for better timing: throwing now would hand them free turns.", "They're waiting for better timing.");
			}
		},
		{
			id: "form-change", role: "decision", hold: false,
			test: /uses (.+?) to trigger form change as soon as possible/,
			text: function (who, m) {
				return pick(who, "Throw " + m[1] + " to trigger the form change.", "They threw " + m[1] + " to trigger a form change.");
			}
		},
		{
			id: "form-energy", role: "decision", hold: true,
			test: /wants to gain as much energy as possible before changing form/,
			text: function (who) {
				return pick(who, "Building energy before changing form.", "They're building energy before changing form.");
			}
		},
		{
			id: "force-boost", role: "decision", hold: false,
			test: /will force throw a boost move/,
			text: function (who) {
				return pick(who, "Throwing the stat-boosting move now.", "They're forcing a stat-boosting move.");
			}
		},
		{
			id: "plan", role: "decision", hold: false,
			test: /uses (.+?) because it thinks that using (.+?) moves? afterwards is the best plan/,
			text: function (who, m, extra) {
				var rest = extra && extra.length ? ", then " + extra.join(", then ") : "";

				return pick(who, "Throw " + m[1] + " now as part of a plan: " + m[1] + rest + ".", "They threw " + m[1] + " as part of a plan: " + m[1] + rest + ".");
			}
		},
		{
			id: "ko-or-farm", role: "decision", hold: false,
			test: /uses (.+?) at turn (.+?) because it KO's or it wants to farm down afterwards/,
			text: function (who, m) {
				// The engine doesn't say which of the two applied, so neither does this
				return pick(who, "Throw " + m[1] + ": it knocks them out, or sets up a farm-down afterwards.", "They threw " + m[1] + ": it knocks you out, or sets up a farm-down.");
			}
		},
		{
			id: "saving", role: "decision", hold: true,
			test: /uses a fast move because it has no energy for (.+)/,
			text: function (who, m) {
				return pick(who, "Keep tapping: building up to " + m[1] + ", the move the plan wants.", "They're building up to " + m[1] + ".");
			}
		},
		{
			id: "plan-step", role: "context",
			test: /wants to use (.+?) after it uses (.+)/,
			text: function () { return ""; }
		},
		{
			id: "boost-plan", role: "context",
			test: /changes its plan because it needs the BOOST to win or debuff/,
			text: function (who) {
				return pick(who, "The plan changed: it needs the stat boost or debuff to win this matchup.", "Their plan changed: they need the stat boost or debuff to win.");
			}
		},
		{
			id: "farm-down", role: "context",
			test: /wants to farm down/,
			text: function (who) {
				return pick(who, "The plan is to farm down: keep tapping to build energy before throwing.", "They plan to farm down: tapping to build energy.");
			}
		},
		{
			id: "bait", role: "context",
			test: /doesn't use (.+?) because it wants to bait/,
			text: function (who, m) {
				return pick(who, "Not throwing " + m[1] + " yet: baiting a shield with the cheaper move first (your Bait Shields setting).",
					"They're not throwing " + m[1] + " yet: baiting a shield with the cheaper move first.");
			}
		},
		{
			id: "debuff-defer", role: "context",
			test: /is deferring its self debuffing move until after the opponent fires its move/,
			text: function (who) {
				return pick(who, "Holding the self-debuffing move until after theirs.", "They're holding a self-debuffing move until after yours.");
			}
		},
		{
			id: "debuff-stack", role: "context",
			test: /doesn't use (.+?) because it wants to minimize time debuffed and it can stack the move (.+?) times/,
			text: function (who, m) {
				return pick(who, "Not throwing " + m[1] + " yet: it keeps you debuffed for less time, and it could stack " + m[2] + " times.",
					"They're not throwing " + m[1] + " yet, to spend less time debuffed.");
			}
		},
		{
			id: "threat", role: "context",
			test: /opponent has energy to use (.+?) and it would do (.+?) damage\. I have (.+?) turn\(s\) to live/,
			text: function (who, m) {
				return pick(who, "They could throw " + m[1] + " for " + m[2] + " damage, and you have " + turnsText(m[3]) + " to live.",
					"You could throw " + m[1] + " for " + m[2] + " damage, and they have " + turnsText(m[3]) + " to live.");
			}
		},
		{ id: "turns-to-live", role: "internal", test: /^has (.+?) turns to live$/ },
		{ id: "loop", role: "internal", test: /considered too many states, likely an infinite loop/ }
	];

	// A few words for the banner on the battle window, by rule. Internal rules never show.
	var SHORTS = {
		"survive-hold": function () { return "no energy yet"; },
		"survive-throw": function () { return "survival"; },
		"break-ability": function () { return "break ability"; },
		"timing": function () { return "better timing"; },
		"form-change": function () { return "form change"; },
		"form-energy": function () { return "energy before form"; },
		"force-boost": function () { return "boost move"; },
		"plan": function (m, extra) { return "plan: " + m[1] + (extra && extra.length ? " then " + extra[0] : ""); },
		"ko-or-farm": function () { return "KO or farm-down"; },
		"saving": function (m) { return "building to " + m[1]; },
		"boost-plan": function () { return "needs the boost"; },
		"farm-down": function () { return "farming"; },
		"bait": function () { return "baiting a shield"; },
		"debuff-defer": function () { return "debuff plan"; },
		"debuff-stack": function () { return "debuff plan"; }
	};

	RULES.forEach(function (rule) {
		if (rule.role !== "internal" && rule.id !== "plan-step" && rule.id !== "threat") {
			if (!SHORTS[rule.id]) {
				throw new Error("EngineReasons: rule " + rule.id + " has no short wording");
			}

			rule.short = SHORTS[rule.id];
		}
	});

	function match(line) {
		for (var i = 0; i < RULES.length; i++) {
			var m = RULES[i].test.exec(line);

			if (m) {
				return { rule: RULES[i], m: m };
			}
		}

		return null;
	}

	/*
	* Explain a decision from the lines the engine logged for it.
	*   reasons - the log lines
	*   who     - "you" or "they"
	* Returns {short, headline, hold, notes, kinds, unknown}:
	*   short    - a few words for the banner
	*   headline - sentence for the decision itself, or "" if nothing decisive was logged
	*   hold     - true if the decision is to keep tapping, false if it's a throw, null if unknown
	*   notes    - context sentences, in the order the engine gave them, without repeats
	*   kinds    - the ids of the rules that matched, for styling and tests
	*   unknown  - lines nothing matched (the guard test keeps this empty for the engine's real wording)
	*/
	function explain(reasons, who) {
		var matched = [];
		var unknown = [];
		var planSteps = [];

		(reasons || []).forEach(function (line) {
			var hit = match(line);

			if (!hit) {
				unknown.push(line);
				return;
			}

			if (hit.rule.id === "plan-step") {
				if (planSteps.length === 0) {
					planSteps.push(hit.m[2]);
				}

				planSteps.push(hit.m[1]);
				return;
			}

			matched.push(hit);
		});

		// The engine lists a plan as "uses X ... best plan" then "wants to use Y after it uses X", "wants to use Z after it uses Y"
		var extra = planSteps.slice(1);
		var decisions = matched.filter(function (h) { return h.rule.role === "decision"; });
		var final = decisions.length ? decisions[decisions.length - 1] : null; // the last decisive line is the engine's final choice
		var notes = [];
		var seen = {};

		matched.forEach(function (h) {
			if (h.rule.role !== "context" || seen[h.rule.id]) {
				return;
			}

			seen[h.rule.id] = true;

			var text = h.rule.text(who, h.m);

			if (text) {
				notes.push({ id: h.rule.id, text: text });
			}
		});

		// Banner wording: the decisive reason, else the first context reason that has one
		var short = "";

		if (final && final.rule.short) {
			short = final.rule.short(final.m, final.rule.id === "plan" ? extra : null);
		} else {
			matched.some(function (h) {
				if (h.rule.role === "context" && h.rule.short) {
					short = h.rule.short(h.m);
					return true;
				}

				return false;
			});
		}

		return {
			short: short,
			headline: final ? final.rule.text(who, final.m, final.rule.id === "plan" ? extra : null) : "",
			headlineId: final ? final.rule.id : null,
			hold: final ? !!final.rule.hold : null,
			notes: notes,
			kinds: matched.map(function (h) { return h.rule.id; }),
			unknown: unknown
		};
	}

	return {
		RULES: RULES,
		match: match,
		explain: explain
	};
}));
