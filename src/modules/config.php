<?php
$WEB_ROOT = '/pvpoke/src/';
$WEB_HOST = 'http://' . $_SERVER['HTTP_HOST'] . $WEB_ROOT;
$UA = '';
$GOOGLE_AD_CLIENT = '';

// Progressive web app (installable, offline-capable Academy). Off by default so the site behaves exactly as before.
// Turn it on for a deployment served over HTTPS; the PWA_ENABLED environment variable overrides it (used by the tests).
$PWA_ENABLED = false;
if(getenv('PWA_ENABLED') !== false){
	$PWA_ENABLED = (getenv('PWA_ENABLED') === '1');
}

$DB_NAME = 'pvpoke_training';
$DB_HOST = 'localhost';
$DB_USER = 'root';
$DB_PASS = '';
?>
