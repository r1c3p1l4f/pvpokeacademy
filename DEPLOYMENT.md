# Deploying to SiteGround

This is a step-by-step guide for putting this site on a SiteGround shared-hosting account, with the Academy installable as an app. Most of it applies to any Apache/PHP host.

**What is verified and what is not.** The file layout, the settings, the upload excludes, the MySQL schema and the checks in "Verify it" were exercised here: a copy made with the upload excludes, served from the root of a domain with PHP 8.3, and a real MariaDB for the database steps. The SiteGround menu names and click paths below are from memory of their Site Tools and may have moved; if a label differs, look for the same idea. I have not deployed to SiteGround itself.

## 1. What needs what (read this first)

You asked about MySQL. The short answer is that the site works without it.

| Part of the site | Needs MySQL? |
|---|---|
| Academy (quiz, flashcards, progress, install, offline) | No. Progress is stored in the browser. |
| Battle simulator and its Energy & Timing panel | No |
| Train mode: battles, the Coach, timing report | No |
| Train mode: posting anonymous results when a battle ends | **Yes, optional.** |
| Rankings, team builder, everything else | No |

The only database use is Train mode reporting each finished battle's anonymous results (Pokémon, format, scores, shields, a timestamp) to two tables, `training_pokemon` and `training_team`, which upstream uses for its training analysis. It happens only for battles with a randomly generated team against an Elite or Champion opponent. The analysis page itself reads static JSON files that ship with the code, not the database. Without a database, Train works exactly the same for the player. Set `$TRAINING_DB_ENABLED = false` (below) so the post fails quietly instead of causing a server error each time.

Set the database up only if you want to collect that data from your testers. Section 6 covers it.

## 2. What you need

- A SiteGround account with a domain or a subdomain to use. A staging subdomain such as `academy.yourdomain.com` is a good first target.
- This repository on your computer (`git clone`, or download the branch as a zip).
- One of: an SFTP client such as FileZilla, SiteGround's File Manager, or SSH access (best, because it can use `scripts/academy/deploy-rsync.sh`).

Only the contents of the `src/` folder get uploaded. `tests/`, `scripts/`, `docker/` and the README stay on your computer.

## 3. Prepare the domain

In SiteGround's **Site Tools** for the site:

1. **Subdomain** (if you are using one): *Domain → Subdomains → Create*. Note its folder, usually `public_html/<subdomain>` or its own folder under `www/`.
2. **HTTPS**: *Security → SSL Manager → Get a free Let's Encrypt certificate*, then *Security → HTTPS Enforce* on. Service workers (the installable, offline part) only run over HTTPS, so do this before testing the app.
3. **PHP version**: *Devs → PHP Manager*. Choose a current PHP 8.x. The site was tested on 8.3. The `mysqli` extension is only needed if you set up the database.
4. **Caching**: leave it for now. Step 8 covers it.

## 4. Decide where the site lives

- **Domain or subdomain root** (recommended). The files go directly in the site's web folder, and `$WEB_ROOT` is `'/'`.
- **A subfolder**, such as `yourdomain.com/academy/`. Upload into that folder and set `$WEB_ROOT = '/academy/'`.

## 5. Settings: `config.local.php`

Deployment settings live in a file that is not tracked by git and is never overwritten by updates: `src/modules/config.local.php`. Copy `src/modules/config.local.example.php` to that name and edit it. For a site at a domain root, with HTTPS, installable app on and no database:

```php
<?php
$WEB_ROOT = '/';
$WEB_HOST = 'https://' . $_SERVER['HTTP_HOST'] . $WEB_ROOT;
$PWA_ENABLED = true;
$TRAINING_DB_ENABLED = false;
```

Notes:
- If you upload with SFTP or File Manager, create this file on your computer first and upload it with the rest, or create it directly on the server. Either way it lives at `modules/config.local.php` inside the site's web folder.
- `$UA` (Google Analytics ID) and `$GOOGLE_AD_CLIENT` are blank in `config.php`. Leave them blank unless you want analytics. There is no ad code in this repository.
- Edit `src/privacy.php` and `src/contact.php` before sharing the site. They still carry PvPoke's contact addresses and supporter credits, which would point your testers at the wrong people.
- While testing, set `$PWA_ENABLED = false` if you want the plain site with no service worker, then turn it on when you are ready to test installing.

