<?php
// Copy to config.local.php (which is not tracked) and edit. Anything set here replaces the defaults in config.php.

// Where the site lives. '/' for a domain root, '/folder/' for a subfolder.
$WEB_ROOT = '/';

// Use https:// on a deployment served over HTTPS.
$WEB_HOST = 'https://' . $_SERVER['HTTP_HOST'] . $WEB_ROOT;

// Installable, offline-capable Academy. Needs HTTPS.
$PWA_ENABLED = true;

// Only needed for the Train mode's saved-results endpoints.
// $DB_NAME = '';
// $DB_HOST = 'localhost';
// $DB_USER = '';
// $DB_PASS = '';
