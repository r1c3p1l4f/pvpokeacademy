/*
* Visuals - small SVG/HTML diagrams for Academy explanations. Pure string builders.
* Every value interpolated is a number the quiz generated, so the output is safe to insert as HTML.
*/

(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('./TurnMath.js'));
	} else {
		root.Visuals = factory(root.TurnMath);
	}
}(typeof self !== 'undefined' ? self : this, function (TurnMath) {

	var CELL = 26;
	var LEFT = 44;
	var ROW = 26;

	function cell(x, y, turn, cls, label) {
		var out = '<rect class="tl-cell ' + cls + '" x="' + x + '" y="' + y + '" width="' + (CELL - 2) + '" height="' + (ROW - 4) + '" rx="3"/>';

		if (label) {
			out += '<text class="tl-glyph" x="' + (x + (CELL - 2) / 2) + '" y="' + (y + 14) + '" text-anchor="middle">' + label + '</text>';
		}

		return out;
	}

	/*
	* Two lanes of Fast Moves with your throw marked, in one-based turns.
	* You tap on turn 1 (as does your opponent) and throw after k Fast Moves.
	*/
	function timingLanes(opts) {
		var a = opts.a;
		var b = opts.b;
		var throwTurn = 1 + a * opts.k;
		var w = TurnMath.syncWindows(a, b, opts.k)[opts.k - 1];
		var total = throwTurn + 3;
		var width = LEFT + total * CELL + 6;
		var height = 3 * ROW + 40;
		var svg = '<svg class="timing-visual" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Fast Move timing diagram">';
		var yMe = 22;
		var yOpp = yMe + ROW + 6;

		svg += '<text class="tl-lane" x="2" y="' + (yMe + 14) + '">You</text><text class="tl-lane" x="2" y="' + (yOpp + 14) + '">Opp</text>';

		for (var t = 1; t <= total; t++) {
			var x = LEFT + (t - 1) * CELL;

			svg += '<text class="tl-axis" x="' + (x + CELL / 2 - 1) + '" y="12" text-anchor="middle">' + t + '</text>';

			// Your lane
			var my;

			if (t < throwTurn) {
				my = ((t - 1) % a === 0) ? "tap" : (((t - 1) % a === a - 1) ? "reg" : "mid");
				if (a === 1) {
					my = "tap reg";
				}
			} else if (t === throwTurn) {
				my = "throw";
			} else if (t === throwTurn + 1) {
				my = "dead";
			} else {
				my = ((t - throwTurn - 2) % a === 0) ? "tap" : "mid";
			}

			svg += cell(x, yMe, t, "me " + my, my === "throw" ? "!" : (my.indexOf("tap") > -1 ? "●" : ""));

			// Opponent lane: their last tap at or before your throw is still in flight
			var lastTap = 1 + Math.floor((throwTurn - 1) / b) * b;
			var opp;

			if (t < lastTap) {
				opp = ((t - 1) % b === 0) ? "tap" : (((t - 1) % b === b - 1) ? "reg" : "mid");
				if (b === 1) {
					opp = "tap reg";
				}
			} else if (t <= lastTap + b - 1) {
				if (t <= throwTurn) {
					opp = (t === lastTap) ? "tap" : (t === lastTap + b - 1 ? "reg" : "mid");
					if (b === 1) {
						opp = "tap reg";
					}
				} else {
					opp = "skipped";
				}
			} else if (t === throwTurn + 2 || ((t - throwTurn - 2) % b === 0 && t > throwTurn + 1)) {
				opp = "tap";
			} else {
				opp = "mid";
			}

			svg += cell(x, yOpp, t, "opp " + opp, opp.indexOf("tap") > -1 ? "●" : (opp === "reg" || opp.indexOf("reg") > -1 ? "■" : ""));
		}

		// Marker on the throw turn
		var mx = LEFT + (throwTurn - 1) * CELL + (CELL - 2) / 2;

		svg += '<line class="tl-throw" x1="' + mx + '" x2="' + mx + '" y1="16" y2="' + (yOpp + ROW) + '"/>';
		svg += '<text class="tl-note" x="' + LEFT + '" y="' + (height - 8) + '">You throw on turn ' + throwTurn + '. Their move has ' + w.rho + ' turn' + (w.rho === 1 ? '' : 's') + ' left: ' +
			(w.freeTurns > 0 ? w.freeTurns + ' free turn' + (w.freeTurns === 1 ? '' : 's') : 'no free turns') + '.</text>';

		return svg + '</svg>' +
			'<div class="tl-key"><span class="k-tap">● tap</span><span class="k-reg">■ registers</span><span class="k-throw">! your throw</span><span class="k-dead">dead turn</span><span class="k-skip">skipped wait</span></div>';
	}

	/*
	* A ladder of Fast Moves building energy toward a Charged Move.
	*/
	function pips(opts) {
		var html = '<div class="pip-row" role="img" aria-label="Energy after each Fast Move">';
		var energy = opts.start || 0;

		html += '<span class="pip start">' + energy + '</span>';

		for (var i = 1; i <= opts.count; i++) {
			energy += opts.gain;
			html += '<span class="pip' + (energy >= opts.cost ? ' ready' : '') + '"><small>+' + opts.gain + '</small>' + energy + '</span>';
		}

		return html + '<span class="pip goal">' + opts.cost + '</span></div>';
	}

	function render(visual) {
		if (!visual) {
			return "";
		}

		if (visual.type === "timing") {
			return timingLanes(visual);
		}

		if (visual.type === "pips") {
			return pips(visual);
		}

		return "";
	}

	return { timingLanes: timingLanes, pips: pips, render: render };
}));
