<?php
// Copy to config.local.php (which is not tracked) and edit. Anything set here replaces the defaults in config.php.

// Where the site lives. '/' for a domain root, '/folder/' for a subfolder.
$WEB_ROOT = '/';

// Use https:// on a deployment served over HTTPS.
$WEB_HOST = 'https://' . $_SERVER['HTTP_HOST'] . $WEB_ROOT;

// Installable, offline-capable Academy. Needs HTTPS.
$PWA_ENABLED = true;

// Train mode posts its anonymous results to MySQL. Nothing else on the site uses a database. With no database, turn it off:
$TRAINING_DB_ENABLED = false;
// With a database (see the README), set it to true and fill these in:
// $DB_NAME = '';
// $DB_HOST = 'localhost';
// $DB_USER = '';
// $DB_PASS = '';
