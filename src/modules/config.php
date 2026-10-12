<?php
$WEB_ROOT = '/pvpoke/src/';
$UA = '';
$GOOGLE_AD_CLIENT = '';

$DB_NAME = 'pvpoke_training';
$DB_HOST = 'localhost';
$DB_USER = 'root';
$DB_PASS = '';

// Progressive web app (installable, offline-capable Academy). Off by default so the site behaves exactly as before.
// Turn it on for a deployment served over HTTPS.
$PWA_ENABLED = false;

// Deployment settings live in an untracked config.local.php beside this file (copy config.local.example.php), so uploads and
// merges from upstream never overwrite them. It may set $WEB_ROOT, $WEB_HOST, $PWA_ENABLED and the database settings.
if(file_exists(__DIR__ . '/config.local.php')){
	include __DIR__ . '/config.local.php';
}

if(! isset($WEB_HOST)){
	$WEB_HOST = 'http://' . $_SERVER['HTTP_HOST'] . $WEB_ROOT;
}

// The PWA_ENABLED environment variable overrides everything (used by the tests)
if(getenv('PWA_ENABLED') !== false){
	$PWA_ENABLED = (getenv('PWA_ENABLED') === '1');
}
?>
