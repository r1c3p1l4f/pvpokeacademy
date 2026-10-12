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

The Coach asks the engine rather than re-implementing it. At each of your action turns it hands `decideAction` the state it would see (cooldowns, energy and HP projected to that turn, restored afterward) and reads the answer and its reason from the engine's decision log. The "tap N more" countdown asks again after advancing your own Fast Moves, up to two. Checked in live battles with `tests/academy/advice-check.mjs`: when the player was tapping, the countdown was right 13 of 14 times, and the engine never said "throw" where the old coach model said "wait". Where the engine holds and the old model threw, the engine's reasons were timing, baiting, farming or saving for a bigger move. Two things still use the coach's own `TurnMath`: grading each throw after the fact and the "next time, tap N more" suggestion that goes with it, and the Academy quizzes. `engine-check.mjs` pins `TurnMath` to the engine, and `live-check.mjs` verifies the dead-turn rule from the engine's own step log (`Battle.getStepLog`).

### Stay or swap

Each scenario simulates your current Pokemon and each swap against the opposing lead, then applies written rules in `SwapScenarios.decide`: stay when winning, swap to the Pokemon that beats the lead, spend the weaker closer first when two answers are close, and stay and trade when nothing beats it. These rules judge the lead matchup and what a swap costs. They don't know the opponent's back line, so treat them as coaching heuristics rather than a solved game.

Team shape letters are derived from the type chart. Two Pokemon share a letter when at least half of their weaknesses overlap: ABC has three different answers, ABB has two back Pokemon that lose to the same things, and ABA has a lead and closer that do.

### Tests

```
node --test tests/academy/*.test.mjs
```

The browser tests need the site running (for example `php -S` with `/pvpoke/src/` pointing at `src`) and Playwright:

```
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/engine-check.mjs
SITE_URL=http://127.0.0.1:8080/pvpoke/src/ PLAYWRIGHT_PATH=/path/to/node_modules/ node tests/academy/ui-check.mjs
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
