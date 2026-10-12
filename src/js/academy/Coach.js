/*
* Coach - live fast move counting, energy tracking and throw timing feedback for Training Battles.
*
* Modes (chosen on the Train setup page, changeable mid-battle):
*   learn  - both Pokemon's energy, Fast Move counters, and a "throw now / tap again" prompt
*   count  - your energy plus a raw count of the opponent's taps. No energy shown, no prompts. Count it yourself!
*   review - nothing live. Throws are graded and summarised on the end screen.
*   off    - Coach disabled
*
* In every mode except off, each Charged Move is graded when it's thrown and a Timing tab is added to the end screen.
*
* Depends on TurnMath.js and the throw log in Battle.js (battle.setTrackThrows).
*/

var Coach = (function () {
	var MODES = {
		learn: "Learn: show everything",
		count: "Count: your energy + opponent taps",
		review: "Review: feedback after throws",
		off: "Off"
	};

	var STORAGE_KEY = "academy.coachMode";
	var DEFAULT_MODE = "learn";

	var GRADES = TimingFeedback.GRADES;

	var battle = null;
	var mode = DEFAULT_MODE;
	var panel = null;
	var active = false;

	var logIndex = 0; // How much of the battle's throw log has been processed
	var throws = []; // Graded throws, both players
	var taps = [0, 0]; // Fast Moves tapped since each side's last Charged Move
	var species = [null, null];
	var fullEnergyTurns = 0;
	var lastTurn = 0;
	var latestAdvice = null;
	var toast = null; // {text, css, until} shown briefly in the banner after you throw
	var collapsed = loadCollapsed();

	// ---------- Settings ----------

	function loadMode() {
		try {
			var saved = window.localStorage.getItem(STORAGE_KEY);

			if (saved && MODES[saved]) {
				return saved;
			}
		} catch (e) {
			// Storage can be blocked, fall back to the default
		}

		return DEFAULT_MODE;
	}

	function saveMode(value) {
		try {
			window.localStorage.setItem(STORAGE_KEY, value);
		} catch (e) {
			// Ignore
		}
	}

	function setMode(value) {
		if (!MODES[value]) {
			return;
		}

		mode = value;
		saveMode(value);

		if (battle) {
			battle.setTrackThrows(mode !== "off");
		}

		if (panel) {
			panel.attr("data-mode", mode);
			panel.find(".coach-mode-switch").val(mode);
			render();
		}
	}

	function loadCollapsed() {
		try {
			return window.localStorage.getItem("academy.coachCollapsed") !== "0";
		} catch (e) {
			return true;
		}
	}

	function saveCollapsed(value) {
		try {
			window.localStorage.setItem("academy.coachCollapsed", value ? "1" : "0");
		} catch (e) {
			// Ignore
		}
	}

	// Fill a select with the coach options and keep it synced with the saved choice
	function populateModeSelect($select) {
		$select.html("");

		Object.keys(MODES).forEach(function (key) {
			$select.append($("<option>").attr("value", key).text(MODES[key]));
		});

		$select.val(mode);
	}

	// ---------- Helpers ----------

	function safeDamage(attacker, defender, move) {
		try {
			return DamageCalculator.damage(attacker, defender, move);
		} catch (e) {
			return move.damage || 0;
		}
	}

	var pluralize = TimingFeedback.pluralize;

	function esc(str) {
		return $("<div>").text(str).html();
	}

	// ---------- Live advice ----------

	/*
	* The prompts come from the engine itself: ActionLogic.decideAction, the same function that decides when the Battle
	* page's simulated Pokemon throw, including its timing optimizer and its KO, energy cap and opponent-burst checks.
	* The coach adds no policy of its own. All it does is hand the engine the state it would see at your next action turn.
	*
	* The engine reads cooldown, energy and HP off the Pokemon, so those are set to their projected values for the call
	* and restored in a finally block. The call is synchronous, so the battle loop can't run in between.
	*/

	var engineWarned = false;

	// What the engine would see at the turn you next act, after `taps` more Fast Moves of yours.
	// Only state is advanced here (cooldowns, energy, HP from Fast Moves registering), never the decision.
	function projectState(me, opp, taps) {
		var a = me.fastMove.turns;
		var b = opp.fastMove.turns;
		var myCd = me.cooldown / TurnMath.TURN_MS;
		var oppCd = opp.cooldown / TurnMath.TURN_MS;
		var turn = Math.max(1, myCd) + taps * a; // turns from now until that decision
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
			meEnergy: Math.min(TurnMath.MAX_ENERGY, me.energy + myLandings * me.fastMove.energyGain),
			meHp: me.hp - oppLandings * safeDamage(opp, me, opp.fastMove),
			oppEnergy: Math.min(TurnMath.MAX_ENERGY, opp.energy + oppLandings * opp.fastMove.energyGain),
			oppHp: opp.hp - myLandings * safeDamage(me, opp, me.fastMove),
			oppCooldown: cd * TurnMath.TURN_MS
		};
	}

	// Ask the engine what it would do, and why. Returns {action, reasons} where action is a Charged Move index or -1 to tap.
	function askEngine(me, opp, state) {
		var saved = {
			me: { cooldown: me.cooldown, energy: me.energy, hp: me.hp, timing: me.optimizeMoveTiming, farm: me.farmEnergy },
			opp: { cooldown: opp.cooldown, energy: opp.energy, hp: opp.hp }
		};

		try {
			me.cooldown = 0;
			me.energy = state.meEnergy;
			me.hp = Math.max(1, state.meHp);
			me.optimizeMoveTiming = true; // the coach always asks for the engine's best timing
			me.farmEnergy = false;
			opp.cooldown = state.oppCooldown;
			opp.energy = state.oppEnergy;
			opp.hp = Math.max(1, state.oppHp);

			var run = battle.withDecisionLog(function () {
				return ActionLogic.decideAction(battle, me, opp);
			});

			return {
				action: run.result && run.result.type === "charged" ? run.result.value : -1,
				reasons: run.entries.map(function (e) { return e.string.trim(); })
			};
		} finally {
			me.cooldown = saved.me.cooldown;
			me.energy = saved.me.energy;
			me.hp = saved.me.hp;
			me.optimizeMoveTiming = saved.me.timing;
			me.farmEnergy = saved.me.farm;
			opp.cooldown = saved.opp.cooldown;
			opp.energy = saved.opp.energy;
			opp.hp = saved.opp.hp;
		}
	}

	/*
	* Why the engine is holding a throw, from its own decision log. The wording is matched loosely and anything
	* unrecognized stays neutral, so a change in upstream's phrasing degrades to "Hold", never to a wrong reason.
	*   kind   - timing / saving / farm / bait / debuff / other
	*   phrase - for the panel sentence ("The simulator is ...")
	*   short  - for the banner
	*/
	function classifyHold(reasons) {
		var text = reasons.join(" | ");
		var saving = /uses a fast move because it has no energy for ([^|]+)/.exec(text);

		if (/optimizing move timing/.test(text)) {
			return { kind: "timing", phrase: "waiting for better timing", short: "better timing" };
		}

		if (saving) {
			return { kind: "saving", phrase: "saving energy for " + saving[1].trim(), short: "saving for " + saving[1].trim() };
		}

		if (/wants to farm down/.test(text)) {
			return { kind: "farm", phrase: "farming energy before it throws", short: "farming energy" };
		}

		if (/wants to bait/.test(text)) {
			return { kind: "bait", phrase: "baiting a shield first", short: "baiting a shield" };
		}

		if (/self debuffing|minimize time debuffed/.test(text)) {
			return { kind: "debuff", phrase: "holding a self-debuffing move", short: "debuff plan" };
		}

		return { kind: "other", phrase: "", short: "keep tapping" };
	}

	/*
	* One advice state feeds the panel text, the banner, and the button ring and badge, so they can't disagree.
	*   css    - go / wait
	*   text   - sentence for the panel (HTML)
	*   short  - a few words for the banner
	*   badge  - "GO", the number of Fast Moves to tap first (1 or 2), or "HOLD"
	*   button - index of the Charged Move to throw, or -1
	* Returns null when there's nothing to say or the engine can't be asked.
	*/
	function computeAdvice(me, opp) {
		var cost = me.chargedMoves.reduce(function (lo, m) { return Math.min(lo, m.energy); }, TurnMath.MAX_ENERGY);

		if (me.energy < cost && me.energy + me.fastMove.energyGain * 2 < cost) {
			return null; // nothing to throw soon, the buttons' counts already say how far off it is
		}

		try {
			var proj = [projectState(me, opp, 0)];
			var now = askEngine(me, opp, proj[0]);

			if (now.action > -1) {
				var move = me.chargedMoves[now.action];

				return {
					css: "go",
					text: "Throw <b>" + esc(move.name) + "</b>. The simulator's own logic would throw here.",
					short: "Throw " + move.name,
					badge: "GO",
					button: now.action,
					source: "engine",
					kind: "go",
					taps: 0,
					proj: proj
				};
			}

			if (me.energy < cost) {
				return null;
			}

			// The engine is holding the throw. Look ahead (at most 2 of your own Fast Moves) for when it would throw.
			var why = classifyHold(now.reasons);

			for (var taps = 1; taps <= 2; taps++) {
				var future = projectState(me, opp, taps);

				proj.push(future);

				if (future.meHp <= 0) {
					break;
				}

				var later = askEngine(me, opp, future);

				if (later.action > -1) {
					return {
						css: "wait",
						text: "Tap <b>" + esc(me.fastMove.name) + "</b> " + pluralize(taps, "more time") + ", then throw <b>" + esc(me.chargedMoves[later.action].name) + "</b>." + (why.phrase ? " The simulator is " + why.phrase + "." : ""),
						short: "Tap " + taps + " more, then throw",
						badge: String(taps),
						button: later.action,
						source: "engine",
						kind: why.kind,
						taps: taps,
						proj: proj
					};
				}
			}

			return {
				css: "wait",
				text: "Hold. Keep tapping" + (why.phrase ? ": the simulator is " + why.phrase : "") + ".",
				short: "Hold: " + why.short,
				badge: "HOLD",
				button: -1,
				source: "engine",
				kind: why.kind,
				taps: null,
				proj: proj
			};
		} catch (e) {
			if (!engineWarned) {
				engineWarned = true;
				console.error("Coach: could not ask the engine for advice", e);
			}

			return null;
		}
	}

	// ---------- Throw grading ----------

	// ---------- Rendering ----------

	function buildPanel() {
		var $panel = $(
			'<div class="coach-panel">' +
				'<div class="coach-header">' +
					'<span class="coach-title">Coach</span>' +
					'<select class="coach-mode-switch" aria-label="Coach mode"></select>' +
					'<span class="coach-turn"></span>' +
					'<button type="button" class="coach-toggle" aria-expanded="false">Details</button>' +
				'</div>' +
				'<div class="coach-advice"></div>' +
				'<div class="coach-side self"></div>' +
				'<div class="coach-side opp"></div>' +
				'<ul class="coach-log"></ul>' +
			'</div>'
		);

		populateModeSelect($panel.find(".coach-mode-switch"));
		$panel.find(".coach-mode-switch").on("change", function () {
			setMode($(this).val());
		});

		$panel.find(".coach-toggle").on("click", function () {
			collapsed = !collapsed;
			saveCollapsed(collapsed);
			applyCollapsed();
		});

		// Don't let panel clicks reach the battle window's tap handler
		$panel.on("click mousedown mouseup touchstart touchend", function (e) {
			e.stopPropagation();
		});

		return $panel;
	}

	function energyBar(poke, label) {
		var pct = Math.min(poke.energy, 100);
		var ticks = "";

		poke.chargedMoves.forEach(function (m) {
			ticks += '<span class="tick" style="left:' + Math.min(m.energy, 100) + '%" title="' + esc(m.name) + ' ' + m.energy + '"></span>';
		});

		return '<div class="energy-row"><span class="label">' + label + '</span>' +
			'<div class="energy-bar"><div class="fill" style="width:' + pct + '%"></div>' + ticks + '</div>' +
			'<span class="value">' + Math.floor(poke.energy) + '</span></div>';
	}

	function counters(poke) {
		var gain = poke.fastMove.energyGain;
		var html = '<div class="counter-list">';

		poke.chargedMoves.forEach(function (m) {
			var needed = TurnMath.fastMovesToReach(poke.energy, m.energy, gain);

			if (needed === 0) {
				html += '<span class="counter ready ' + m.type + '"><b>' + esc(m.name) + '</b> ' + m.energy + ' &#10003;</span>';
			} else {
				html += '<span class="counter ' + m.type + '"><b>' + esc(m.name) + '</b> ' + m.energy + ' &middot; ' + pluralize(needed, "Fast Move") + ' (' + (needed * poke.fastMove.turns) + 't)</span>';
			}
		});

		return html + '</div>';
	}

	function sideHtml(poke, who, showEnergy) {
		var header = '<div class="side-title">' + esc(poke.speciesName) + ' <small>' + esc(poke.fastMove.name) + ' +' + poke.fastMove.energyGain + ' / ' + poke.fastMove.turns + ' turn' + (poke.fastMove.turns === 1 ? "" : "s") + '</small></div>';

		if (!showEnergy) {
			return header + '<div class="tap-count">Taps since their last Charged Move: <b>' + taps[1] + '</b></div>';
		}

		return header + energyBar(poke, who) + counters(poke);
	}

	function applyCollapsed() {
		if (!panel) {
			return;
		}

		// Review mode has no overlay, so the panel is its only display and stays open
		var isCollapsed = collapsed && mode !== "review";

		panel.toggleClass("collapsed", isCollapsed);
		panel.find(".coach-toggle").attr("aria-expanded", isCollapsed ? "false" : "true").text(isCollapsed ? "Details" : "Hide").toggle(mode !== "review");
	}

	// ---------- On-window overlay ----------

	/*
	* Information that matters while tapping sits on the battle window itself. Every element is click-through
	* (pointer-events: none in CSS), so the window's own tap handling is untouched. The recommended Charged Move gets
	* a class on the game's own button instead of an element laid over it.
	*/
	function buildOverlay() {
		$(".coach-overlay").remove();

		$(".battle-window").append('<div class="coach-overlay coach-banner" aria-live="off"></div>');

		var $oppHp = $(".battle-window .pokemon-container.opponent .hp");

		$oppHp.append('<div class="coach-overlay coach-opp-energy"><div class="fill"></div><span class="value"></span></div>');
		$oppHp.append('<div class="coach-overlay coach-opp-taps"></div>');

		$(".battle-window .controls .move-bar").each(function () {
			$(this).append('<span class="coach-overlay coach-btn-count"></span>');
			$(this).append('<span class="coach-overlay coach-badge"></span>');
		});
	}

	function renderOverlay(me, opp) {
		var $win = $(".battle-window");

		$win.attr("data-coach", mode);

		if (mode === "off" || mode === "review") {
			return;
		}

		// Banner: a throw result for a few seconds, otherwise the advice or the next count
		var banner = null;

		if (toast && Date.now() < toast.until) {
			banner = { css: toast.css, text: toast.text };
		} else if (mode === "learn") {
			if (latestAdvice) {
				banner = { css: latestAdvice.css, text: latestAdvice.short };
			} else {
				var next = me.chargedMoves.reduce(function (best, m) {
					var n = TurnMath.fastMovesToReach(me.energy, m.energy, me.fastMove.energyGain);

					return (!best || n < best.n) ? { n: n, name: m.name } : best;
				}, null);

				banner = next ? { css: "idle", text: next.name + " in " + pluralize(next.n, "tap") } : null;
			}
		}

		$win.find(".coach-banner").attr("data-state", banner ? banner.css : "").text(banner ? banner.text : "");

		// Opponent: exact energy in Learn, only a tap count in Count
		var oppCosts = opp.chargedMoves.map(function (m) { return m.energy; });
		var $energy = $win.find(".coach-opp-energy");

		if (mode === "learn") {
			var $fill = $energy.find(".fill").css("width", Math.min(opp.energy, 100) + "%");

			$energy.find(".tick").remove();
			oppCosts.forEach(function (cost) {
				var $tick = $('<span class="tick"></span>').css("left", Math.min(cost, 100) + "%");

				$tick.toggleClass("reached", opp.energy >= cost);
				$energy.append($tick);
			});
			$energy.find(".value").text(Math.floor(opp.energy));
			$fill.toggleClass("full", oppCosts.some(function (cost) { return opp.energy >= cost; }));
			$win.find(".coach-opp-taps").text("");
		} else {
			$energy.find(".value").text("");
			$win.find(".coach-opp-taps").text("taps " + taps[1]);
		}

		// Buttons: Fast Moves to ready (Learn only) and the recommended throw
		var $bars = $win.find(".controls .move-bar");

		$bars.removeClass("coach-rec go wait warn");
		$bars.find(".coach-btn-count, .coach-badge").text("");

		if (mode !== "learn") {
			return;
		}

		me.chargedMoves.forEach(function (m, i) {
			var n = TurnMath.fastMovesToReach(me.energy, m.energy, me.fastMove.energyGain);

			$bars.eq(i).find(".coach-btn-count").text(n === 0 ? "\u2713" : n);
		});

		if (latestAdvice && latestAdvice.button > -1) {
			var $rec = $bars.eq(latestAdvice.button);

			$rec.addClass("coach-rec " + latestAdvice.css);
			$rec.find(".coach-badge").text(latestAdvice.badge);
		}
	}

	function render() {
		if (!panel || !active) {
			return;
		}

		panel.attr("data-mode", mode);

		var poke = battle.getPokemon();

		if (!poke[0] || !poke[1] || mode === "off") {
			$(".battle-window").attr("data-coach", "off");
			panel.hide();
			return;
		}

		// The header always shows the numbers that matter most, so they stay visible on short phone screens
		var glance = "";

		if (mode === "learn") {
			glance = "You " + Math.floor(poke[0].energy) + " \u00B7 Opp " + Math.floor(poke[1].energy);
		} else if (mode === "count") {
			glance = "You " + Math.floor(poke[0].energy) + " \u00B7 Opp taps " + taps[1];
		} else if (lastTurn) {
			glance = "Turn " + lastTurn;
		}

		panel.find(".coach-turn").text(glance).attr("title", lastTurn ? "Turn " + lastTurn : "");
		applyCollapsed();
		renderOverlay(poke[0], poke[1]);

		panel.show();

		var showLive = (mode === "learn" || mode === "count");
		panel.find(".coach-side, .coach-advice").toggle(showLive);

		if (showLive) {
			panel.find(".coach-side.self").html(sideHtml(poke[0], "You", true));
			panel.find(".coach-side.opp").html(sideHtml(poke[1], "Opp", mode === "learn"));

			var $advice = panel.find(".coach-advice");

			if (mode === "learn" && latestAdvice) {
				$advice.attr("class", "coach-advice " + latestAdvice.css).html(latestAdvice.text).show();
			} else if (mode === "learn") {
				$advice.attr("class", "coach-advice idle").html("Keep tapping. Count your Fast Moves to your next Charged Move.").show();
			} else {
				$advice.hide();
			}
		}

		// Log of throws, newest first
		var $log = panel.find(".coach-log").html("");

		throws.slice(-6).reverse().forEach(function (t) {
			var g = GRADES[t.grade];
			var $item = $('<li class="' + g.css + ' actor-' + t.actor + '"></li>');

			$item.append('<span class="icon">' + g.icon + '</span>');
			$item.append($('<span class="text"></span>').html('<small>T' + t.turn + '</small> ' + esc(TimingFeedback.describe(t)) + ' ' + esc(TimingFeedback.betterNext(t))));
			$log.append($item);
		});
	}

	// ---------- Battle hooks ----------

	function start(b, players) {
		battle = b;

		// The saved choice is the single source of truth: the setup page and the in-battle switch both write to it
		mode = loadMode();

		throws = [];
		logIndex = 0;
		taps = [0, 0];
		species = [null, null];
		fullEnergyTurns = 0;
		lastTurn = 0;
		latestAdvice = null;
		active = true;

		battle.setTrackThrows(mode !== "off");

		toast = null;
		buildOverlay();

		if (!panel) {
			panel = buildPanel();
			panel.insertAfter($(".battle-window"));
		}

		populateModeSelect(panel.find(".coach-mode-switch"));
		panel.attr("data-mode", mode);
		panel.find(".coach-log").html("");
		render();
	}

	/*
	* Called by the battle interface on every turn update.
	*/
	function update(response) {
		if (!active || !battle) {
			return;
		}

		lastTurn = response.turn;

		// Count each side's taps and reset on a switch
		for (var i = 0; i < 2; i++) {
			if (species[i] !== response.pokemon[i]) {
				species[i] = response.pokemon[i];
				taps[i] = 0;
				latestAdvice = null;
			}
		}

		(response.animations || []).forEach(function (anim) {
			if (anim.type === "fast") {
				taps[anim.actor]++;
			}
		});

		// Grade any new Charged Moves
		var log = battle.getThrowLog();

		while (logIndex < log.length) {
			var graded = TimingFeedback.grade(log[logIndex++]);

			throws.push(graded);
			taps[graded.actor] = 0;

			if (graded.actor === 0) {
				toast = throwToast(graded);
			}
		}

		var me = response.pokemon[0];
		var opp = response.pokemon[1];

		if (response.phase === "neutral" && me.energy >= TurnMath.MAX_ENERGY && me.hp > 0) {
			fullEnergyTurns++;
		}

		// Ask the engine only at your own action boundaries, when you can act on the next turn. Between them the answer
		// holds, so the prompt and the tap countdown change when you tap, not every 500 ms.
		if (response.phase !== "neutral" || me.hp <= 0 || opp.hp <= 0) {
			latestAdvice = null;
		} else if (me.cooldown <= TurnMath.TURN_MS || !latestAdvice) {
			latestAdvice = computeAdvice(me, opp);
		}

		render();
	}

	// A few words about the throw you just made, for the banner
	function throwToast(t) {
		var g = TimingFeedback.GRADES[t.grade];
		var text = g.icon + " " + g.label;

		if (t.simultaneous) {
			text = "Same turn as theirs";
		} else if (t.freeTurns > 0) {
			text = g.icon + " " + g.label + ": " + pluralize(t.freeTurns, "free turn");
		}

		return { text: text, css: t.simultaneous ? "good" : g.css, until: Date.now() + 3500 };
	}

	function stop() {
		active = false;
		$(".battle-window").attr("data-coach", "off");

		if (panel) {
			panel.hide();
		}
	}

	// ---------- End of battle report ----------

	function summarize() {
		var result = TimingFeedback.summarize(throws);

		result.fullEnergyTurns = fullEnergyTurns;

		return result;
	}

	function renderReport($container) {
		if (!$container || !$container.length) {
			return;
		}

		if (!active && throws.length === 0) {
			$container.html('<p class="description">Turn the Coach on in the Train settings to see timing feedback.</p>');
			return;
		}

		var s = summarize();
		var html = '<p class="description">Each Charged Move is graded by how many turns of cooldown the other side had left. Throwing on the last turn of their Fast Move gives them no free turns.</p>';

		if (s.you.total === 0) {
			html += '<p>You didn\'t throw any Charged Moves this battle.</p>';
		} else {
			html += '<div class="timing-summary">' +
				'<div class="stat"><b>' + s.you.clean + ' / ' + s.you.total + '</b><span>clean throws</span></div>' +
				'<div class="stat"><b>' + s.you.freeTurns + '</b><span>free turns given</span></div>' +
				'<div class="stat"><b>+' + s.you.energy + '</b><span>energy they gained from it</span></div>' +
				'<div class="stat"><b>+' + s.you.damage + '</b><span>damage they gained from it</span></div>' +
				'</div>';

			if (s.you.counts.sneak > 0) {
				html += '<p class="tip-line bad">You were sneaked ' + pluralize(s.you.counts.sneak, "time") + '. When your opponent just tapped a long Fast Move, wait for its last turn before throwing.</p>';
			}
		}

		if (s.fullEnergyTurns > 4) {
			html += '<p class="tip-line minor">You sat at full energy for ' + (s.fullEnergyTurns / 2) + ' seconds. Energy past 100 is wasted, so throw before you cap.</p>';
		}

		if (s.opp.total > 0) {
			html += '<p class="opp-line">Opponent: ' + s.opp.clean + ' / ' + s.opp.total + ' clean throws, gave you ' + s.opp.freeTurns + ' free turn' + (s.opp.freeTurns === 1 ? '' : 's') + '.</p>';
		}

		html += '<ul class="coach-log full">';

		throws.forEach(function (t) {
			var g = GRADES[t.grade];

			html += '<li class="' + g.css + ' actor-' + t.actor + '"><span class="icon">' + g.icon + '</span><span class="text"><small>T' + t.turn + ' ' + (t.actor === 0 ? 'You' : 'Opp') + '</small> ' + esc(TimingFeedback.describe(t)) + ' ' + esc(TimingFeedback.betterNext(t)) + '</span></li>';
		});

		html += '</ul>';

		$container.html(html);
	}

	mode = loadMode();

	return {
		MODES: MODES,
		start: start,
		update: update,
		stop: stop,
		setMode: setMode,
		getMode: function () { return mode; },
		loadMode: loadMode,
		populateModeSelect: populateModeSelect,
		renderReport: renderReport,
		summarize: summarize,
		getThrows: function () { return throws; },
		getAdvice: function () { return latestAdvice; }
	};
})();
