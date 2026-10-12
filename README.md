# PvPoke

[PvPoke.com](https://pvpoke.com) is a resource for Pokemon GO PvP that includes a battle simulator, rankings, and team building. The project’s goal is to provide tools and insights to help players build their teams, and foster the game’s community spirit by making all of the underlying code public. I hope this project can inspire new tools or benefit the existing ones that continue to enhance our enjoyment of the game.

This started as a passion project that went from “I wonder what this would look like quick” to “uh oh, people are going to actually see this.” Just so you know what you’re getting into.

## Running PvPoke

See the [Installation](https://github.com/pvpoke/pvpoke/wiki/Installation) section of the PvPoke Wiki.

## Site Structure

It was about 10 minutes into development when I realized this project would be great in Angular, but that was unfortunately 5 minutes past the point I was willing to backtrack. So allow me to show you the result.

Here’s a rundown on how most of the pages operate:

1. Main PHP file generates base HTML. These PHP files contain HTML only, and have no inherent functionality. They import any necessary Javascript files. These are our views, so to speak.
2. `GameMaster.js` loads the `data/gamemaster.json` file, which contains all Pokemon and move data. This is our model.
3. Once the data is loaded, `GameMaster.js` calls an interface object from one of several script files in the `/js/interface` directory to initialize. This object does things like populate dropdowns with data, create event listeners, etc. These are kind of extensions of the view.
4. Once the interface receives a certain interaction, it’ll call on an object like `Battle.js` or `TeamRanker.js` to receive user input, process it along with the model data, and return results to be displayed by the interface. These files are like the controller.

It’s something just close enough to MVC that I get to pat myself on the back, but Javascript and encapsulation go together like spaghetti and other, worse spaghetti. If you’ve heard of spaghetti code, this is more like lasagna code—it’s got structure but might fall apart when you fork it.

## Generating Rankings

Rankings can be generated locally using the following steps:

1. In your browser, visit the `ranker.php` page.
2. Open the developer console. This is where you’ll see output.
3. Run the simulations. This may take a few minutes. The `ranker.php` page will generate rankings for every league and category, and save the JSON results to the `/data` directory.
4. If you want to generate overall rankings, visit the `rankersandbox.php` page.
5. For each league, click the Simulate button. This will load previously generated JSON, process it, and save overall rankings to the `/data/overall` directory.

Feel free to copy the `Ranker.js` or `RankerOverall.js` files and experiment with your own modifications or algorithms.

## Academy

The Academy adds counting and move timing practice on top of the simulator. Everything lives in `src/js/academy` and `src/academy`.

- **Coach (Train).** Pick a Coach mode on the Train setup page. *Learn* shows both Pokemon's energy, the Fast Moves left to each Charged Move, and a prompt that comes from the simulator's own logic (`ActionLogic.decideAction`, the code that decides when the Battle page's simulated Pokemon throw): throw now, tap N more first, or hold with the engine's reason (better timing, saving for a bigger move, baiting a shield). The coach adds no throw policy of its own. *Count* shows your energy and only a raw count of the opponent's taps, so you do the counting. *Review* stays quiet and grades afterward. Every Charged Move, yours and theirs, is graded as it happens, and the end screen has a Timing tab.
- **Energy & Timing (Battle).** Under each simulated timeline: energy over time for both Pokemon, the Fast Moves between throws, a count sheet, and a grade for every Charged Move. In Sandbox Mode it updates as you place throws, so you can see what a sneak costs.
- **Quiz and flashcards (`/academy/`).** Fast Move counting, tracking an opponent's energy from what they've done, throw timing (including "I run a 5-turn move, they run a 3-turn move, when can I throw?"), and stay-or-swap scenarios for ABA, ABB and ABC teams. Missed cards come back until you get them right a few times in a row. Progress is stored in the browser only.

### How timing is graded

This is how PvPoke's battle engine models the game, not something independently verified against Pokemon GO. A Fast Move registers on its last turn. A Charged Move takes its own turn, then both Pokemon tap again two turns after the throw. So when you throw while the opponent has `rho` turns left on their Fast Move, their next tap comes `rho - 2` turns earlier than it would have. Positive values are "free turns" for them.

| Turns left (`rho`) | Grade |
| --- | --- |
| 1 | Perfect. Their move registers and they lose a turn |
| 2 | Good. No free turns |
| 3 | Minor leak. 1 free turn |
| 4 or more | Bad |
| Their full move length | Sneak. They tapped on your throw turn |

The `rho - 2` rule follows the simulator as updated for Niantic's June 2026 Trainer Battle rebuild. Before the commits of Aug 23-26, 2026 the engine reset both cooldowns to 0 after a Charged Move (both Pokemon resumed the next turn, giving `rho - 1`); it now adds a one turn delay "to resolve Fast Attack damage". The maintainer noted the Charged Attack start delay was reverted "for now", so this is the simulator's current approximation of the game, not a verification against it. The older Fast Move guide on the site still describes the previous system.

This was measured against `Battle.js` rather than assumed. `tests/academy/engine-check.mjs` forces a throw on every opportunity for every pair of 1 to 5 turn Fast Moves and compares the engine's result with `TurnMath`.

### Where the live prompts come from

The Coach asks the engine rather than re-implementing it. `EngineAdvisor` hands `ActionLogic.decideAction` the state it would see (cooldowns, energy and HP projected to your next action turn, restored afterward) through a small stand-in battle object, and reads the answer and its reasons from the engine's own decision log. The "tap N more" countdown asks again after advancing your own Fast Moves, up to two.

Every Charged Move is judged the same way at the moment it is thrown. `Battle` takes a plain-data snapshot just before anyone decides (cooldowns, queued Fast Moves, energy, HP, shields) and calls a throw observer, and `EngineAdvisor.review` asks the engine what it would have done from that snapshot. The Train Coach and the Battle page's Energy & Timing panel both register that observer. `TurnMath` still measures the leak (free turns, and what they are worth); whether you should have waited is the engine's call, and when the two disagree both are shown.

`EngineReasons` turns the engine's decision lines into wording: baiting a shield, building to a bigger move, a farm-down plan, surviving, timing, form change and so on. It only says what the engine logged. For example, the engine's overfarm is a random chance when the matchup is decent and the opponent has Pokemon left; nothing in it ties that to a one-turn switch, so none is claimed. `enginereasons.test.mjs` reads every `logDecision` call in `ActionLogic.js` and fails if one stops matching a rule, so an upstream rewording shows up at merge time instead of as silently missing explanations. Your own bait holds come from your team's Bait Shields setting.

In Learn mode the panel also shows the opponent AI's current plan, read from `TrainingAI.getPlan()`: swapping out of a bad matchup, building energy before a swap, farming, baiting a shield, or an overfarm tap. It is worded as what the AI chose, never as a prediction of what it will do next.

How it is checked:

- `engine-replay-check.mjs` (blocking): every Charged Move the AI throws in 487 simulated battles (2107 throws) replays through `EngineAdvisor.review` as the same throw. A deliberately wrong stand-in scores about 54%.
- `review-lookahead-check.mjs`: the "it would have thrown after N more taps" claim against a real forced re-run. In 508 battles the engine's "throw here" matched the re-run 317 of 317 times, and 147 of 147 "N taps" answers were exact (cases where the opponent threw in the window are counted separately, not as misses).
- `advice-check.mjs`: the live countdown and the projected state against what actually happened.
- `live-check.mjs`: the dead-turn rule from the engine's own step log (`Battle.getStepLog`), and the displayed prompt against the observer's verdict on the same throw.

Two things still use `TurnMath`: measuring the leak, which `engine-check.mjs` pins to the engine, and the Academy quizzes. The Niantic rule details behind the turn model (the T+2 timing and the faint rule) come from secondhand sources and the engine's own behavior, not from an official specification.

### Leagues, cups and Megas

The quiz format menu is the three open leagues plus every cup that has ranking data: the formats the site lists, then any other cup with a ranking file at some CP (the page asks the server which files exist, so nothing is offered without data). A cup that borrows another cup's ranking, such as the P!P Championship Series, is offered only when it adds bans the page can apply, and those bans are applied to the pool.

Each format builds its pool from that cup's own ranking and runs the swap simulations under that cup. A cup changes the answers in three ways: who is in the pool, which moveset each of them runs (the ranking files carry the cup's own sets, and they differ a lot: 53 of the Spectral Cup's top 70 run a different set than in the open Great League, 49 in Premier, 43 in Classic), and the cup's level cap. In 80 scenarios per cup, built from Pokemon that appear in both pools and rated with each pool's own sets, the stay/swap answer changed in 24 for Classic, 9 for Tsuki and 9 for Catch Cup, and the rating of the lead moved by 100 or more in 40, 32 and 16. Spectral's four shared Pokemon moved ratings in 15 scenarios without changing a decision. Holding the sets fixed instead, 60 scenarios gave identical decisions in the open and Mega Great Leagues, so for cups without a level cap the moveset is what moves the answer, not the cup itself.

None of the cups on the menu has a team rule beyond party size (no restricted picks or type-sharing rule), and `cups-check.mjs` fails if one gains such a key, since swap questions would then show illegal teams.

The pool is the top 70 of the ranking, plus up to 10 Mega Pokemon from further down. Megas rarely rank in the top 70 of the Great and Ultra Mega cups, so without this they would barely appear. The open leagues exclude Megas, as the game does.

Megas tagged `supermega` carry a third Charged Move. The pool keeps all three, and the swap simulations equip all three, so a count question and a stay-or-swap answer describe the same Pokemon. It does change results, and not always in the Mega's favor: in the Mega Master League, Mega Dragonite rates 488 with Outrage+ and 600 without against Origin Forme Palkia. In the three-move run the simulator's AI throws Outrage+ at turn 14 and faints at turn 40, while the two-move run wins at turn 38 with three Thunder Punches. That is the AI's choice with the loadout it was given (the equipped move IDs match the pool's), not a setup error.

Missed cards are remembered per format and only come back in the format they were missed in. Cards saved before formats existed are assigned to the league saved with them.

### Stay or swap

Each scenario simulates your current Pokemon and each swap against the opposing lead, then applies written rules in `SwapScenarios.decide`: stay when winning, swap to the Pokemon that beats the lead, spend the weaker closer first when two answers are close, and stay and trade when nothing beats it. These rules judge the lead matchup and what a swap costs. They don't know the opponent's back line, so treat them as coaching heuristics rather than a solved game.

Team shape letters are derived from the type chart. Two Pokemon share a letter when at least half of their weaknesses overlap: ABC has three different answers, ABB has two back Pokemon that lose to the same things, and ABA has a lead and closer that do.

### Installable app (PWA)

The Academy can be installed to a phone's home screen and used offline. It is off by default, so a stock deployment behaves exactly as upstream does. To turn it on, set `$PWA_ENABLED = true` in your `src/modules/config.local.php` (copied from `config.local.example.php`; it is untracked, so merges and uploads never overwrite it), on a site served over HTTPS (service workers do not run on plain HTTP, except on localhost). Set `$WEB_HOST` there to `https://` as well, and `$WEB_ROOT` for where the site lives.

What it does when on:

- Every page links `academy/manifest.json` instead of the stock manifest, so "Add to Home Screen" from any page gives an app named "PvP Academy" that opens the Academy. The name and icons are placeholders: change `name`/`short_name` in the manifest and the `apple-mobile-web-app-title` tag in `header.php`. The icons in `img/academy/` are original artwork.
- `service-worker.js` is registered by absolute, versioned URL (a request for it without `?v=`, which is how upstream's own registration reaches it, gets a worker with no handlers, i.e. the old empty file's behavior) (`service-worker.js?v=<site version>`). Pages are network-first (the saved copy is used only when the network fails or is slow), versioned files are cache-first, and everything else, including the Train mode's database endpoints, passes through untouched.
- The Academy shows an Install button where the browser supports it (Chrome and Edge). On iPhone and iPad it explains Share, then Add to Home Screen.
- If a format's ranking can't be loaded, such as one never opened while online, the quiz says so and goes back to the last format that loaded instead of hanging.

Things to know when deploying:

- **Bump the version on every upload, then purge the host's cache.** Edit `src/academy/version.txt` (the data sync script does it for you); upstream's own `$SITE_VERSION` line is left alone. The worker and the cached files are keyed to the version. If you upload changes without bumping it, testers keep the old scripts until they clear site data. A new version installs a new worker, which takes over immediately and deletes the old caches. On SiteGround, also purge the dynamic cache (SG Optimizer or Site Tools), or it can keep serving HTML that still points at the old version.
- **Offline covers the Academy**, and only the formats that have been opened while online (the first open of each downloads its ranking file). Train and Battle need more data than is cached, so they are not promised offline.
- **On iOS the installed app has its own storage**, separate from Safari, so quiz progress built up in the browser does not appear in the installed app.
- Locally, `$WEB_ROOT` containing `src` randomizes the version on every page load. For testing the worker, pin it with the `SITE_VERSION_OVERRIDE` environment variable and enable the flag with `PWA_ENABLED=1`.

### Updating from upstream

Upstream (`pvpoke/pvpoke`) changes often: rankings and gamemaster data most days, code now and then. The Academy is set up so that taking those changes does not cost any of its customizations.

**What is whose.** `src/data/` is entirely upstream's: the Academy keeps nothing there. Everything the Academy adds is a new file (`src/js/academy/`, `src/academy/`, `src/img/academy/`, `scripts/academy/`, `tests/academy/`) or one of 14 small hooks in files upstream owns. Every hook is listed in `tests/academy/hooks.json`, and `hooks.test.mjs` fails if a merge drops one. Deployment settings go in an untracked `src/modules/config.local.php` (copy `config.local.example.php`; `src/modules/.gitignore` keeps it out of git, so upstream's `.gitignore` is untouched), so merges never overwrite them. The Academy's own cache version is `src/academy/version.txt`, appended to upstream's `$SITE_VERSION`, so an update bumps every `?v=` URL without editing upstream's version line.

**Every update is a merge**, data or code, and one script does it:

```
git remote add upstream https://github.com/pvpoke/pvpoke      # once; the script adds it too if it is missing
scripts/academy/update-from-upstream.sh --check                # what changed, which hook files changed, what would conflict
scripts/academy/update-from-upstream.sh                        # merge, resolve src/data with upstream's side, bump the version, commit
PLAYWRIGHT_PATH=/path/to/node_modules/ scripts/academy/run-gates.sh
```

It merges (not rebases, so history stays honest), takes upstream's side of any conflict in `src/data` and its deletions (that tree is upstream's), bumps `version.txt`, and tells you which upstream code files changed and which of those hold an Academy hook. If nothing else conflicts it commits. If something does, it leaves the merge open and lists the files: re-apply the hook, `git add`, run the gates, commit.

