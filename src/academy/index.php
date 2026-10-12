<?php

$CANONICAL = '/academy/';

$META_TITLE = 'Academy';

$META_DESCRIPTION = 'Drill Fast Move counting, opponent energy tracking, Charged Move timing, and stay-or-swap decisions with quizzes and flashcards.';

require_once '../header.php';

?>

<h1>Academy</h1>
<div class="section white academy">
	<div class="ranking-categories mode-select academy-modes">
		<a href="#quiz" data-mode="quiz" class="selected">Quiz</a>
		<a href="#flashcards" data-mode="flashcards">Flashcards</a>
		<a href="#progress" data-mode="progress">Progress</a>
	</div>
	<div class="clear"></div>

	<p class="description">Win more battles by counting. Practice how many Fast Moves it takes to reach a Charged Move, track what your opponent is holding, find the turns where a throw gives nothing away, and decide when to stay in or swap.</p>

	<details class="cheat-sheet">
		<summary>Timing cheat sheet</summary>
		<p>In PvPoke's battle model, a Fast Move registers on its last turn. When you throw a Charged Move, the sequence takes a turn of its own and both Pokemon start fresh two turns later. What matters is how many turns your opponent has left on their Fast Move when you throw:</p>
		<table class="stats-table cheat-table" cellspacing="0">
			<thead><tr><td>Turns left on their move</td><td>What happens</td></tr></thead>
			<tbody>
				<tr><td>1</td><td><b>Perfect.</b> It registers and they lose a turn.</td></tr>
				<tr><td>2</td><td><b>Good.</b> No free turns.</td></tr>
				<tr><td>3 or more</td><td><b>Leak.</b> They get (turns left &minus; 2) free turns. Their full length means they just tapped, a <b>sneak</b>.</td></tr>
			</tbody>
		</table>
		<p>Same-length or evenly dividing moves (3 vs 3, 2 vs 4, anything vs a 1-turn move) stay in step, so you can't improve timing there. The <a href="<?php echo $WEB_ROOT; ?>articles/strategy/guide-to-fast-move-registration/">Fast Move guide</a> was written for the previous battle system, where both Pokemon resumed the turn right after a Charged Move. The free-turn counts here follow the simulator as updated for the 2026 system.</p>
	</details>

	<div class="academy-setup">
		<div class="setup-group">
			<label for="academy-league">League or cup</label>
			<select id="academy-league" class="academy-league">
				<option value="1500|all">Great League</option>
				<option value="2500|all">Ultra League</option>
				<option value="10000|all">Master League</option>
			</select>
		</div>
		<div class="setup-group">
			<label for="academy-level">Difficulty</label>
			<select id="academy-level" class="academy-level">
				<option value="1">Easy</option>
				<option value="2" selected>Medium</option>
				<option value="3">Hard</option>
			</select>
		</div>
		<div class="setup-group length-group">
			<label for="academy-length">Round</label>
			<select id="academy-length" class="academy-length">
				<option value="10">10 questions</option>
				<option value="20">20 questions</option>
				<option value="0">Endless</option>
			</select>
		</div>
		<div class="setup-group weak-group">
			<div class="check academy-weak"><span></span>Missed cards only</div>
		</div>
	</div>

	<div class="academy-categories" role="group" aria-label="Question topics"></div>
</div>

<div class="section white academy-stage">
	<h2 class="loading">Loading data...</h2>

	<div class="academy-card hide" aria-live="polite">
		<div class="card-meta">
			<span class="category-badge"></span>
			<span class="replay-badge hide">Missed before</span>
			<span class="card-progress"></span>
			<span class="card-streak"></span>
		</div>
		<p class="card-prompt"></p>
		<table class="card-facts stats-table hide" cellspacing="0"><tbody></tbody></table>
		<div class="card-input"></div>
		<div class="card-actions">
			<button class="button submit-btn">Check answer</button>
			<button class="button reveal-btn hide">Reveal answer</button>
			<button class="button next-btn hide">Next</button>
			<div class="self-grade hide">
				<button class="button missed-btn">Missed it</button>
				<button class="button gotit-btn">Got it</button>
			</div>
		</div>
		<div class="card-feedback hide">
			<div class="verdict"></div>
			<p class="expected"></p>
			<p class="explain"></p>
			<div class="visual"></div>
		</div>
	</div>

	<div class="academy-summary hide">
		<h2>Round complete</h2>
		<div class="summary-score"></div>
		<div class="summary-categories"></div>
		<div class="summary-missed"></div>
		<div class="summary-actions">
			<button class="button again-btn">Play again</button>
			<button class="button practice-missed-btn hide">Practice missed cards</button>
		</div>
	</div>

	<div class="academy-progress hide">
		<h2>Your progress</h2>
		<div class="progress-stats"></div>
		<div class="progress-categories"></div>
		<p class="progress-note">Progress is saved in this browser only. Missed questions come back until you get them right a few times in a row.</p>
		<button class="button reset-progress-btn">Reset progress</button>
	</div>
</div>

<div class="section white academy-links">
	<h3>Put it to work</h3>
	<p><a href="<?php echo $WEB_ROOT; ?>train/" class="inline-link">Training Battles</a> have a Coach that counts Fast Moves, shows energy, and grades each Charged Move you throw. The <a href="<?php echo $WEB_ROOT; ?>battle/" class="inline-link">Battle simulator</a> has an Energy &amp; Timing panel under every timeline.</p>
</div>

<?php require_once '../modules/scripts/battle-scripts.php'; ?>

<script src="<?php echo $WEB_ROOT; ?>js/GameMaster.js?v=<?php echo $SITE_VERSION; ?>"></script>
<script src="<?php echo $WEB_ROOT; ?>js/pokemon/Pokemon.js?v=<?php echo $SITE_VERSION; ?>"></script>
<script src="<?php echo $WEB_ROOT; ?>js/academy/TurnMath.js?v=<?php echo $SITE_VERSION; ?>"></script>
<script src="<?php echo $WEB_ROOT; ?>js/academy/QuizEngine.js?v=<?php echo $SITE_VERSION; ?>"></script>
<script src="<?php echo $WEB_ROOT; ?>js/academy/SwapScenarios.js?v=<?php echo $SITE_VERSION; ?>"></script>
<script src="<?php echo $WEB_ROOT; ?>js/academy/Visuals.js?v=<?php echo $SITE_VERSION; ?>"></script>
<script src="<?php echo $WEB_ROOT; ?>js/academy/QuizInterface.js?v=<?php echo $SITE_VERSION; ?>"></script>

<?php require_once '../footer.php'; ?>
