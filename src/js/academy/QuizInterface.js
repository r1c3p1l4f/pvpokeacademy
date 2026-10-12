/*
* Interface for the Academy page: quiz, flashcards and progress.
*/

var InterfaceMaster = (function () {
	var instance;

	function createInstance() {
		var object = new interfaceObject();

		function interfaceObject() {
			var self = this;
			var gm = GameMaster.getInstance();

			var SETTINGS_KEY = "academy.settings";
			var defaults = { league: 1500, level: 2, length: 10, categories: ["count", "history", "timing", "swap"], mode: "quiz", weakOnly: false };
			var settings = $.extend({}, defaults);

			var pool = null;
			var swapReady = false;
			var rng = QuizEngine.createRng();
			var progress;
			var question = null;
			var answered = false;
			var round = null;
			var loadToken = 0;

			// Read-only access to the current question, used by the UI tests
			this.getQuestion = function () {
				return question;
			};

			// ---------- Setup ----------

			this.init = function () {
				progress = new QuizEngine.Progress(safeStorage());
				loadSettings();
				buildCategoryChips();
				applySettingsToControls();

				$(".academy-modes a").on("click", function (e) {
					e.preventDefault();
					setMode($(this).attr("data-mode"));
				});

				$(".academy-league").on("change", function () {
					settings.league = parseInt($(this).val(), 10);
					saveSettings();
					loadLeague(startRound);
				});

				$(".academy-level").on("change", function () {
					settings.level = parseInt($(this).val(), 10);
					saveSettings();
					startRound();
				});

				$(".academy-length").on("change", function () {
					settings.length = parseInt($(this).val(), 10);
					saveSettings();
					startRound();
				});

				$(".academy-weak").on("click", function () {
					settings.weakOnly = !settings.weakOnly;
					saveSettings();
					$(this).toggleClass("on", settings.weakOnly);
					startRound();
				});

				$(".academy-categories").on("click", ".cat-chip", function () {
					toggleCategory($(this).attr("data-cat"));
				});

				$(".submit-btn").on("click", submitAnswer);
				$(".reveal-btn").on("click", revealAnswer);
				$(".next-btn").on("click", nextQuestion);
				$(".gotit-btn").on("click", function () { selfGrade(true); });
				$(".missed-btn").on("click", function () { selfGrade(false); });
				$(".again-btn").on("click", startRound);
				$(".practice-missed-btn").on("click", practiceMissed);
				$(".reset-progress-btn").on("click", resetProgress);

				$(".card-input").on("click", ".option", selectOption);
				$(".card-input").on("keydown", "input[type=number]", function (e) {
					if (e.which === 13) {
						e.preventDefault();
						submitAnswer();
					}
				});

				$(document).on("keydown", function (e) {
					if (e.which === 13 && answered && $(".next-btn").is(":visible") && !$(e.target).is("button, a, select")) {
						nextQuestion();
					}
				});

				window.addEventListener("hashchange", function () {
					var mode = window.location.hash.replace("#", "");

					if (["quiz", "flashcards", "progress"].indexOf(mode) > -1 && mode !== settings.mode) {
						setMode(mode, true);
					}
				});

				var hash = window.location.hash.replace("#", "");

				if (["quiz", "flashcards", "progress"].indexOf(hash) > -1) {
					settings.mode = hash;
				}

				loadLeague(function () {
					$(".loading").hide();
					setMode(settings.mode, true);
				});
			};

			function safeStorage() {
				try {
					var probe = "academy.probe";

					window.localStorage.setItem(probe, "1");
					window.localStorage.removeItem(probe);

					return window.localStorage;
				} catch (e) {
					return null;
				}
			}

			function loadSettings() {
				try {
					var saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));

					if (saved) {
						settings = $.extend({}, defaults, saved);

						if (!settings.categories || !settings.categories.length) {
							settings.categories = defaults.categories.slice();
						}
					}
				} catch (e) {
					// Use defaults
				}
			}

			function saveSettings() {
				try {
					window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
				} catch (e) {
					// Settings just won't persist
				}
			}

			function applySettingsToControls() {
				$(".academy-league").val(settings.league);
				$(".academy-level").val(settings.level);
				$(".academy-length").val(settings.length);
				$(".academy-weak").toggleClass("on", settings.weakOnly);
			}

			function buildCategoryChips() {
				var $wrap = $(".academy-categories").html("");

				Object.keys(QuizEngine.CATEGORIES).forEach(function (key) {
					var cat = QuizEngine.CATEGORIES[key];
					var $chip = $('<button type="button" class="cat-chip" aria-pressed="false"></button>').attr("data-cat", key);

					$chip.append($("<b>").text(cat.label));
					$chip.append($("<span>").text(cat.blurb));
					$wrap.append($chip);
				});

				refreshCategoryChips();
			}

			function refreshCategoryChips() {
				$(".cat-chip").each(function () {
					var on = settings.categories.indexOf($(this).attr("data-cat")) > -1;

					$(this).toggleClass("on", on).attr("aria-pressed", on ? "true" : "false");
				});
			}

			function toggleCategory(cat) {
				var index = settings.categories.indexOf(cat);

				if (index > -1) {
					// Always keep at least one topic selected
					if (settings.categories.length === 1) {
						return;
					}

					settings.categories.splice(index, 1);
				} else {
					settings.categories.push(cat);
				}

				saveSettings();
				refreshCategoryChips();
				startRound();
			}

			// ---------- Data ----------

			function loadLeague(callback) {
				var token = ++loadToken;

				gm.loadRankingData({
					displayRankingData: function (data) {
						if (token !== loadToken) {
							return;
						}

						pool = QuizEngine.buildPool(gm.data, data, 70);

						try {
							SwapScenarios.init({ pool: pool, cp: settings.league, cup: "all" });

							if (!swapReady) {
								SwapScenarios.register(QuizEngine);
								swapReady = true;
							}
						} catch (e) {
							console.error("Swap scenarios unavailable", e);
							swapReady = false;
						}

						callback();
					}
				}, "overall", settings.league, "all");
			}

			// ---------- Modes ----------

			function setMode(mode, skipHash) {
				settings.mode = mode;
				saveSettings();

				$(".academy-modes a").removeClass("selected").filter("[data-mode=" + mode + "]").addClass("selected");

				if (!skipHash && window.history && window.history.replaceState) {
					window.history.replaceState(null, "", "#" + mode);
				}

				$(".academy-setup .length-group").toggle(mode === "quiz");
				$(".academy-setup .weak-group").toggle(mode !== "progress");
				$(".academy-setup, .academy-categories").toggle(mode !== "progress");

				if (mode === "progress") {
					showProgress();
				} else {
					startRound();
				}
			}

			function activeCategories() {
				var cats = settings.categories.slice();

				if (!swapReady) {
					cats = cats.filter(function (c) { return c !== "swap"; });
				}

				return cats.length ? cats : ["count"];
			}

			function startRound() {
				if (!pool || settings.mode === "progress") {
					return;
				}

				round = { asked: 0, correct: 0, missed: [], perCat: {} };
				question = null;

				$(".academy-progress, .academy-summary").addClass("hide");
				$(".academy-card").removeClass("hide");

				nextQuestion();
			}

			function nextQuestion() {
				if (settings.mode === "quiz" && settings.length > 0 && round.asked >= settings.length) {
					showSummary();

					return;
				}

				var opts = { categories: activeCategories(), level: settings.level, weakOnly: settings.weakOnly };

				if (settings.weakOnly && progress.weakCards(opts.categories).length === 0) {
					showEmptyWeak();

					return;
				}

				question = null;

				for (var attempt = 0; attempt < 4 && !question; attempt++) {
					try {
						question = QuizEngine.next(rng, pool, attempt > 1 ? { categories: opts.categories.filter(function (c) { return c !== "swap"; }), level: opts.level } : opts, progress);
					} catch (e) {
						console.error(e);
					}
				}

				if (!question) {
					return;
				}

				renderQuestion(question);
			}

			function showEmptyWeak() {
				$(".academy-card").addClass("hide");
				$(".academy-summary").removeClass("hide").find("h2").text("Nothing to review");
				$(".summary-score").text("No missed cards in these topics. Turn off \"Missed cards only\" to keep practicing.");
				$(".summary-categories, .summary-missed").html("");
				$(".practice-missed-btn").addClass("hide");
			}

			// ---------- Rendering ----------

			function renderQuestion(q) {
				answered = false;

				var catLabel = QuizEngine.CATEGORIES[q.category].label;

				$(".category-badge").text(catLabel).attr("data-cat", q.category);
				$(".replay-badge").toggleClass("hide", !q.replay);
				$(".card-progress").text(settings.mode === "quiz" && settings.length > 0 ? "Question " + (round.asked + 1) + " of " + settings.length : "Question " + (round.asked + 1));
				updateStreak();

				$(".card-prompt").text(q.prompt);

				var $facts = $(".card-facts");

				if (q.facts && q.facts.length) {
					var $body = $facts.find("tbody").html("");

					q.facts.forEach(function (row) {
						$body.append($("<tr>").append($("<td>").addClass("label").text(row[0])).append($("<td>").text(row[1])));
					});
					$facts.removeClass("hide");
				} else {
					$facts.addClass("hide");
				}

				renderInput(q);

				$(".card-feedback").addClass("hide").removeClass("correct wrong");
				$(".card-feedback .visual").html("");
				$(".next-btn, .self-grade").addClass("hide");

				if (settings.mode === "flashcards") {
					$(".submit-btn").addClass("hide");
					$(".reveal-btn").removeClass("hide");
					$(".card-input").addClass("static");
				} else {
					$(".submit-btn").removeClass("hide").prop("disabled", false);
					$(".reveal-btn").addClass("hide");
					$(".card-input").removeClass("static");
				}

				if (settings.mode === "quiz") {
					$(".card-input input").first().trigger("focus");
				}
			}

			function renderInput(q) {
				var $box = $(".card-input").html("");

				if (q.input.kind === "number") {
					var $field = $('<label class="number-field"></label>');

					$field.append($('<input type="number" inputmode="numeric" step="1" autocomplete="off">').attr({ min: q.input.min, max: q.input.max, "aria-label": "Your answer" }));
					$field.append($("<span>").text(q.input.unit || ""));
					$box.append($field);

					if (settings.mode === "flashcards") {
						$field.hide();
					}

					return;
				}

				var $list = $('<div class="option-list" role="group"></div>');

				q.input.options.forEach(function (opt) {
					$list.append($('<button type="button" class="option"></button>').attr("data-id", opt.id).attr("aria-pressed", "false").text(opt.label));
				});

				if (q.input.kind === "multi") {
					$box.append($('<p class="multi-hint">Select all that apply.</p>'));
				}

				$box.append($list);
			}

			function selectOption() {
				if (answered || settings.mode === "flashcards") {
					return;
				}

				var $opt = $(this);

				if (question.input.kind === "multi") {
					$opt.toggleClass("selected");
				} else {
					$(".card-input .option").removeClass("selected");
					$opt.addClass("selected");
				}

				$(".card-input .option").each(function () {
					$(this).attr("aria-pressed", $(this).hasClass("selected") ? "true" : "false");
				});
			}

			function readResponse() {
				if (question.input.kind === "number") {
					var raw = $(".card-input input").val();

					return raw === "" ? null : Number(raw);
				}

				var selected = $(".card-input .option.selected").map(function () { return $(this).attr("data-id"); }).get();

				if (question.input.kind === "multi") {
					return selected;
				}

				return selected.length ? selected[0] : null;
			}

			function updateStreak() {
				var stats = progress.stats();

				$(".card-streak").text(stats.streak > 1 ? stats.streak + " in a row" : "");
			}

			function showFeedback(correct, revealOnly) {
				var $fb = $(".card-feedback").removeClass("hide correct wrong");

				$fb.find(".verdict").toggle(!revealOnly);

				if (!revealOnly) {
					$fb.addClass(correct ? "correct" : "wrong");
					$fb.find(".verdict").text(correct ? "Correct!" : "Not quite.");
				}

				$fb.find(".expected").text("Answer: " + QuizEngine.answerText(question));
				$fb.find(".explain").text(question.explain);
				$fb.find(".visual").html(Visuals.render(question.visual));
			}

			// ---------- Quiz ----------

			function submitAnswer() {
				if (answered || !question) {
					return;
				}

				var response = readResponse();

				if (response === null || (Array.isArray(response) && question.input.kind === "choice" && response.length === 0)) {
					$(".card-input").addClass("needs-answer");
					setTimeout(function () { $(".card-input").removeClass("needs-answer"); }, 600);

					return;
				}

				answered = true;

				var result = QuizEngine.check(question, response);

				// Mark the options
				if (question.input.kind !== "number") {
					var correctIds = Array.isArray(question.answer) ? question.answer : [question.answer].concat(question.accept || []);

					$(".card-input .option").each(function () {
						var id = $(this).attr("data-id");

						$(this).toggleClass("is-answer", correctIds.indexOf(id) > -1);
						$(this).toggleClass("is-wrong", $(this).hasClass("selected") && correctIds.indexOf(id) === -1);
					});
				}

				$(".card-input input, .card-input .option").prop("disabled", true);
				$(".submit-btn").addClass("hide");
				$(".next-btn").removeClass("hide").trigger("focus");

				finishQuestion(result.correct);
				showFeedback(result.correct, false);
			}

			function finishQuestion(correct) {
				progress.record(question, correct);
				round.asked++;
				round.perCat[question.category] = round.perCat[question.category] || { seen: 0, right: 0 };
				round.perCat[question.category].seen++;

				if (correct) {
					round.correct++;
					round.perCat[question.category].right++;
				} else {
					round.missed.push(question);
				}

				updateStreak();
			}

			// ---------- Flashcards ----------

			function revealAnswer() {
				if (answered) {
					return;
				}

				answered = true;
				$(".reveal-btn").addClass("hide");
				$(".self-grade").removeClass("hide");
				showFeedback(false, true);
			}

			function selfGrade(correct) {
				finishQuestion(correct);
				nextQuestion();
			}

			// ---------- Summary and progress ----------

			function showSummary() {
				$(".academy-card").addClass("hide");

				var $s = $(".academy-summary").removeClass("hide");

				$s.find("h2").text("Round complete");
				$(".summary-score").text(round.correct + " / " + round.asked + " correct (" + Math.round(100 * round.correct / Math.max(1, round.asked)) + "%)");

				var $cats = $(".summary-categories").html("");

				Object.keys(round.perCat).forEach(function (c) {
					var s = round.perCat[c];

					$cats.append(statBar(QuizEngine.CATEGORIES[c].label, s.right, s.seen));
				});

				var $missed = $(".summary-missed").html("");

				if (round.missed.length) {
					$missed.append($("<h3>").text("Review"));

					round.missed.forEach(function (q) {
						var $item = $('<div class="missed-item"></div>');

						$item.append($('<p class="q"></p>').text(q.prompt));
						$item.append($('<p class="a"></p>').text("Answer: " + QuizEngine.answerText(q)));
						$missed.append($item);
					});
				} else {
					$missed.append($("<p>").text("Perfect round. Try a higher difficulty or a different topic."));
				}

				$(".practice-missed-btn").toggleClass("hide", progress.weakCards().length === 0);
			}

			function statBar(label, right, seen) {
				var pct = seen ? Math.round(100 * right / seen) : 0;
				var $row = $('<div class="stat-row"></div>');

				$row.append($('<span class="stat-label"></span>').text(label));
				$row.append($('<span class="stat-bar"><span class="fill" style="width:' + pct + '%"></span></span>'));
				$row.append($('<span class="stat-value"></span>').text(seen ? right + "/" + seen + " (" + pct + "%)" : "no attempts"));

				return $row;
			}

			function practiceMissed() {
				settings.weakOnly = true;
				$(".academy-weak").addClass("on");
				saveSettings();
				startRound();
			}

			function showProgress() {
				$(".academy-card, .academy-summary").addClass("hide");
				$(".academy-progress").removeClass("hide");

				var stats = progress.stats();
				var $stats = $(".progress-stats").html("");
				var cards = [
					["Answered", stats.total],
					["Correct", stats.total ? Math.round(100 * stats.correct / stats.total) + "%" : "-"],
					["Best streak", stats.best],
					["To review", stats.weak],
					["Mastered", stats.mastered]
				];

				cards.forEach(function (c) {
					$stats.append($('<div class="tile"></div>').append($("<b>").text(c[1])).append($("<span>").text(c[0])));
				});

				var $cats = $(".progress-categories").html("");

				Object.keys(QuizEngine.CATEGORIES).forEach(function (key) {
					var s = stats.categories[key];

					$cats.append(statBar(QuizEngine.CATEGORIES[key].label, s.right, s.seen));
				});
			}

			function resetProgress() {
				if (window.confirm("Clear all Academy progress in this browser?")) {
					progress.reset();
					showProgress();
				}
			}
		}

		return object;
	}

	return {
		getInstance: function () {
			if (!instance) {
				instance = createInstance();
			}

			return instance;
		}
	};
})();