Why a merge and not a copy of the data folder: I measured both on real upstream history. Of the 92 upstream commits in a ten-week stretch, only 20 touched data alone (15 more touched data plus `header.php`, which gets a version bump on most releases), and 57 touched other code, so a rule of "refresh data only when code is unchanged" would almost always refuse. And a copy-style sync records no ancestry: after syncing to the midpoint of that stretch, merging the upstream tip conflicted in 67 files, because the ranking files are single-line JSON and the merge base was stale. Through the merge script, both steps (midpoint, then tip) applied with no conflicts and left exactly the current tree plus the new version number.

A clean textual merge does not prove the engine still behaves the same. That is what the gates are for:

| Gate | Catches |
|---|---|
| unit tests, `enginereasons` | upstream rewording the engine's decision log; quiz and turn math |
| `hooks.test` | a merge dropping an Academy hook |
| `engine-check` | the turn model drifting from the simulator's |
| `engine-replay-check` | the stand-in battle disagreeing with the engine (blocking) |
| `cups-check` | cups added or removed, a cup gaining a team rule, borrowed-ranking bans |
| `mega-check` | gamemaster schema changes (supermega tag, third Charged Move) |
| `pwa-check`, `ui-check`, `phone-check`, `audit-check`, live/advice/lookahead checks | the install path, the quiz, the Coach and timing panel in a real browser |