## 6. Upload

Never upload these (the script and the list in `scripts/academy/deploy-excludes.txt` handle it for you):

- **`data/write.php`**. It lets anyone who can reach it overwrite ranking files with arbitrary JSON, and the file itself says it does not belong in production. Also leave out `data/compile.php`, `data/parse*.php`, `data/movesets.php`, `data/overrideEditor.php`, `ranker.php`, `rankersandbox.php`, and `data/training/getTraining.php`. These are developer tools. Nothing on the site calls them.
- **`modules/config.local.php`** from your computer, if the server already has its own copy.

### Option A: SSH and rsync (recommended)

Enable SSH in Site Tools (*Devs → SSH Keys Manager*: create a key, or use the account password) and note the host, username and port (SiteGround's SSH port is usually 18765). Then, from the repository root:

```
export SSH_USER=u123-abcdefgh SSH_HOST=ssh.yourhost.example SSH_PORT=18765
export REMOTE_DIR='www/yourdomain.com/public_html/'

scripts/academy/deploy-rsync.sh          # dry run: lists what would be sent
scripts/academy/deploy-rsync.sh --go     # sends it
```

It never deletes anything on the server. That matters: a "mirror" upload that removes files missing from your copy would delete the server's `config.local.php` and with it all your settings.

### Option B: SFTP or File Manager

1. Make a copy of `src/` somewhere, and delete the files listed above from the copy.
2. Upload its contents (not the `src` folder itself) into the site's web folder.
3. Make sure the hidden file `.htaccess` came across (it is a dotfile, and some tools skip it). Without it the clean URLs such as `/battle/`, `/battle/1500/…` and `/rankings/` give 404s (the site's own menu links use them). `/academy/` and `/train/` are real folders and work without it, which can hide the problem, so test `/battle/` too.
4. Turn off any "delete remote files not found locally" option.

Default permissions are fine: folders 755, files 644.

## 7. Optional: MySQL for Train results

Skip this section if you do not need the training data. With `$TRAINING_DB_ENABLED = false` nothing else changes.

The steps below were run against a real MariaDB (the same engine family SiteGround uses), including the permission level in step 3.

1. **Create the database.** *Site Tools → Site → MySQL → Databases → Create Database.* SiteGround prefixes names with your account (for example `u123_training`). Write down the full name.
2. **Create a user.** *Users → Create User*, with a long random password. Write down the full username too.
3. **Give that user access to the database.** *Access* (or *Add New Access*): choose the user and the database. The site only ever runs `INSERT` (when Train posts results) and `SELECT`, so if the form lets you choose privileges, choose just those. If it only offers "All privileges", that also works.
4. **Create the tables.** *PhpMyAdmin* (open it from the MySQL page), select your database in the left column, open the *Import* tab, choose the file `src/data/training/training.sql` from this repository, and run it. Two tables appear: `training_pokemon` and `training_team`.
5. **Tell the site about it.** Edit `modules/config.local.php`:

   ```php
   $TRAINING_DB_ENABLED = true;
   $DB_NAME = 'u123_training';      // the full database name
   $DB_HOST = 'localhost';          // SiteGround's MySQL runs on the same machine
   $DB_USER = 'u123_trainuser';     // the full username
   $DB_PASS = 'the password';
   ```

6. **Test it.** Play a Train battle to the end against Elite or Champion with a random team, then in PhpMyAdmin open `training_pokemon` and `training_team` and look for new rows. The endpoint accepts one submission per browser session every 120 seconds and only from your own site (it compares the request's origin to the host name), so a second battle right away will not add rows.

Things to know:
- The data stored is the Pokémon ID, format, team position, difficulty, scores, shields and a timestamp. There is no IP address or user identifier in the tables. Decide whether your privacy page should say so.
- `data/training/getTraining.php` (upstream's aggregation script) is not deployed and not needed.
- Never commit the password. `config.local.php` is ignored by git for that reason.

## 8. Caching

SiteGround's caching can serve stale pages after an upload. The site is built so that scripts and data change address with the version (`?v=`), but the HTML that points at them can be cached.

1. Before each upload, bump the number in `src/academy/version.txt` (the update script does it when you merge upstream).
2. After each upload, purge the cache: *Site Tools → Speed → Caching → Flush*, and the SG Optimizer plugin's purge if you use WordPress tools on the same account.
3. While you are iterating, you can turn off *Dynamic Caching* for the staging site.

## 9. Verify it

Open the site in a private window and check, in this order:

| Check | What you should see |
|---|---|
| `https://your-site/` | The home page, over HTTPS with no mixed-content warnings |
| `https://your-site/academy/` | "Loading data…" for a moment, then a question. The league and cup menu has dozens of entries (the open leagues plus every cup with ranking data). |
| `https://your-site/battle/` | The simulator. Run a battle: an "Energy & Timing" section appears under the timeline. |
| `https://your-site/train/` | Setup page with a Coach selector. Play a battle: the overlay shows counts on the buttons. |
| `https://your-site/data/write.php` | **404**. If it loads anything else, it was uploaded: remove it now. |
| `https://your-site/academy/manifest.json` | JSON that starts with `"id": "./"` |

For the installable app (needs `$PWA_ENABLED = true` and HTTPS), in Chrome open DevTools → *Application*:
- *Manifest*: no errors, name "PvP Academy", three icons.
- *Service Workers*: `service-worker.js?v=…` is activated.
- Reload once, switch the browser to *Offline* in the Network tab, reload `/academy/`: it should still show a question.

On a phone:
- **Android Chrome**: open `/academy/`, and an "Install app" button appears on the page (or use the browser menu → Install app).
- **iPhone/iPad Safari**: Share → Add to Home Screen. The page shows these instructions. The installed app has its own storage, separate from Safari, so progress made in Safari is not in it.

## 10. Updating later

- **Your own changes**: bump `src/academy/version.txt`, upload (Option A or B above, without deleting), purge the cache.
- **Taking changes from PvPoke**: see "Updating from upstream" in the README. It is one script (`scripts/academy/update-from-upstream.sh`) plus the checks (`scripts/academy/run-gates.sh`). Upload afterwards as above.

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Academy stays on "Loading data…" | Open DevTools → Console. Usually a wrong `$WEB_ROOT` (404 on `js/` or `data/` files) or stale cached HTML. Fix the setting, purge the cache. |
| Pages look unstyled, scripts 404 | `$WEB_ROOT` does not match where you uploaded. Root is `'/'`, subfolder is `'/folder/'` with slashes at both ends. |
| `/battle/1500/…` style URLs 404 | `.htaccess` was not uploaded, or the host is not Apache with `mod_rewrite`. |
| "Install app" never appears | Needs HTTPS, `$PWA_ENABLED = true`, and Chrome or Edge. iOS never shows the button; use Share → Add to Home Screen. Check DevTools → Application → Manifest. |
| An upload does not show up | Version not bumped, or host cache not purged. Bump `version.txt`, purge, hard-reload. Testers on the installed app get the new version on their next online open. |
| A format is missing from the Academy menu | The menu only lists cups that have a ranking file, and remembers the answer per version. Bump `version.txt`. |
| Train battle ends with a 500 in the browser console | `$TRAINING_DB_ENABLED` is `true` but the database is not set up or the credentials are wrong. Set it to `false`, or finish section 7. |
| No rows appear in the database | Wrong credentials, rate limit (one per 120 s per session), the battle used a manual or imported team, or the opponent was below Elite. Check *Site Tools → Statistics → Error Log*. |
| Settings vanished after an upload | A "mirror with delete" upload removed `config.local.php`. Recreate it and upload without delete. |
| White page or 500 anywhere | *Site Tools → Statistics → Error Log* has the PHP error. |

## 12. Before you share it widely

- Edit `privacy.php` and `contact.php` (see section 5).
- Decide the app's name. "PvP Academy" is a placeholder in `src/academy/manifest.json` and in the `apple-mobile-web-app-title` tag in `src/header.php`. Avoid putting "PvPoke" in the name or using its logo, and tell the PvPoke maintainer before you promote it. The MIT license covers the code, not the name or the Pokémon artwork.
- The site's text still says "PvPoke" in places. Credit the original project in your own about/footer text.
