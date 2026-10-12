/*
* TimelineAudit - an "Energy & Timing" panel for the Battle page.
*
* Rebuilds both Pokemon's energy over the battle from the simulator's timeline, shows the Fast Move
* count between throws, and grades the timing of every Charged Move. In Sandbox Mode it updates every
* time the timeline is edited, so you can see the cost of throwing on bad timing as you place the moves.
*
* Requires TurnMath, TimingFeedback, and battle.setTrackThrows(true) on the displayed Battle.
*/

var TimelineAudit = (function () {
	var SVG_W = 640;
	var SVG_H = 230;
	var PAD = { left: 34, right: 10, top: 12, bottom: 26 };

	function esc(str) {
		return $("<div>").text(str).html();
	}

	function pluralize(n, word) {
		return TimingFeedback.pluralize(n, word);
	}

	/*
	* Rebuild each Pokemon's energy and Fast Move counts from the timeline.
	* Returns, per actor: points [{turn, energy}], and sequence [{count, move}] where count is
	* the Fast Moves registered before each Charged Move.
	*/
	function analyze(timeline, pokemon) {
		var actors = [0, 1].map(function (i) {
			return {
				energy: pokemon[i].startEnergy,
				points: [{ turn: 0, energy: pokemon[i].startEnergy }],
				sequence: [],
				fastSinceThrow: 0,
				wasted: 0
			};
		});
		var maxTurn = 0;

		timeline.forEach(function (event) {
			var actor = actors[event.actor];

			if (!actor || !event.values) {
				return;
			}

			var isFast = event.type.indexOf("fast") === 0;
			var isCharged = event.type.indexOf("charged") === 0;

			if (!isFast && !isCharged) {
				return;
			}

			var change = event.values[1] || 0;
			var next = actor.energy + change;

			if (next > TurnMath.MAX_ENERGY) {
				actor.wasted += next - TurnMath.MAX_ENERGY;
				next = TurnMath.MAX_ENERGY;
			}

			// Hold the old value until this turn, then step up
			actor.points.push({ turn: event.turn, energy: actor.energy });
			actor.energy = Math.max(0, next);
			actor.points.push({ turn: event.turn, energy: actor.energy, kind: isCharged ? "charged" : "fast", name: event.name });

			if (isFast) {
				actor.fastSinceThrow++;
			} else {
				actor.sequence.push({ count: actor.fastSinceThrow, move: event.name, turn: event.turn });
				actor.fastSinceThrow = 0;
			}

			maxTurn = Math.max(maxTurn, event.turn);
		});

		return { actors: actors, maxTurn: maxTurn };
	}

	// ---------- Chart ----------

	function chart(data, pokemon, graded) {
		var maxTurn = Math.max(data.maxTurn, 10);
		var plotW = SVG_W - PAD.left - PAD.right;
		var plotH = SVG_H - PAD.top - PAD.bottom;

		function x(turn) {
			return PAD.left + (turn / maxTurn) * plotW;
		}

		function y(energy) {
			return PAD.top + plotH - (energy / 100) * plotH;
		}

		var svg = '<svg class="audit-chart" viewBox="0 0 ' + SVG_W + ' ' + SVG_H + '" role="img" aria-label="Energy over time for both Pokemon">';

		// Grid
		[0, 25, 50, 75, 100].forEach(function (e) {
			svg += '<line class="grid" x1="' + PAD.left + '" x2="' + (SVG_W - PAD.right) + '" y1="' + y(e) + '" y2="' + y(e) + '"/>';
			svg += '<text class="axis" x="' + (PAD.left - 6) + '" y="' + (y(e) + 4) + '" text-anchor="end">' + e + '</text>';
		});

		var tickStep = maxTurn > 120 ? 40 : (maxTurn > 60 ? 20 : 10);

		for (var t = 0; t <= maxTurn; t += tickStep) {
			svg += '<text class="axis" x="' + x(t) + '" y="' + (SVG_H - 8) + '" text-anchor="middle">' + t + '</text>';
		}

		svg += '<text class="axis" x="' + (SVG_W - PAD.right) + '" y="' + (SVG_H - 8) + '" text-anchor="end">turn</text>';

		// Your Charged Move costs, as dashed guides
		pokemon[0].chargedMoves.forEach(function (m) {
			svg += '<line class="cost self" x1="' + PAD.left + '" x2="' + (SVG_W - PAD.right) + '" y1="' + y(m.energy) + '" y2="' + y(m.energy) + '"><title>' + esc(m.name) + ' ' + m.energy + '</title></line>';
		});

		// Energy lines
		data.actors.forEach(function (actor, i) {
			var pts = actor.points.map(function (p) {
				return x(p.turn).toFixed(1) + "," + y(p.energy).toFixed(1);
			});

			pts.push(x(maxTurn).toFixed(1) + "," + y(actor.energy).toFixed(1));
			svg += '<polyline class="line ' + (i === 0 ? "self" : "opp") + '" points="' + pts.join(" ") + '"/>';
		});

		// Charged Move markers, colored by timing grade
		graded.forEach(function (t) {
			var actor = data.actors[t.actor];
			var after = null;

			for (var i = 0; i < actor.points.length; i++) {
				var p = actor.points[i];

				if (p.kind === "charged" && p.turn === t.turn) {
					after = p;
					break;
				}
			}

			if (!after) {
				return;
			}

			var css = TimingFeedback.GRADES[t.grade].css;

			svg += '<circle class="marker ' + css + ' actor-' + t.actor + '" cx="' + x(t.turn) + '" cy="' + y(after.energy) + '" r="6"><title>T' + t.turn + ' ' + esc(t.moveName) + ': ' + TimingFeedback.GRADES[t.grade].label + '</title></circle>';
		});

		return svg + '</svg>';
	}

	// ---------- Count sheet ----------

	function countSheet(pokemon) {
		var html = '<table class="audit-table count-sheet"><thead><tr><th>Pokemon</th><th>Charged Move</th><th>Cost</th><th>Fast Moves from 0</th><th>Repeating count</th></tr></thead><tbody>';

		[0, 1].forEach(function (i) {
			var poke = pokemon[i];
			var gain = poke.fastMove.energyGain;

			poke.chargedMoves.forEach(function (move, n) {
				var seq = TurnMath.countSequence(gain, move.energy, 6, 0).map(function (s) { return s.fastMoves; });

				html += '<tr class="' + (i === 0 ? "self" : "opp") + '">' +
					(n === 0 ? '<td rowspan="' + poke.chargedMoves.length + '"><b>' + esc(poke.speciesName) + '</b><br><small>' + esc(poke.fastMove.name) + ' +' + gain + ', ' + poke.fastMove.turns + 't</small></td>' : '') +
					'<td>' + esc(move.name) + '</td><td>' + move.energy + '</td>' +
					'<td>' + TurnMath.fastMovesToReach(0, move.energy, gain) + ' (' + (TurnMath.fastMovesToReach(0, move.energy, gain) * poke.fastMove.turns) + ' turns)</td>' +
					'<td>' + seq.join(", ") + '&hellip;</td></tr>';
			});
		});

		return html + '</tbody></table>';
	}

	function sequenceText(actor, pokemonName) {
		if (actor.sequence.length === 0) {
			return '<b>' + esc(pokemonName) + '</b>: no Charged Moves.';
		}

		var parts = actor.sequence.map(function (s) {
			return s.count + ' &rarr; ' + esc(s.move);
		});

		return '<b>' + esc(pokemonName) + '</b>: ' + parts.join(' &middot; ');
	}

	// ---------- Render ----------

	function render(battle) {
		var $section = $(".timing-audit");

		if (!$section.length) {
			return;
		}

		// Battles that don't record throws (such as the randomized bulk sims) can't be audited
		if (!battle.isTrackingThrows || !battle.isTrackingThrows()) {
			$section.hide();
			return;
		}

		var pokemon = battle.getPokemon();
		var data = analyze(battle.getTimeline(), pokemon);
		var graded = battle.getThrowLog().map(TimingFeedback.grade);
		var summary = TimingFeedback.summarize(graded);
		var $body = $section.find(".audit-body").html("");

		// Headline
		var headline;

		if (summary.you.total === 0) {
			headline = esc(pokemon[0].speciesName) + ' never throws a Charged Move in this battle.';
		} else if (summary.you.freeTurns === 0) {
			headline = 'Every throw by ' + esc(pokemon[0].speciesName) + ' is on clean timing. No free turns given.';
		} else {
			headline = esc(pokemon[0].speciesName) + ' gives ' + esc(pokemon[1].speciesName) + ' <b>' + pluralize(summary.you.freeTurns, "free turn") + '</b> (about +' + summary.you.energy + ' energy, +' + summary.you.damage + ' damage for them) across ' + pluralize(summary.you.total, "throw") + '.';
		}

		$body.append('<p class="audit-headline ' + (summary.you.freeTurns > 0 ? "leaky" : "clean") + '">' + headline + '</p>');

		$body.append(chart(data, pokemon, graded));
		$body.append('<div class="audit-legend"><span class="self">' + esc(pokemon[0].speciesName) + '</span><span class="opp">' + esc(pokemon[1].speciesName) + '</span><span class="dash">dashed lines: your Charged Move costs</span></div>');

		// Counts between throws
		$body.append('<h4>Fast Moves between throws</h4>');
		$body.append('<p class="audit-counts">' + sequenceText(data.actors[0], pokemon[0].speciesName) + '</p>');
		$body.append('<p class="audit-counts">' + sequenceText(data.actors[1], pokemon[1].speciesName) + '</p>');

		// Throw table
		if (graded.length > 0) {
			var table = '<h4>Throw timing</h4><table class="audit-table throws"><thead><tr><th>Turn</th><th>Who</th><th>Move</th><th>Opp. cooldown</th><th>Timing</th><th>Free turns</th></tr></thead><tbody>';

			graded.forEach(function (t) {
				var g = TimingFeedback.GRADES[t.grade];
				var note = TimingFeedback.betterNext(t);
				var label = t.simultaneous ? "Same turn" : g.label;
				var css = t.simultaneous ? "good" : g.css;

				table += '<tr class="' + css + ' actor-' + t.actor + '"><td>' + t.turn + '</td><td>' + esc(t.pokeName) + '</td><td>' + esc(t.moveName) + '</td><td>' + t.rho + '</td>' +
					'<td><span class="chip ' + css + '">' + label + '</span></td><td>' + t.freeTurns + '</td></tr>';

				// Leaky throws always get a row; a clean one only when the simulator would have held anyway
				if ((!t.good || note) && !t.simultaneous) {
					table += '<tr class="explain ' + css + '"><td></td><td colspan="5">' + esc(TimingFeedback.describe(t)) + ' ' + esc(note) + '</td></tr>';
				}
			});

			$body.append(table + '</tbody></table>');
			$body.append('<p class="audit-note">Opp. cooldown is how many turns the other side had left on its Fast Move when the Charged Move was thrown. 1 means it was on its last turn (perfect), 2 costs nothing, and anything higher hands them free turns. The <a href="' + webRoot + 'articles/strategy/guide-to-fast-move-registration/">Fast Move guide</a> predates the 2026 battle system update, so its free-turn counts run one higher than these.</p>');
		}

		$body.append('<h4>Count sheet</h4>');
		$body.append(countSheet(pokemon));

		decorateTimeline(graded);
		$section.show();
	}

	// Ring each Charged Move on the main timeline with its timing grade
	function decorateTimeline(graded) {
		$(".timeline .item").removeClass("audit-perfect audit-good audit-minor audit-bad");

		graded.forEach(function (t) {
			var css = t.simultaneous ? "good" : TimingFeedback.GRADES[t.grade].css;

			$('.timeline .item[actor="' + t.actor + '"][turn="' + t.turn + '"]').filter(function () {
				return $(this).hasClass("charged") || $(this).attr("class").indexOf("charged ") > -1;
			}).addClass("audit-" + css);
		});
	}

	return {
		analyze: analyze,
		render: render
	};
})();