The tests choose their fixtures from the data (which Mega leads, which cups to open), so a refresh changes their picks instead of failing them. The measurements quoted in this README are a snapshot of the data at upstream commit `c15fb6f` (2026-10-09): the Dragonite ratings, the moveset-difference counts, the throw counts, the format count. They will drift as data changes and are not asserted anywhere.

**Uploading.** After an update, or after any change you make yourself, bump `src/academy/version.txt` (the update script does it for merges; do it by hand for your own edits), upload, and purge the host's cache. Upload without "mirror with delete" (or exclude `config.local.php`): a mirror that deletes files missing from your local copy would remove the server's untracked `config.local.php` and with it your SiteGround settings.

### Tests

```
node --test tests/academy/*.test.mjs
```

The browser tests need the site running (for example `php -S` with `/pvpoke/src/` pointing at `src`) and Playwright:

```
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/engine-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/ui-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/engine-replay-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/review-lookahead-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/advice-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/live-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/audit-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/mega-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/cups-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/phone-check.mjs
PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/pwa-check.mjs   # starts its own PHP servers, no SITE_URL
```

## Contributing

I’m excited to work and collaborate with everyone who wants to be a part of this project, big or small. After all, I’m just a Pokemon fan probably like many of you. In this section, I want to be clear about the vision and scope I have in mind for this project to properly set expectations about contributing code, what may or may not be accepted, etc.

### Documentation

The [PvPoke Wiki](https://github.com/pvpoke/pvpoke/wiki/) has resources to help run and modify your own local version of the website, or help contribute code.

### Time Commitment

My work on this project is strictly volunteer, and I have a limited number of hours I can dedicate to it during the week. This may mean some delays related to pull requests, issues reports, etc. I appreciate your understanding and patience! As necessary, I may look to partner with someone or multiple someones to help with any backlog.

You’re welcome to dedicate as much or as little time toward the project as you like, and contribute often or even just once. And if you have to step away for any reason, we’ll send the Beedrill swarm after thanking you for your contributions. It’s only fair.

### Development Cycle

This project operates on a two-week development cycle. I guess they’d be called “sprints” but sometimes an easy jog is nice, too. This development cycle looks like:

1. Identify and distribute tasks.
2. Develop, calling out any roadblocks along the way
3. Pull, merge, and review on staging site
4. Deploy on production site
5. Gather user and contributor feedback for next cycle

Some tasks may supersede this development cycle, such as fixes for critical issues or data and ranking updates for newly released Pokemon, moves, or mechanics. Some tasks, such as new tools or features, may also take longer than a single cycle. In this case, we’ll do our best to segment that task into individual milestones that can be completed in a two-week period.

### Examples

Here are examples of some things that would be appealing code contributions and readily fit within the development cycle:

* **Bug fixes.** Check out our active [issue tracker](https://github.com/pvpoke/pvpoke/issues) or if there’s an issue you’ve identified and have ideas for how to solve, let us know!
* **Data entry.** The Game Master file isn’t complete yet, so we’d greatly appreciate help adding game data.
* **Performance improvements.** The tool functions have more loops than a Knot Tying Convention, and if you can help them process more efficiently, you are better off doing that than going to the convention. I still tie my shoes in bunny ears.
* **Algorithm improvements.** Help us make our battle and ranking algorithms more accurate and representative of gameplay.
* **Minor code refactoring.** “It just works,” but maybe it could work just a bit better. Just kidding, the code’s perfect. But if you’d like to move things around in a way that makes more sense, go for it and share with us what you think.
* **Additions to existing features.** Maybe the battle simulator could use more options, or there is some more info that would be neat in the rankings. Additions to the tools we have are always welcome, though bear in mind that less is sometimes more.
* **New features that utilize existing data or interfaces.** Can you teach an old dog new tricks? New tools or features that build on top of the existing foundation would make for excellent contributions.

Meanwhile, here are some example items that would be out of scope or don’t align with the project vision at this time. If user or contributor feedback suggests otherwise we can certainly revisit them, but for now I’d like to steer clear of things like:

* **Third-party libraries, frameworks, or dependencies.** Some things are necessary, like seatbelts and salt on rice, but the simpler, the better. Weigh any functionality or performance benefit with the effort it would take to implement and maintain.
* **Platform or technology overhauls.** Could the site run better as a PolitodeJS 0.5.3 virtual machine webapp? How should I know, I’m the one throwing out technobabble. Anyway, let’s stick to what we’ve got and if something would provide a serious improvement, we can see.
* **User accounts.** This is a can of Wormadam that I’m not looking to open at this time. Before considering this, I would want a convincing set of features that wouldn’t be possible without it.
* **Non-responsive tools or pages.** Pokemon GO is a mobile game, so everything on the site should be built for mobile.

I appreciate your understanding if a request is rejected. A rejection doesn’t mean that your code or idea is bad, just that it might not fit the current project. I will likely be taking things slow at the start. If you have any thoughts or ideas, I’d be happy to discuss them prior to development so we can work out what might fit best!

And of course, you can always fork the project and develop whatever you’d like. Thanks for reading!

-Empoleon_Dynamite

### Python Port

mglerner has made a Python port of the PvPoke simulation engine, available here:

https://github.com/mglerner/gopvpsim
